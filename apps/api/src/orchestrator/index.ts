import { db } from '@figwork/db';
import { getOpenAIClient, buildControllerPrompt, buildInterviewerPrompt, buildInterviewerSystemPrompt, CONTROLLER_SYSTEM_PROMPT } from '@figwork/ai';
import { SessionCache } from '../lib/session-cache.js';
import { retrieveKnowledgeChunks, isLikelyCandidateQuestion, extractQuestionForRetrieval } from '../lib/rag.js';
import { postProcessQueue } from '../lib/queues.js';
import { broadcastToSession } from '../websocket/index.js';
import { WS_SERVER_EVENTS, OPENAI_CONFIG, NEXT_ACTION, MESSAGE_TYPE, TEMPLATE_MODE } from '@figwork/shared';
import type { ControllerOutput, CachedSessionState } from '@figwork/shared';

export async function processOrchestrator(socket: any, sessionToken: string): Promise<void> {
  const session = await SessionCache.get(sessionToken);
  if (!session) return;

  const template = await db.interviewTemplate.findUnique({
    where: { id: session.templateId },
  });

  if (!template) return;

  // Check if this is inquiry mode
  if (template.mode === TEMPLATE_MODE.INQUIRY) {
    await processInquiryMode(socket, sessionToken, session, template);
    return;
  }

  // Check if we're awaiting intro response (voice mode)
  // If so, acknowledge their response and ask the first question
  if ((session as any).awaitingIntroResponse) {
    console.log('[Orchestrator] Intro response received, sending first question');
    await SessionCache.update(sessionToken, { awaitingIntroResponse: false });
    
    const firstQuestion = session.questions[0];
    if (firstQuestion) {
      // Brief acknowledgment then the question
      const ackText = "Great! Let's begin.";
      
      // Send acknowledgment
      socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_START);
      socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_TOKEN, ackText);
      socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_END, ackText);
      await SessionCache.addMessage(sessionToken, 'ai', ackText);
      
      // Small delay then first question
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Send the first question
      const questionText = firstQuestion.text;
      console.log(`SENDING FIRST QUESTION: "${questionText}"`);
      
      socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_START);
      socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_TOKEN, questionText);
      socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_END, questionText);
      
      await SessionCache.addMessage(sessionToken, 'ai', questionText);
      
      await db.transcriptMessage.create({
        data: {
          sessionId: session.sessionId,
          questionId: firstQuestion.id,
          role: 'ai',
          content: questionText,
          messageType: MESSAGE_TYPE.FIXED_QUESTION,
          timestampMs: BigInt(Date.now()),
        },
      });
    }
    return;
  }

  // Application mode - standard structured Q&A
  const currentQuestion = session.questions[session.currentQuestionIndex];
  if (!currentQuestion) {
    // No more questions, end interview
    await endInterviewSession(socket, sessionToken);
    return;
  }

  // Get recent transcript for context
  const conversationHistory = session.recentTranscript.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const latestCandidateInput = session.recentTranscript
    .filter((m) => m.role === 'candidate')
    .pop()?.content || '';

  // Detect if candidate is asking a question - if so, prioritize retrieval based on their question
  const candidateIsAskingQuestion = isLikelyCandidateQuestion(latestCandidateInput);
  
  // Always try to retrieve relevant knowledge for context
  let knowledgeChunks: Array<{ content: string; section?: string | null }> = [];
  try {
    // If candidate is asking a question, focus retrieval on their question
    // Otherwise, use both the current question and their input for context
    let queryText: string;
    if (candidateIsAskingQuestion) {
      queryText = extractQuestionForRetrieval(latestCandidateInput);
      console.log(`[RAG] Candidate question detected, searching for: "${queryText.slice(0, 50)}..."`);
    } else {
      queryText = `${currentQuestion.text} ${latestCandidateInput}`;
    }
    
    // Retrieve more chunks if candidate is asking a question (need good answer)
    const topK = candidateIsAskingQuestion ? 7 : 5;
    knowledgeChunks = await retrieveKnowledgeChunks(session.templateId, queryText, topK);
    
    if (knowledgeChunks.length > 0) {
      console.log(`[RAG] Retrieved ${knowledgeChunks.length} chunks (question mode: ${candidateIsAskingQuestion})`);
    }
  } catch (error) {
    console.error('Error retrieving knowledge chunks:', error);
  }

  // Log candidate files context availability
  if (session.candidateFilesSummary) {
    console.log(`[Orchestrator] Candidate files context available: ${session.candidateFilesSummary.length} chars`);
  } else {
    console.log('[Orchestrator] No candidate files context available');
  }

  // Build controller prompt
  const controllerPrompt = buildControllerPrompt({
    currentQuestion: currentQuestion.text,
    rubric: currentQuestion.rubric,
    conversationHistory,
    latestCandidateInput,
    followupCount: session.followupsUsedCurrent,
    maxFollowups: currentQuestion.maxFollowups,
    globalFollowupLimit: template.globalFollowupLimit,
    knowledgeChunks,
    candidateFilesContext: session.candidateFilesSummary || undefined,
  });

  // Call controller LLM
  const openai = getOpenAIClient();
  const startTime = Date.now();

  let controllerOutput: ControllerOutput;

  try {
    // Use gpt-4o-mini for fast decision making (~150ms vs ~500ms for gpt-4o)
    const controllerResponse = await openai.chat.completions.create({
      model: OPENAI_CONFIG.MODEL_CONTROLLER,
      messages: [
        { role: 'system', content: CONTROLLER_SYSTEM_PROMPT },
        { role: 'user', content: controllerPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: OPENAI_CONFIG.TEMPERATURE_CONTROLLER,
      max_tokens: OPENAI_CONFIG.MAX_TOKENS_CONTROLLER,
    });

    const responseText = controllerResponse.choices[0]?.message?.content || '{}';
    controllerOutput = JSON.parse(responseText) as ControllerOutput;

    const latency = Date.now() - startTime;
    console.log(`Controller LLM: ${latency}ms ${latency > 200 ? '⚠️ SLOW' : '✓'}`);
  } catch (error) {
    console.error('Controller LLM error:', error);
    // Default to asking followup or advancing
    controllerOutput = {
      turn_type: 'ANSWER',
      is_sufficient: true,
      missing_points: [],
      next_action: NEXT_ACTION.ADVANCE_QUESTION,
      followup_question: null,
      candidate_answer_summary: null,
      detected_candidate_question: null,
      kb_answer: null,
      kb_citations: [],
      file_reference: null,
    };
  }

  // Store evaluation decision
  await db.evaluationDecision.create({
    data: {
      sessionId: session.sessionId,
      questionId: currentQuestion.id,
      turnType: controllerOutput.turn_type,
      isSufficient: controllerOutput.is_sufficient,
      missingPoints: controllerOutput.missing_points,
      nextAction: controllerOutput.next_action,
      followupQuestion: controllerOutput.followup_question,
      rawControllerOutput: controllerOutput as any,
    },
  });

  // Format knowledge for passing to handlers
  const knowledgeContext = knowledgeChunks.length > 0 
    ? knowledgeChunks.map((c, i) => `[${i + 1}] ${c.section ? `(${c.section}) ` : ''}${c.content}`).join('\n\n')
    : undefined;

  // Handle different actions
  switch (controllerOutput.next_action) {
    case NEXT_ACTION.ASK_FOLLOWUP:
      await handleFollowup(socket, sessionToken, session, template, controllerOutput, knowledgeContext);
      break;

    case NEXT_ACTION.ADVANCE_QUESTION:
      await handleAdvanceQuestion(socket, sessionToken, session, template);
      break;

    case NEXT_ACTION.ANSWER_CANDIDATE_QUESTION:
      await handleAnswerCandidateQuestion(socket, sessionToken, session, template, controllerOutput, knowledgeContext);
      break;

    case NEXT_ACTION.HANDLE_META:
      await handleMeta(socket, sessionToken, session, template, controllerOutput);
      break;

    case NEXT_ACTION.END_INTERVIEW:
      await endInterviewSession(socket, sessionToken);
      break;

    default:
      // Default to advancing
      await handleAdvanceQuestion(socket, sessionToken, session, template);
  }
}

async function handleFollowup(
  socket: any,
  sessionToken: string,
  session: CachedSessionState,
  template: any,
  controllerOutput: ControllerOutput,
  knowledgeContext?: string
): Promise<void> {
  await SessionCache.incrementFollowup(sessionToken);

  const prompt = buildInterviewerPrompt({
    action: 'ASK_FOLLOWUP',
    content: controllerOutput.followup_question,
    fileReference: controllerOutput.file_reference,
  });

  await streamInterviewerResponse(socket, sessionToken, session, template, prompt, MESSAGE_TYPE.FOLLOWUP, knowledgeContext);
}

async function handleAdvanceQuestion(
  socket: any,
  sessionToken: string,
  session: CachedSessionState,
  template: any
): Promise<void> {
  const newSession = await SessionCache.advanceQuestion(sessionToken);
  if (!newSession) return;

  const nextQuestion = newSession.questions[newSession.currentQuestionIndex];

  if (!nextQuestion) {
    // No more questions
    await endInterviewSession(socket, sessionToken);
    return;
  }

  // Update database
  await db.interviewSession.update({
    where: { id: session.sessionId },
    data: {
      currentQuestionIndex: newSession.currentQuestionIndex,
      followupsUsedCurrent: 0,
    },
  });

  // Notify client of question advance
  socket.emit(WS_SERVER_EVENTS.QUESTION_ADVANCED, {
    index: newSession.currentQuestionIndex,
    total: newSession.questions.length,
  });

  // Send the question EXACTLY as written - NO LLM rephrasing
  const questionText = nextQuestion.text;
  
  // LOG: Verify exact text being sent
  console.log(`SENDING NEXT QUESTION DIRECTLY (no LLM): "${questionText}"`);
  
  // Signal streaming start
  socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_START);
  
  // Send the exact question text directly
  socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_TOKEN, questionText);
  
  // Signal streaming end  
  socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_END, questionText);

  // Add to session cache
  await SessionCache.addMessage(sessionToken, 'ai', questionText);

  // Persist to database
  await db.transcriptMessage.create({
    data: {
      sessionId: newSession.sessionId,
      questionId: nextQuestion.id,
      role: 'ai',
      content: questionText,
      messageType: MESSAGE_TYPE.FIXED_QUESTION,
      timestampMs: BigInt(Date.now()),
    },
  });
}

