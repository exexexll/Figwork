import { db, Prisma } from '@figwork/db';
import { generateEmbedding } from '@figwork/ai';
import { DEFAULTS } from '@figwork/shared';

export async function retrieveKnowledgeChunks(
  templateId: string,
  query: string,
  topK: number = DEFAULTS.RAG_TOP_K
): Promise<Array<{ content: string; section: string | null; pageNumber: number | null; similarity: number }>> {
  try {
    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(query);
    const embeddingString = `[${queryEmbedding.join(',')}]`;

    console.log(`[RAG] Searching for template ${templateId} with query: "${query.slice(0, 50)}..."`);

    // Vector similarity search using pgvector
    // Use Prisma.raw for the embedding string to avoid escaping issues
    const chunks = await db.$queryRaw<
      Array<{
        id: string;
        content: string;
        page_number: number | null;
        section: string | null;
        similarity: number;
      }>
    >(Prisma.sql`
      SELECT 
        id, 
        content, 
        page_number, 
        section,
        1 - (embedding <=> ${Prisma.raw(`'${embeddingString}'`)}::vector) as similarity
      FROM knowledge_chunks
      WHERE template_id = ${templateId}::uuid
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${Prisma.raw(`'${embeddingString}'`)}::vector
      LIMIT ${topK}
    `);

    console.log(`[RAG] Found ${chunks.length} chunks`);

    return chunks.map((chunk) => ({
      content: chunk.content,
      section: chunk.section,
      pageNumber: chunk.page_number,
      similarity: chunk.similarity,
    }));
  } catch (error) {
    console.error('[RAG] Retrieval error:', error);
    return [];
  }
}

/**
 * Check if query is likely a candidate question
 */
export function isLikelyCandidateQuestion(input: string): boolean {
  const lowerInput = input.trim().toLowerCase();
  
  // Check for question marks
  if (input.includes('?')) return true;

  // Check for question words at start
  const questionWords = ['what', 'how', 'when', 'where', 'who', 'why', 'is', 'are', 'do', 'does', 'can', 'will', 'would', 'could', 'should'];
  const firstWord = lowerInput.split(/\s+/)[0];
  if (questionWords.includes(firstWord)) return true;

  // Check for common question phrases
  const questionPhrases = [
    'tell me about',
    'can you explain',
    'i was wondering',
    'i\'d like to know',
    'could you tell me',
    'what\'s it like',
    'how does',
    'what do you',
    'i\'m curious',
    'wondering if',
    'know more about',
    'interested in knowing',
    'explain to me',
  ];
  if (questionPhrases.some((phrase) => lowerInput.includes(phrase))) return true;

  // Check for question about topics
  const topicQuestions = [
    'the role', 'the position', 'the team', 'the company', 'the culture',
    'the process', 'next steps', 'the salary', 'the benefits', 'the schedule',
    'remote work', 'work from home', 'the office', 'the hours',
  ];
  if (topicQuestions.some((topic) => lowerInput.includes(topic))) return true;

  return false;
}

/**
 * Extract the core question from candidate input for better retrieval
 */
export function extractQuestionForRetrieval(input: string): string {
  const lowerInput = input.toLowerCase();
  
  // Remove common prefixes
  const prefixes = [
    'i was wondering',
    'i\'d like to know',
    'could you tell me',
    'can you explain',
    'tell me about',
    'what about',
    'how about',
  ];
  
  let cleaned = lowerInput;
  for (const prefix of prefixes) {
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length).trim();
      break;
    }
  }
  
  return cleaned || input;
}
