/**
 * Background worker for PDF generation
 * Offloads CPU-intensive PDF rendering from the request handler
 */

import { Worker, Job } from 'bullmq';
import { db } from '@figwork/db';
import { getBullMQRedis, getRedis } from '../lib/redis.js';
import { QUEUE_NAMES } from '@figwork/shared';
import { generateInterviewPDF } from '../lib/pdf-generator.js';

const redis = getRedis();

interface PDFJobData {
  sessionId: string;
  requesterId: string;
  jobId: string;
}

interface PDFJobResult {
  success: boolean;
  pdfKey?: string;
  error?: string;
}

/**
 * Process PDF generation job
 */
async function processPDFGeneration(job: Job<PDFJobData>): Promise<PDFJobResult> {
  const { sessionId, requesterId, jobId } = job.data;
  const statusKey = `pdf:status:${jobId}`;

  try {
    // Update status to processing
    await redis.setex(statusKey, 3600, JSON.stringify({ status: 'processing', progress: 10 }));

    // Fetch session data
    const session = await db.interviewSession.findFirst({
      where: { id: sessionId },
      include: {
        template: true,
        summary: true,
        candidateFiles: true,
      },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    // Verify ownership
    if (session.template.ownerId !== requesterId) {
      throw new Error('Unauthorized');
    }

    await redis.setex(statusKey, 3600, JSON.stringify({ status: 'processing', progress: 30 }));

    // Fetch transcript messages
    const messages = await db.transcriptMessage.findMany({
      where: { sessionId },
      include: {
        question: true,
      },
      orderBy: { timestampMs: 'asc' },
    });

    await redis.setex(statusKey, 3600, JSON.stringify({ status: 'processing', progress: 50 }));

    // Generate PDF
    const pdfBuffer = await generateInterviewPDF({
      sessionId: session.id,
      templateName: session.template.name,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        messageType: m.messageType,
        question: m.question ? {
          questionText: m.question.questionText,
          orderIndex: m.question.orderIndex,
        } : null,
      })),
      summary: session.summary ? {
        strengths: session.summary.strengths as string[] | null,
        gaps: session.summary.gaps as string[] | null,
        rubricCoverage: session.summary.rubricCoverage as Record<string, unknown> | null,
        supportingQuotes: session.summary.supportingQuotes as string[] | null,
        rawSummary: session.summary.rawSummary,
      } : null,
      candidateFiles: session.candidateFiles.map((f) => ({
        filename: f.filename,
        fileType: f.fileType,
      })),
    });

    await redis.setex(statusKey, 3600, JSON.stringify({ status: 'processing', progress: 80 }));

    // Store PDF in Redis temporarily (for download)
    const pdfKey = `pdf:data:${jobId}`;
    await redis.setex(pdfKey, 3600, pdfBuffer.toString('base64')); // 1 hour expiry

    // Update status to complete
    await redis.setex(statusKey, 3600, JSON.stringify({ 
      status: 'complete', 
      progress: 100,
      pdfKey,
      filename: `interview-${session.id}.pdf`,
    }));

    console.log(`PDF generated for session ${sessionId}`);

    return { success: true, pdfKey };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`PDF generation failed for session ${sessionId}:`, error);

    // Update status to error
    await redis.setex(statusKey, 3600, JSON.stringify({ 
      status: 'error', 
      error: errorMessage,
    }));

    return { success: false, error: errorMessage };
  }
}

/**
 * Start the PDF generation worker
 */
export function startPDFWorker(): void {
  const worker = new Worker<PDFJobData, PDFJobResult>(
    QUEUE_NAMES.PDF_GENERATION,
    processPDFGeneration,
    {
      connection: getBullMQRedis(),
      concurrency: 2, // Limit concurrent PDF generation
    }
  );

  worker.on('completed', (job, result) => {
    console.log(`PDF job ${job.id} completed:`, result.success ? 'success' : 'failed');
  });

  worker.on('failed', (job, err) => {
    console.error(`PDF job ${job?.id} failed:`, err);
  });

  console.log('PDF generation worker started');
}