async function handleAnswerCandidateQuestion(
  socket: any,
  sessionToken: string,
  session: CachedSessionState,
  template: any,
  controllerOutput: ControllerOutput,
  knowledgeContext?: string
): Promise<void> {
  // Log what we're answering
  console.log(`[Orchestrator] Answering candidate question: "${controllerOutput.detected_candidate_question?.slice(0, 50)}..."`);
  console.log(`[Orchestrator] KB answer: "${controllerOutput.kb_answer?.slice(0, 100)}..."`);
  
  const answerContent = controllerOutput.kb_answer || 
    "That's a great question! I don't have the specific details on that, but I'll make sure to note your question for the hiring team to address. Is there anything else you'd like to know?";

  const prompt = buildInterviewerPrompt({
    action: 'ANSWER_CANDIDATE_QUESTION',
    content: answerContent,
  });

  // Pass knowledge context so interviewer can reference it if needed
  await streamInterviewerResponse(socket, sessionToken, session, template, prompt, MESSAGE_TYPE.KB_ANSWER, knowledgeContext);
}

async function handleMeta(
  socket: any,
  sessionToken: string,
  session: CachedSessionState,
  template: any,
  controllerOutput: ControllerOutput
): Promise<void> {
  const latestInput = session.recentTranscript
    .filter((m) => m.role === 'candidate')
    .pop()?.content || '';

  const prompt = buildInterviewerPrompt({
    action: 'HANDLE_META',
    content: latestInput,
  });

  await streamInterviewerResponse(socket, sessionToken, session, template, prompt, MESSAGE_TYPE.META);
}

