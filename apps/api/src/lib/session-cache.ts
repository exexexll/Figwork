import { getRedis } from './redis.js';
import type { CachedSessionState, MessageRole, SessionStatus } from '@figwork/shared';
import { DEFAULTS } from '@figwork/shared';

const redis = getRedis();

export class SessionCache {
  private static TTL = DEFAULTS.SESSION_CACHE_TTL_SECONDS;

  static async get(sessionToken: string): Promise<CachedSessionState | null> {
    const data = await redis.get(`session:${sessionToken}`);
    return data ? JSON.parse(data) : null;
  }

  static async set(sessionToken: string, state: CachedSessionState): Promise<void> {
    await redis.setex(
      `session:${sessionToken}`,
      this.TTL,
      JSON.stringify(state)
    );
  }

  static async update(
    sessionToken: string,
    updates: Partial<CachedSessionState>
  ): Promise<CachedSessionState | null> {
    const current = await this.get(sessionToken);
    if (!current) return null;

    const updated = { ...current, ...updates };
    await this.set(sessionToken, updated);
    return updated;
  }

  // Add message to recent transcript (keep last N for context window)
  static async addMessage(
    sessionToken: string,
    role: MessageRole,
    content: string
  ): Promise<void> {
    const state = await this.get(sessionToken);
    if (!state) return;

    state.recentTranscript.push({
      role,
      content,
      timestamp: Date.now(),
    });

    // Keep only last N messages for current question context
    if (state.recentTranscript.length > DEFAULTS.TRANSCRIPT_CONTEXT_SIZE) {
      state.recentTranscript = state.recentTranscript.slice(-DEFAULTS.TRANSCRIPT_CONTEXT_SIZE);
    }

    await this.set(sessionToken, state);
  }

  // Clear transcript when advancing to next question
  static async advanceQuestion(sessionToken: string): Promise<CachedSessionState | null> {
    const state = await this.get(sessionToken);
    if (!state) return null;

    state.currentQuestionIndex += 1;
    state.followupsUsedCurrent = 0;
    state.recentTranscript = []; // Clear for new question context

    await this.set(sessionToken, state);
    return state;
  }

  static async incrementFollowup(sessionToken: string): Promise<CachedSessionState | null> {
    const state = await this.get(sessionToken);
    if (!state) return null;

    state.followupsUsedCurrent += 1;

    await this.set(sessionToken, state);
    return state;
  }

  static async updateStatus(sessionToken: string, status: SessionStatus): Promise<void> {
    const state = await this.get(sessionToken);
    if (!state) return;

    state.status = status;
    await this.set(sessionToken, state);
  }

  static async setCandidateFilesSummary(sessionToken: string, summary: string): Promise<void> {
    const state = await this.get(sessionToken);
    if (!state) return;

    state.candidateFilesSummary = summary;
    await this.set(sessionToken, state);
  }

  // Update the last message from a specific role (for additions)
  static async updateLastMessage(
    sessionToken: string,
    role: MessageRole,
    newContent: string
  ): Promise<void> {
    const state = await this.get(sessionToken);
    if (!state) return;

    // Find the last message with this role and update it
    for (let i = state.recentTranscript.length - 1; i >= 0; i--) {
      if (state.recentTranscript[i].role === role) {
        state.recentTranscript[i].content = newContent;
        break;
      }
    }

    await this.set(sessionToken, state);
  }

  static async invalidate(sessionToken: string): Promise<void> {
    await redis.del(`session:${sessionToken}`);
  }
}

// Initialize cache when session starts
export async function initializeSessionCache(
  sessionToken: string,
  session: {
    id: string;
    templateId: string;
    template: {
      questions: Array<{
        id: string;
        questionText: string;
        rubric: string | null;
        maxFollowups: number;
        orderIndex: number;
      }>;
    };
    candidateFiles?: Array<{
      filename: string;
      extractedText: string | null;
      status: string;
    }>;
  }
): Promise<CachedSessionState> {
  const sortedQuestions = [...session.template.questions].sort(
    (a, b) => a.orderIndex - b.orderIndex
  );

  // Build candidate files summary from already processed files
  let candidateFilesSummary: string | null = null;
  if (session.candidateFiles && session.candidateFiles.length > 0) {
    const processedFiles = session.candidateFiles.filter(
      f => f.status === 'ready' && f.extractedText
    );
    
    if (processedFiles.length > 0) {
      const fileSummaries = processedFiles.map(f => {
        const text = f.extractedText!;
        const truncated = text.length > 3000 ? text.slice(0, 3000) + '...[truncated]' : text;
        return `**${f.filename}**:\n${truncated}`;
      });
      
      candidateFilesSummary = `### Candidate Uploaded Documents\n\nThe candidate has shared the following documents:\n\n${fileSummaries.join('\n\n')}`;
      console.log(`[SessionCache] Loaded ${processedFiles.length} candidate files (${candidateFilesSummary.length} chars)`);
    }
  }

  const state: CachedSessionState = {
    sessionId: session.id,
    templateId: session.templateId,
    currentQuestionIndex: 0,
    followupsUsedCurrent: 0,
    status: 'in_progress',
    questions: sortedQuestions.map((q) => ({
      id: q.id,
      text: q.questionText,
      rubric: q.rubric,
      maxFollowups: q.maxFollowups,
    })),
    recentTranscript: [],
    candidateFilesSummary,
  };

  await SessionCache.set(sessionToken, state);
  return state;
}
