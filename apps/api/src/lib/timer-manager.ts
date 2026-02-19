/**
 * Server-side timer enforcement for interview sessions
 * Tracks active sessions and auto-ends them when time expires
 */

import { db } from '@figwork/db';
import { getRedis } from './redis.js';
import { WS_SERVER_EVENTS } from '@figwork/shared';

const redis = getRedis();

interface SessionTimer {
  sessionToken: string;
  sessionId: string;
  startTime: number;
  timeLimitMs: number;
  warningAt: number | null;
}

// Store timers in memory (backed by Redis for persistence)
const activeTimers: Map<string, NodeJS.Timeout> = new Map();
const warningTimers: Map<string, NodeJS.Timeout> = new Map();

/**
 * Start tracking a session timer
 */
export async function startSessionTimer(
  sessionToken: string,
  sessionId: string,
  timeLimitMinutes: number,
  onTimeWarning: () => void,
  onTimeExpired: () => Promise<void>
): Promise<void> {
  const timeLimitMs = timeLimitMinutes * 60 * 1000;
  const warningTime = timeLimitMs - 5 * 60 * 1000; // 5 minutes before end
  const startTime = Date.now();

  // Store in Redis for persistence across restarts
  const timerData: SessionTimer = {
    sessionToken,
    sessionId,
    startTime,
    timeLimitMs,
    warningAt: warningTime > 0 ? startTime + warningTime : null,
  };

  await redis.setex(
    `timer:${sessionToken}`,
    timeLimitMinutes * 60 + 60, // TTL slightly longer than session
    JSON.stringify(timerData)
  );

  // Set warning timer (5 minutes before end)
  if (warningTime > 0) {
    const warningTimer = setTimeout(() => {
      console.log(`[Timer] 5-minute warning for session ${sessionToken}`);
      onTimeWarning();
    }, warningTime);
    warningTimers.set(sessionToken, warningTimer);
  }

  // Set expiration timer
  const expirationTimer = setTimeout(async () => {
    console.log(`[Timer] Time expired for session ${sessionToken}`);
    await onTimeExpired();
    clearSessionTimer(sessionToken);
  }, timeLimitMs);
  activeTimers.set(sessionToken, expirationTimer);

  console.log(`[Timer] Started for session ${sessionToken}: ${timeLimitMinutes} minutes`);
}

/**
 * Get remaining time for a session
 */
export async function getRemainingTime(sessionToken: string): Promise<number | null> {
  const timerDataStr = await redis.get(`timer:${sessionToken}`);
  if (!timerDataStr) return null;

  try {
    const timerData: SessionTimer = JSON.parse(timerDataStr);
    const elapsed = Date.now() - timerData.startTime;
    const remaining = timerData.timeLimitMs - elapsed;
    return Math.max(0, remaining);
  } catch {
    return null;
  }
}

/**
 * Check if session time has expired (for validation)
 */
export async function isSessionTimeExpired(sessionToken: string): Promise<boolean> {
  const remaining = await getRemainingTime(sessionToken);
  return remaining !== null && remaining <= 0;
}

/**
 * Clear session timer
 */
export async function clearSessionTimer(sessionToken: string): Promise<void> {
  // Clear memory timers
  const expTimer = activeTimers.get(sessionToken);
  if (expTimer) {
    clearTimeout(expTimer);
    activeTimers.delete(sessionToken);
  }

  const warnTimer = warningTimers.get(sessionToken);
  if (warnTimer) {
    clearTimeout(warnTimer);
    warningTimers.delete(sessionToken);
  }

  // Clear Redis
  await redis.del(`timer:${sessionToken}`);

  console.log(`[Timer] Cleared for session ${sessionToken}`);
}

/**
 * Restore timers on server restart (call during startup)
 */
export async function restoreTimers(
  getSocket: (sessionToken: string) => any,
  endSession: (sessionToken: string) => Promise<void>
): Promise<void> {
  try {
    const keys = await redis.keys('timer:*');
    console.log(`[Timer] Restoring ${keys.length} session timers...`);

    for (const key of keys) {
      const sessionToken = key.replace('timer:', '');
      const timerDataStr = await redis.get(key);
      
      if (!timerDataStr) continue;

      try {
        const timerData: SessionTimer = JSON.parse(timerDataStr);
        const elapsed = Date.now() - timerData.startTime;
        const remaining = timerData.timeLimitMs - elapsed;

        if (remaining <= 0) {
          // Session already expired, end it
          console.log(`[Timer] Session ${sessionToken} expired during downtime, ending...`);
          await endSession(sessionToken);
          await redis.del(key);
          continue;
        }

        // Restore timers with remaining time
        const socket = getSocket(sessionToken);
        
        // Warning timer
        if (timerData.warningAt) {
          const warningRemaining = timerData.warningAt - Date.now();
          if (warningRemaining > 0) {
            const warningTimer = setTimeout(() => {
              if (socket) {
                socket.emit(WS_SERVER_EVENTS.TIME_WARNING, { remainingMs: 5 * 60 * 1000 });
              }
            }, warningRemaining);
            warningTimers.set(sessionToken, warningTimer);
          }
        }

        // Expiration timer
        const expirationTimer = setTimeout(async () => {
          if (socket) {
            socket.emit(WS_SERVER_EVENTS.TIME_EXPIRED);
          }
          await endSession(sessionToken);
          clearSessionTimer(sessionToken);
        }, remaining);
        activeTimers.set(sessionToken, expirationTimer);

        console.log(`[Timer] Restored session ${sessionToken}: ${Math.round(remaining / 1000)}s remaining`);
      } catch (parseError) {
        console.error(`[Timer] Error parsing timer data for ${sessionToken}:`, parseError);
        await redis.del(key);
      }
    }
  } catch (error) {
    console.error('[Timer] Error restoring timers:', error);
  }
}

/**
 * Extend session time (for edge cases)
 */
export async function extendSessionTime(
  sessionToken: string,
  additionalMinutes: number
): Promise<boolean> {
  const timerDataStr = await redis.get(`timer:${sessionToken}`);
  if (!timerDataStr) return false;

  try {
    const timerData: SessionTimer = JSON.parse(timerDataStr);
    timerData.timeLimitMs += additionalMinutes * 60 * 1000;
    
    await redis.setex(
      `timer:${sessionToken}`,
      Math.ceil(timerData.timeLimitMs / 1000) + 60,
      JSON.stringify(timerData)
    );

    // Reset expiration timer
    const expTimer = activeTimers.get(sessionToken);
    if (expTimer) {
      clearTimeout(expTimer);
    }

    const remaining = timerData.timeLimitMs - (Date.now() - timerData.startTime);
    // Note: Would need to pass endSession callback to properly set new timer
    
    console.log(`[Timer] Extended session ${sessionToken} by ${additionalMinutes} minutes`);
    return true;
  } catch {
    return false;
  }
}
