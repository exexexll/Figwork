import { Worker, Job } from 'bullmq';
import { db } from '@figwork/db';
import { getBullMQRedis } from '../lib/redis.js';
import { downloadFile } from '../lib/cloudinary.js';
import { SessionCache } from '../lib/session-cache.js';
import { broadcastToSession } from '../websocket/index.js';
import { QUEUE_NAMES, WS_SERVER_EVENTS } from '@figwork/shared';
import { validateFile, scanTextContent } from '../lib/file-validator.js';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

interface CandidateFileJobData {
  fileId: string;
  sessionToken: string;
  cloudinaryUrl: string;
  fileType: string;
}

/**
 * Extract text from file
 */
async function extractText(buffer: Buffer, fileType: string): Promise<string> {
  switch (fileType.toLowerCase()) {
    case 'pdf': {
      const pdfData = await pdfParse(buffer);
      return pdfData.text;
    }

    case 'docx': {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    case 'txt':
    case 'md':
      return buffer.toString('utf-8');

    default:
      return '';
  }
}

/**
 * Summarize document content for AI context
 */
function summarizeForContext(text: string, filename: string, maxLength: number = 3000): string {
  // Truncate if needed
  const truncated = text.length > maxLength ? text.slice(0, maxLength) + '...[truncated]' : text;

  return `**${filename}**:\n${truncated}`;
}

async function processCandidateFile(job: Job<CandidateFileJobData>): Promise<void> {
  const { fileId, sessionToken, cloudinaryUrl, fileType } = job.data;

  console.log(`[CandidateFile] Processing file: ${fileId}`);
  console.log(`[CandidateFile] Session: ${sessionToken}, Type: ${fileType}`);
  console.log(`[CandidateFile] URL: ${cloudinaryUrl}`);

  try {
    // Update status to processing
    await db.candidateFile.update({
      where: { id: fileId },
      data: { status: 'processing' },
    });

    // Get file details first
    const file = await db.candidateFile.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new Error('File not found');
    }

    // Download file
    const buffer = await downloadFile(cloudinaryUrl);
    console.log(`Downloaded file: ${buffer.length} bytes`);

    // **SECURITY: Validate file before processing**
    const validationResult = await validateFile(
      buffer,
      file.filename,
      fileType,
      50 // Max 50MB
    );

    if (!validationResult.valid) {
      console.warn(`File validation failed for ${fileId}: ${validationResult.error}`);
      await db.candidateFile.update({
        where: { id: fileId },
        data: { 
          status: 'error',
          extractedText: `Validation error: ${validationResult.error}`,
        },
      });
      // Notify client of validation failure
      broadcastToSession(sessionToken, WS_SERVER_EVENTS.ERROR, {
        message: `File rejected: ${validationResult.error}`,
        fileId,
      });
      return;
    }

    if (validationResult.warnings && validationResult.warnings.length > 0) {
      console.warn(`File validation warnings for ${fileId}:`, validationResult.warnings);
    }

    // Extract text
    const extractedText = await extractText(buffer, fileType);
    console.log(`Extracted text: ${extractedText.length} chars`);

    // **SECURITY: Scan extracted text for dangerous content**
    const contentScanResult = scanTextContent(extractedText);
    if (!contentScanResult.valid) {
      console.warn(`Content scan failed for ${fileId}: ${contentScanResult.error}`);
      await db.candidateFile.update({
        where: { id: fileId },
        data: { 
          status: 'error',
          extractedText: `Security scan error: ${contentScanResult.error}`,
        },
      });
      broadcastToSession(sessionToken, WS_SERVER_EVENTS.ERROR, {
        message: 'File content flagged as potentially unsafe',
        fileId,
      });
      return;
    }

    // Update file with extracted text
    await db.candidateFile.update({
      where: { id: fileId },
      data: {
        extractedText,
        status: 'ready',
      },
    });

    // Update session cache with file summary
    const session = await SessionCache.get(sessionToken);
    if (session) {
      const fileSummary = summarizeForContext(extractedText, file.filename);
      console.log(`[CandidateFile] Generated summary for ${file.filename}: ${fileSummary.length} chars`);

      // Append to existing context or create new
      const existingContext = session.candidateFilesSummary || '';
      const newContext = existingContext
        ? `${existingContext}\n\n${fileSummary}`
        : `### Candidate Uploaded Documents\n\nThe candidate has shared the following documents:\n\n${fileSummary}`;

      await SessionCache.setCandidateFilesSummary(sessionToken, newContext);
      console.log(`[CandidateFile] Updated session cache with candidate files summary (${newContext.length} chars)`);
    } else {
      console.warn(`[CandidateFile] Session not found in cache for token: ${sessionToken}`);
    }

    // Notify WebSocket clients
    broadcastToSession(sessionToken, WS_SERVER_EVENTS.FILE_READY, {
      fileId: file.id,
      filename: file.filename,
    });

    console.log(`Candidate file processed successfully: ${fileId}`);
  } catch (error) {
    console.error(`Candidate file processing error for ${fileId}:`, error);

    await db.candidateFile.update({
      where: { id: fileId },
      data: { status: 'error' },
    });

    throw error;
  }
}

export function startCandidateFileWorker(): void {
  const worker = new Worker<CandidateFileJobData>(
    QUEUE_NAMES.CANDIDATE_FILE_PROCESSING,
    processCandidateFile,
    {
      connection: getBullMQRedis(),
      concurrency: 3,
    }
  );

  worker.on('completed', (job) => {
    console.log(`Candidate file job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Candidate file job ${job?.id} failed:`, err);
  });

  console.log('Candidate file worker started');
}
