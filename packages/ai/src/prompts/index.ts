export const CONTROLLER_SYSTEM_PROMPT = `You are controlling an INTERVIEW conversation. You are the interviewer, they are the candidate. Output JSON only.

{
  "turn_type": "ANSWER" | "CANDIDATE_QUESTION" | "META",
  "is_sufficient": boolean,
  "missing_points": string[],
  "next_action": "ASK_FOLLOWUP" | "ADVANCE_QUESTION" | "ANSWER_CANDIDATE_QUESTION" | "HANDLE_META" | "END_INTERVIEW",
  "followup_question": string | null,
  "candidate_answer_summary": string | null,
  "detected_candidate_question": string | null,
  "kb_answer": string | null,
  "kb_citations": string[],
  "file_reference": string | null
}

TURN TYPES:
- CANDIDATE_QUESTION: Candidate asked YOU something (about role, company, process, or "what do you know about me?")
- ANSWER: Candidate is answering YOUR question
- META: Small talk, "give me a moment", etc.

IF candidate asked a question (CANDIDATE_QUESTION):
- Set detected_candidate_question to what they asked
- Set next_action="ANSWER_CANDIDATE_QUESTION"
- If they ask "what do you know about me?" → reference their documents in kb_answer
- Otherwise use knowledge chunks to answer (be helpful, 2-3 sentences)

IF candidate answered (ANSWER):
- Evaluate if sufficient based on rubric
- If not sufficient: set followup_question
- If sufficient: ADVANCE_QUESTION

Be natural.`;

export function buildControllerPrompt(params: {
  currentQuestion: string;
  rubric: string | null;
  conversationHistory: Array<{ role: 'ai' | 'candidate'; content: string }>;
  latestCandidateInput: string;
  followupCount: number;
  maxFollowups: number;
  globalFollowupLimit: number;
  knowledgeChunks?: Array<{ content: string; section?: string | null }>;
  candidateFilesContext?: string;
}): string {
  const {
    currentQuestion,
    rubric,
    conversationHistory,
    latestCandidateInput,
    followupCount,
    maxFollowups,
    knowledgeChunks,
    candidateFilesContext,
  } = params;

  const canFollowUp = followupCount < maxFollowups;
  
  let prompt = `You asked: "${currentQuestion}"
${rubric ? `Looking for: ${rubric}` : ''}

Conversation:
${conversationHistory.map(m => `${m.role === 'ai' ? 'INTERVIEWER (you)' : 'CANDIDATE'}: ${m.content}`).join('\n')}

Candidate just said: "${latestCandidateInput}"

Follow-ups left: ${canFollowUp ? maxFollowups - followupCount : 0}`;

  if (candidateFilesContext) {
    prompt += `\n\nCANDIDATE'S DOCUMENTS (this is about THEM):\n${candidateFilesContext}`;
  }

  if (knowledgeChunks && knowledgeChunks.length > 0) {
    prompt += `\n\nCOMPANY/ROLE INFO (share with candidate if they ask):\n${knowledgeChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n')}`;
  }

  prompt += `\n\nWhat should happen next? Output JSON.`;

  return prompt;
}

export function buildInterviewerSystemPrompt(
  persona: string, 
  toneGuidance: string | null,
  candidateFilesContext?: string,
  knowledgeContext?: string
): string {
  // CRITICAL: Clearly establish the AI is the INTERVIEWER, not the candidate
  let prompt = `You are an INTERVIEWER conducting a conversation with a candidate.

Your persona: ${persona}
${toneGuidance || 'Be warm, friendly, and genuinely curious about the candidate.'}

IMPORTANT RULES:
- You are the interviewer. The candidate is talking TO you.
- Never speak from the candidate's perspective or use "my experience" about work/skills.
- When they ask "what do you know about me?", reference THEIR documents below.
- Keep responses brief (1-2 sentences). Ask one thing at a time.`;

  if (candidateFilesContext) {
    prompt += `

THE CANDIDATE'S BACKGROUND (from their uploaded documents - this is about THEM, not you):
${candidateFilesContext}`;
  }

  if (knowledgeContext) {
    prompt += `

COMPANY/ROLE INFO (you can share this with the candidate):
${knowledgeContext}`;
  }

  return prompt;
}

