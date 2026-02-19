import { db } from '@figwork/db';
import { DEFAULTS } from '@figwork/shared';

/**
 * Cleanup expired sessions and orphaned data
 * Runs periodically to maintain data hygiene
 */
export async function runCleanup(): Promise<void> {
  console.log('[Cleanup] Starting cleanup job...');
  const startTime = Date.now();

  try {
    // 1. Mark expired sessions as abandoned
    const expiredSessions = await db.interviewSession.updateMany({
      where: {
        tokenExpiresAt: { lt: new Date() },
        status: 'in_progress',
      },
      data: {
        status: 'abandoned',
      },
    });
    console.log(`[Cleanup] Marked ${expiredSessions.count} expired sessions as abandoned`);

    // 2. Clean up very old abandoned sessions (older than 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const oldAbandonedSessions = await db.interviewSession.findMany({
      where: {
        status: 'abandoned',
        createdAt: { lt: thirtyDaysAgo },
      },
      select: { id: true },
    });

    if (oldAbandonedSessions.length > 0) {
      // Delete related data first (cascades should handle this, but being explicit)
      await db.transcriptMessage.deleteMany({
        where: { sessionId: { in: oldAbandonedSessions.map(s => s.id) } },
      });
      await db.evaluationDecision.deleteMany({
        where: { sessionId: { in: oldAbandonedSessions.map(s => s.id) } },
      });
      await db.interviewSummary.deleteMany({
        where: { sessionId: { in: oldAbandonedSessions.map(s => s.id) } },
      });
      await db.candidateFile.deleteMany({
        where: { sessionId: { in: oldAbandonedSessions.map(s => s.id) } },
      });
      await db.interviewSession.deleteMany({
        where: { id: { in: oldAbandonedSessions.map(s => s.id) } },
      });
      console.log(`[Cleanup] Deleted ${oldAbandonedSessions.length} old abandoned sessions`);
    }

    // 3. Clean up orphaned knowledge files (status stuck in 'pending' for over 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orphanedFiles = await db.knowledgeFile.deleteMany({
      where: {
        status: 'pending',
        createdAt: { lt: oneDayAgo },
      },
    });
    console.log(`[Cleanup] Deleted ${orphanedFiles.count} orphaned knowledge files`);

    // 4. Clean up expired/inactive links with no sessions (older than 90 days)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const oldInactiveLinks = await db.interviewLink.deleteMany({
      where: {
        isActive: false,
        createdAt: { lt: ninetyDaysAgo },
        sessions: { none: {} },
      },
    });
    console.log(`[Cleanup] Deleted ${oldInactiveLinks.count} old inactive links with no sessions`);

    console.log(`[Cleanup] Completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error('[Cleanup] Error during cleanup:', error);
    throw error;
  }
}

/**
 * Start the periodic cleanup worker
 */
export function startCleanupWorker(): void {
  // Run immediately on startup
  runCleanup().catch(console.error);

  // Then run periodically
  const intervalMs = DEFAULTS.CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000;
  setInterval(() => {
    runCleanup().catch(console.error);
  }, intervalMs);

  console.log(`[Cleanup] Worker started, will run every ${DEFAULTS.CLEANUP_INTERVAL_HOURS} hour(s)`);
}
