import { Worker, Job } from 'bullmq';
import { db } from '@figwork/db';
import { getOpenAIClient, buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT, INQUIRY_SUMMARY_SYSTEM_PROMPT } from '@figwork/ai';
import { getBullMQRedis } from '../lib/redis.js';
import { QUEUE_NAMES, OPENAI_CONFIG } from '@figwork/shared';

interface PostProcessJobData {
  sessionId: string;
}

async function generateSummary(job: Job<PostProcessJobData>): Promise<void> {
  const { sessionId } = job.data;

  console.log(`Generating summary for session: ${sessionId}`);

  try {
    // Check if summary already exists
    const existingSummary = await db.interviewSummary.findUnique({
      where: { sessionId },
    });

    if (existingSummary) {
      console.log(`Summary already exists for session: ${sessionId}`);
      return;
    }

    // Fetch full transcript
    const messages = await db.transcriptMessage.findMany({
      where: { sessionId },
      orderBy: { timestampMs: 'asc' },
    });

    if (messages.length === 0) {
      console.log(`No messages found for session: ${sessionId}`);
      return;
    }

    // Fetch session with template and questions
    const session = await db.interviewSession.findUnique({
      where: { id: sessionId },
      include: {
        template: {
          include: {
            questions: {
              orderBy: { orderIndex: 'asc' },
            },
          },
        },
      },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    // Determine mode (inquiry vs application)
    const mode = (session.template.mode as 'application' | 'inquiry') || 'application';
    const isInquiryMode = mode === 'inquiry';

    console.log(`Generating ${isInquiryMode ? 'inquiry' : 'application'} summary for session: ${sessionId}`);

    // Build summary prompt based on mode
    const summaryPrompt = buildSummaryPrompt({
      transcript: messages.map((m) => ({
        role: m.role as 'ai' | 'candidate',
        content: m.content,
        questionId: m.questionId || undefined,
      })),
      questions: session.template.questions.map((q) => ({
        id: q.id,
        text: q.questionText,
        rubric: q.rubric,
      })),
      mode,
    });

    // Generate summary via LLM - use appropriate system prompt based on mode
    const openai = getOpenAIClient();
    const startTime = Date.now();
    const systemPrompt = isInquiryMode ? INQUIRY_SUMMARY_SYSTEM_PROMPT : SUMMARY_SYSTEM_PROMPT;

    const completion = await openai.chat.completions.create({
      model: OPENAI_CONFIG.MODEL_FULL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: summaryPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_completion_tokens: 2000,
    });

    console.log(`Summary LLM: ${Date.now() - startTime}ms`);

    const responseText = completion.choices[0]?.message?.content || '{}';
    
    // Parse summary - structure differs based on mode
    let summaryData: {
      // Application mode fields
      strengths?: string[];
      gaps?: string[];
      rubric_coverage?: Record<string, unknown>;
      supporting_quotes?: string[];
      narrative?: string;
      // Inquiry mode fields
      visitor_info?: {
        name?: string | null;
        email?: string | null;
        company?: string | null;
        role?: string | null;
      };
      topics_discussed?: string[];
      key_questions?: string[];
      information_provided?: string[];
      action_items?: string[];
      sentiment?: string;
    };

    try {
      summaryData = JSON.parse(responseText);
    } catch {
      summaryData = { narrative: responseText };
    }

    // **TRANSACTION: Store summary and update session status atomically**
    await db.$transaction(async (tx) => {
      if (isInquiryMode) {
        // For inquiry mode, store differently
        await tx.interviewSummary.create({
          data: {
            sessionId,
            // Map inquiry fields to existing schema
            strengths: summaryData.topics_discussed || [],
            gaps: summaryData.action_items || [],
            rubricCoverage: summaryData.visitor_info ? JSON.parse(JSON.stringify({
              visitor_info: summaryData.visitor_info,
              key_questions: summaryData.key_questions,
              information_provided: summaryData.information_provided,
              sentiment: summaryData.sentiment,
            })) : null,
            supportingQuotes: summaryData.key_questions || [],
            rawSummary: summaryData.narrative || '',
          },
        });
      } else {
        // Application mode - original structure
        await tx.interviewSummary.create({
          data: {
            sessionId,
            strengths: summaryData.strengths || [],
            gaps: summaryData.gaps || [],
            rubricCoverage: summaryData.rubric_coverage ? JSON.parse(JSON.stringify(summaryData.rubric_coverage)) : null,
            supportingQuotes: summaryData.supporting_quotes || [],
            rawSummary: summaryData.narrative || '',
          },
        });
      }

      // Mark session as having summary generated
      await tx.interviewSession.update({
        where: { id: sessionId },
        data: { lastActivityAt: new Date() },
      });
    });

    console.log(`Summary generated for session: ${sessionId}`);
  } catch (error) {
    console.error(`Summary generation error for ${sessionId}:`, error);
    throw error;
  }
}

export function startPostProcessWorker(): void {
  const worker = new Worker<PostProcessJobData>(
    QUEUE_NAMES.POST_PROCESSING,
    generateSummary,
    {
      connection: getBullMQRedis(),
      concurrency: 2,
    }
  );

  worker.on('completed', (job) => {
    console.log(`Post-process job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Post-process job ${job?.id} failed:`, err);
  });

  console.log('Post-process worker started');
}