async function streamInterviewerResponse(
  socket: any,
  sessionToken: string,
  session: CachedSessionState,
  template: any,
  prompt: string,
  messageType: string,
  knowledgeContext?: string
): Promise<void> {
  const openai = getOpenAIClient();
  const startTime = Date.now();
  let firstTokenTime = 0;

  // Signal streaming start IMMEDIATELY
  socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_START);

  let fullMessage = '';

  try {
    // Use gpt-4o-mini for ultra-fast streaming (~100ms to first token)
    const stream = await openai.chat.completions.create({
      model: OPENAI_CONFIG.MODEL_INTERVIEWER,
      messages: [
        {
          role: 'system',
          // Pass knowledge and candidate files to interviewer for context
          content: buildInterviewerSystemPrompt(
            template.personaPrompt, 
            template.toneGuidance,
            session.candidateFilesSummary || undefined,
            knowledgeContext
          ),
        },
        { role: 'user', content: prompt },
      ],
      stream: true,
      max_tokens: OPENAI_CONFIG.MAX_TOKENS_INTERVIEWER,
      temperature: OPENAI_CONFIG.TEMPERATURE_INTERVIEWER,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        if (!firstTokenTime) {
          firstTokenTime = Date.now() - startTime;
        }
        fullMessage += content;
        socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_TOKEN, content);
      }
    }
  } catch (error) {
    console.error('Interviewer LLM error:', error);
    fullMessage = "I apologize, I'm having a technical issue. Could you please repeat that?";
    socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_TOKEN, fullMessage);
  }

  // Signal streaming end
  socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_END, fullMessage);

  const totalTime = Date.now() - startTime;
  console.log(`Interviewer: first token ${firstTokenTime}ms, total ${totalTime}ms, ${fullMessage.length} chars ${firstTokenTime > 150 ? '⚠️' : '✓'}`);

  // Add to session cache
  await SessionCache.addMessage(sessionToken, 'ai', fullMessage);

  // Persist to database
  const currentQuestion = session.questions[session.currentQuestionIndex];
  await db.transcriptMessage.create({
    data: {
      sessionId: session.sessionId,
      questionId: currentQuestion?.id || null,
      role: 'ai',
      content: fullMessage,
      messageType,
      timestampMs: BigInt(Date.now()),
    },
  });
}