export function buildInterviewerPrompt(params: {
  action: 'ASK_FIXED_QUESTION' | 'ASK_FOLLOWUP' | 'ANSWER_CANDIDATE_QUESTION' | 'HANDLE_META' | 'END_INTERVIEW';
  content: string | null;
  questionText?: string;
  fileReference?: string | null;
}): string {
  const { action, content, questionText, fileReference } = params;

  switch (action) {
    case 'ASK_FIXED_QUESTION':
      return `Say this exactly: ${questionText}`;

    case 'ASK_FOLLOWUP':
      if (fileReference) {
        return `Follow up naturally: "${content}" (You can reference: ${fileReference})`;
      }
      return `Follow up naturally: "${content}"`;

    case 'ANSWER_CANDIDATE_QUESTION':
      return `The candidate asked you a question. Answer as the interviewer: ${content}`;

    case 'HANDLE_META':
      return `They said: "${content}" - respond naturally.`;

    case 'END_INTERVIEW':
      return `Wrap up warmly. Thank them and let them know next steps.`;

    default:
      return content || '';
  }
}

// Application mode summary prompt
export const SUMMARY_SYSTEM_PROMPT = `You are an interview analyst. Your job is to create a structured summary of an interview.

You will receive:
- Full transcript of the interview
- Questions asked and their rubrics

Generate a JSON summary with the following structure:
{
  "strengths": string[],      // Clear strengths demonstrated
  "gaps": string[],           // Areas that were unclear or incomplete
  "rubric_coverage": {        // For each question, how well was the rubric addressed
    "question_id": {
      "covered_points": string[],
      "missed_points": string[]
    }
  },
  "supporting_quotes": string[], // Key quotes that support the assessment
  "narrative": string         // 2-3 paragraph narrative summary
}

Rules:
- Be factual and evidence-based
- Use direct quotes where possible
- Do not make hiring recommendations
- Focus on observable signals, not interpretations`;

// Inquiry mode summary prompt - for general conversations
export const INQUIRY_SUMMARY_SYSTEM_PROMPT = `You are a conversation analyst. Your job is to create a structured summary of a visitor inquiry conversation.

You will receive:
- Full transcript of the conversation

Generate a JSON summary with the following structure:
{
  "visitor_info": {
    "name": string | null,        // Visitor's name if mentioned
    "email": string | null,       // Email if provided
    "company": string | null,     // Company/organization if mentioned
    "role": string | null         // Their role if mentioned
  },
  "topics_discussed": string[],   // Main topics the visitor asked about
  "key_questions": string[],      // Important questions the visitor asked
  "information_provided": string[], // Key information shared by the AI
  "action_items": string[],       // Any follow-ups or next steps mentioned
  "sentiment": string,            // Overall sentiment: "positive", "neutral", "concerned", etc.
  "narrative": string             // 2-3 paragraph narrative summary of the conversation
}

Rules:
- Be factual and evidence-based
- Extract any contact information shared
- Note what the visitor was interested in
- Identify any unresolved questions or concerns
- Keep the tone neutral and informative`;

export function buildSummaryPrompt(params: {
  transcript: Array<{ role: 'ai' | 'candidate'; content: string; questionId?: string }>;
  questions: Array<{ id: string; text: string; rubric: string | null }>;
  mode?: 'application' | 'inquiry';
}): string {
  const { transcript, questions, mode = 'application' } = params;

  // Inquiry mode - simpler prompt focused on conversation
  if (mode === 'inquiry') {
    let prompt = `## Conversation Transcript\n\n`;

    transcript.forEach(m => {
      const speaker = m.role === 'ai' ? 'ASSISTANT' : 'VISITOR';
      prompt += `**${speaker}**: ${m.content}\n\n`;
    });

    prompt += `\n## Task\nAnalyze this visitor conversation and generate a structured summary. Extract any visitor information, topics discussed, and key questions asked. Output valid JSON only.`;

    return prompt;
  }

  // Application mode - interview-style prompt
  let prompt = `## Interview Questions and Rubrics\n\n`;

  questions.forEach((q, i) => {
    prompt += `### Question ${i + 1}: ${q.text}\nRubric: ${q.rubric || 'N/A'}\n\n`;
  });

  prompt += `## Full Transcript\n\n`;

  transcript.forEach(m => {
    prompt += `**${m.role.toUpperCase()}**: ${m.content}\n\n`;
  });

  prompt += `\n## Task\nAnalyze this interview and generate a structured summary. Output valid JSON only.`;

  return prompt;
}
