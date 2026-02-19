import { Worker, Job } from 'bullmq';
import { db, Prisma } from '@figwork/db';
import { generateEmbeddings } from '@figwork/ai';
import { getBullMQRedis } from '../lib/redis.js';
import { downloadFile } from '../lib/cloudinary.js';
import { validateFile, scanTextContent } from '../lib/file-validator.js';
import { QUEUE_NAMES, DEFAULTS } from '@figwork/shared';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

interface KnowledgeJobData {
  fileId: string;
  cloudinaryUrl: string;
  fileType: string;
  ownerId: string;
  templateId: string;
}

/**
 * Extract text from various file formats
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
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

/**
 * Chunk text into smaller pieces for embedding
 */
function chunkText(
  text: string,
  options: {
    minTokens: number;
    maxTokens: number;
    overlapTokens: number;
  }
): Array<{ content: string; tokenCount: number; section?: string; pageNumber?: number }> {
  const { minTokens, maxTokens, overlapTokens } = options;

  // Simple token estimation (roughly 4 chars per token)
  const estimateTokens = (str: string) => Math.ceil(str.length / 4);

  // Split into paragraphs
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  const chunks: Array<{ content: string; tokenCount: number }> = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph);

    // If paragraph alone exceeds max, split it further
    if (paragraphTokens > maxTokens) {
      // Flush current chunk if any
      if (currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          tokenCount: estimateTokens(currentChunk.trim()),
        });
        currentChunk = '';
      }

      // Split paragraph by sentences
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      let sentenceChunk = '';

      for (const sentence of sentences) {
        const combined = sentenceChunk + ' ' + sentence;
        if (estimateTokens(combined.trim()) <= maxTokens) {
          sentenceChunk = combined;
        } else {
          if (sentenceChunk.trim()) {
            chunks.push({
              content: sentenceChunk.trim(),
              tokenCount: estimateTokens(sentenceChunk.trim()),
            });
          }
          sentenceChunk = sentence;
        }
      }

      if (sentenceChunk.trim()) {
        currentChunk = sentenceChunk;
      }
      continue;
    }

    // Try adding paragraph to current chunk
    const combined = currentChunk + '\n\n' + paragraph;
    const combinedTokens = estimateTokens(combined.trim());

    if (combinedTokens <= maxTokens) {
      currentChunk = combined;
    } else {
      // Current chunk is full, save it
      if (currentChunk.trim() && estimateTokens(currentChunk.trim()) >= minTokens) {
        chunks.push({
          content: currentChunk.trim(),
          tokenCount: estimateTokens(currentChunk.trim()),
        });

        // Start new chunk with overlap
        const words = currentChunk.trim().split(/\s+/);
        const overlapWords = Math.ceil(overlapTokens * 0.75); // Approximate words from tokens
        const overlap = words.slice(-overlapWords).join(' ');
        currentChunk = overlap + '\n\n' + paragraph;
      } else {
        currentChunk = paragraph;
      }
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim() && estimateTokens(currentChunk.trim()) >= minTokens / 2) {
    chunks.push({
      content: currentChunk.trim(),
      tokenCount: estimateTokens(currentChunk.trim()),
    });
  }

  return chunks;
}

async function processKnowledgeFile(job: Job<KnowledgeJobData>): Promise<void> {
  const { fileId, cloudinaryUrl, fileType, ownerId, templateId } = job.data;

  console.log(`[Knowledge] Processing file: ${fileId}`);
  console.log(`[Knowledge] Template: ${templateId}, Type: ${fileType}`);
  console.log(`[Knowledge] URL: ${cloudinaryUrl}`);

  try {
    // Update status to processing
    await db.knowledgeFile.update({
      where: { id: fileId },
      data: { status: 'processing' },
    });

    // Get file details
    const file = await db.knowledgeFile.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new Error('Knowledge file not found');
    }

    // Download file from Cloudinary
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
      console.warn(`Knowledge file validation failed for ${fileId}: ${validationResult.error}`);
      await db.knowledgeFile.update({
        where: { id: fileId },
        data: { status: 'error' },
      });
      throw new Error(`File validation failed: ${validationResult.error}`);
    }

    if (validationResult.warnings && validationResult.warnings.length > 0) {
      console.warn(`Knowledge file validation warnings for ${fileId}:`, validationResult.warnings);
    }

    // Extract text
    const text = await extractText(buffer, fileType);
    console.log(`Extracted text: ${text.length} chars`);

    // **SECURITY: Scan extracted text for dangerous content**
    const contentScanResult = scanTextContent(text);
    if (!contentScanResult.valid) {
      console.warn(`Knowledge content scan failed for ${fileId}: ${contentScanResult.error}`);
      await db.knowledgeFile.update({
        where: { id: fileId },
        data: { status: 'error' },
      });
      throw new Error(`Content scan failed: ${contentScanResult.error}`);
    }

    // Chunk text
    const chunks = chunkText(text, {
      minTokens: DEFAULTS.CHUNK_MIN_TOKENS,
      maxTokens: DEFAULTS.CHUNK_MAX_TOKENS,
      overlapTokens: DEFAULTS.CHUNK_OVERLAP_TOKENS,
    });
    console.log(`Created ${chunks.length} chunks`);

    if (chunks.length === 0) {
      throw new Error('No chunks generated from document');
    }

    // Generate embeddings in batch
    console.log(`[Knowledge] Generating embeddings for ${chunks.length} chunks...`);
    const embeddings = await generateEmbeddings(chunks.map((c) => c.content));
    console.log(`[Knowledge] Generated ${embeddings.length} embeddings (dim: ${embeddings[0]?.length})`);

    // Store chunks in database
    console.log(`[Knowledge] Inserting ${chunks.length} chunks into database...`);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];

      // Insert chunk with embedding using raw SQL for vector type
      // Use Prisma.sql for proper parameterization with vectors
      const embeddingStr = `[${embedding.join(',')}]`;
      try {
        await db.$executeRaw(Prisma.sql`
          INSERT INTO knowledge_chunks (
            id, file_id, owner_id, template_id, content, token_count, embedding, created_at
          ) VALUES (
            gen_random_uuid(),
            ${fileId}::uuid,
            ${ownerId}::uuid,
            ${templateId}::uuid,
            ${chunk.content},
            ${chunk.tokenCount},
            ${Prisma.raw(`'${embeddingStr}'`)}::vector,
            NOW()
          )
        `);
      } catch (insertError) {
        console.error(`[Knowledge] Error inserting chunk ${i + 1}:`, insertError);
        throw insertError;
      }
    }
    console.log(`[Knowledge] Successfully inserted ${chunks.length} chunks`);

    // Update file status to ready
    await db.knowledgeFile.update({
      where: { id: fileId },
      data: { status: 'ready' },
    });

    console.log(`Knowledge file processed successfully: ${fileId}`);
  } catch (error) {
    console.error(`Knowledge processing error for ${fileId}:`, error);

    await db.knowledgeFile.update({
      where: { id: fileId },
      data: { status: 'error' },
    });

    throw error;
  }
}

export function startKnowledgeWorker(): void {
  const worker = new Worker<KnowledgeJobData>(
    QUEUE_NAMES.KNOWLEDGE_PROCESSING,
    processKnowledgeFile,
    {
      connection: getBullMQRedis(),
      concurrency: 2,
    }
  );

  worker.on('completed', (job) => {
    console.log(`Knowledge job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Knowledge job ${job?.id} failed:`, err);
  });

  console.log('Knowledge worker started');
}