// Inquiry Mode - Open conversation for general inquiries
async function processInquiryMode(
  socket: any,
  sessionToken: string,
  session: CachedSessionState,
  template: any
): Promise<void> {
  // Get recent transcript for context
  const conversationHistory = session.recentTranscript.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const latestCandidateInput = session.recentTranscript
    .filter((m) => m.role === 'candidate')
    .pop()?.content || '';

  // Retrieve relevant knowledge for context
  let knowledgeChunks: Array<{ content: string; section?: string | null }> = [];
  try {
    knowledgeChunks = await retrieveKnowledgeChunks(session.templateId, latestCandidateInput, 5);
    if (knowledgeChunks.length > 0) {
      console.log(`[Inquiry] Retrieved ${knowledgeChunks.length} knowledge chunks`);
    }
  } catch (error) {
    console.error('Error retrieving knowledge chunks:', error);
  }

  // Build inquiry-specific system prompt
  let inquirySystemPrompt = `You are a helpful, intelligent assistant for ${template.name}. Your role is to have a genuine conversation with visitors.

Persona: ${template.personaPrompt}

${template.toneGuidance ? `Tone: ${template.toneGuidance}` : ''}

${template.inquiryGoal ? `Your Goal: ${template.inquiryGoal}` : ''}

Conversation Guidelines:
- Be genuinely helpful and curious
- Answer questions thoroughly using knowledge base when available
- If you don't know something, say so honestly
- Have a real conversation - respond to what they say, ask follow-up questions
- Keep responses focused (2-4 sentences typically, but longer if needed)
- If they share documents, reference specific details from them`;

  if (knowledgeChunks.length > 0) {
    inquirySystemPrompt += `

Available Knowledge (use this to answer questions):
${knowledgeChunks.map((c, i) => `[${i + 1}] ${c.section ? `(${c.section}) ` : ''}${c.content}`).join('\n\n')}`;
  }

  if (session.candidateFilesSummary) {
    inquirySystemPrompt += `

VISITOR'S UPLOADED DOCUMENTS:
${session.candidateFilesSummary}

IMPORTANT: You have access to documents the visitor shared. Use this information to:
- Reference specific details from their documents
- Ask informed follow-up questions based on what they shared
- Connect their background to the conversation
- Provide personalized responses`;
  }

  // Build conversation messages for LLM
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: inquirySystemPrompt },
  ];

  // Add conversation history
  for (const msg of conversationHistory) {
    messages.push({
      role: msg.role === 'candidate' ? 'user' : 'assistant',
      content: msg.content,
    });
  }

  // If no history yet, don't add the latest input again (it's already in history)
  // Just let the LLM generate a response

  const openai = getOpenAIClient();
  const startTime = Date.now();
  let firstTokenTime = 0;

  // Signal streaming start IMMEDIATELY
  socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_START);

  let fullMessage = '';

  try {
    // Use gpt-4o-mini for ultra-fast streaming
    const stream = await openai.chat.completions.create({
      model: OPENAI_CONFIG.MODEL_INTERVIEWER, // Same fast model for inquiry
      messages,
      stream: true,
      max_tokens: 150, // Shorter for faster responses
      temperature: 0.7, // Still natural but more predictable
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        if (!firstTokenTime) {
          firstTokenTime = Date.now() - startTime;
        }
        fullMessage += content;
        socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_TOKEN, content);
      }
    }
  } catch (error) {
    console.error('Inquiry LLM error:', error);
    fullMessage = "I apologize, I'm having a technical issue. Could you please try again?";
    socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_TOKEN, fullMessage);
  }

  // Signal streaming end
  socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_END, fullMessage);

  const totalTime = Date.now() - startTime;
  console.log(`[Inquiry] first token ${firstTokenTime}ms, total ${totalTime}ms, ${fullMessage.length} chars ${firstTokenTime > 150 ? '⚠️' : '✓'}`);

  // Add to session cache
  await SessionCache.addMessage(sessionToken, 'ai', fullMessage);

  // Persist to database
  await db.transcriptMessage.create({
    data: {
      sessionId: session.sessionId,
      questionId: null, // No question ID for inquiry mode
      role: 'ai',
      content: fullMessage,
      messageType: MESSAGE_TYPE.META, // Generic message type for inquiry
      timestampMs: BigInt(Date.now()),
    },
  });
}

export async function endInterviewSession(socket: any, sessionToken: string): Promise<void> {
  const session = await SessionCache.get(sessionToken);
  if (!session) return;

  // Get template for farewell message
  const template = await db.interviewTemplate.findUnique({
    where: { id: session.templateId },
  });

  if (template) {
    // Send farewell message
    const prompt = buildInterviewerPrompt({
      action: 'END_INTERVIEW',
      content: null,
    });

    await streamInterviewerResponse(socket, sessionToken, session, template, prompt, MESSAGE_TYPE.META);
  }

  // Update session status
  const completedSession = await db.interviewSession.update({
    where: { id: session.sessionId },
    data: {
      status: 'completed',
      completedAt: new Date(),
    },
    include: { link: true },
  });

  await SessionCache.updateStatus(sessionToken, 'completed');

  // Queue for post-processing (summary generation)
  await postProcessQueue.add('generate-summary', {
    sessionId: session.sessionId,
  });

  // ── Screening Interview → Execution Bridge ──
  // If this interview session is linked to an execution (via infoSessionId = linkId),
  // update the execution status from pending_screening → assigned (auto) or pending_review (manual)
  try {
    const linkedExecution = await db.execution.findFirst({
      where: {
        infoSessionId: completedSession.linkId,
        status: 'pending_screening',
      },
      include: { workUnit: true },
    });

    if (linkedExecution) {
      const isManual = (linkedExecution.workUnit as any).assignmentMode === 'manual';
      const newStatus = isManual ? 'pending_review' : 'assigned';

      await db.execution.update({
        where: { id: linkedExecution.id },
        data: {
          status: newStatus,
          infoSessionId: completedSession.id, // Update to point to actual session, not link
        },
      });

      // Notify company that screening is done
      const company = await db.companyProfile.findUnique({
        where: { id: linkedExecution.workUnit.companyId },
      });
      if (company) {
        await db.notification.create({
          data: {
            userId: company.userId,
            userType: 'company',
            type: 'screening_completed',
            title: 'Screening Interview Completed',
            body: `A candidate completed the screening for "${linkedExecution.workUnit.title}"`,
            data: {
              executionId: linkedExecution.id,
              workUnitId: linkedExecution.workUnitId,
              sessionId: completedSession.id,
            },
            channels: ['in_app', 'email'],
          },
        });
      }

      // In auto mode, also move the work unit to in_progress if not already
      if (!isManual && linkedExecution.workUnit.status === 'active') {
        await db.workUnit.update({
          where: { id: linkedExecution.workUnitId },
          data: { status: 'in_progress' },
        });
      }
    }
  } catch (bridgeErr) {
    // Non-fatal — log and continue
    console.error('[ScreeningBridge] Failed to update execution after interview:', bridgeErr);
  }

  // Notify client
  socket.emit(WS_SERVER_EVENTS.INTERVIEW_ENDED);

  // Invalidate cache after a delay
  setTimeout(() => {
    SessionCache.invalidate(sessionToken);
  }, 5000);
}
