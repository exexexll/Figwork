/**
 * Distributed locking using Redis
 * Prevents race conditions for concurrent operations
 */

import { getRedis } from './redis.js';
import crypto from 'crypto';

const redis = getRedis();

interface LockOptions {
  ttlMs?: number;       // Lock TTL in milliseconds (default: 30000)
  retryCount?: number;  // Number of retry attempts (default: 3)
  retryDelayMs?: number; // Delay between retries (default: 100)
}

const DEFAULT_OPTIONS: Required<LockOptions> = {
  ttlMs: 30000,
  retryCount: 3,
  retryDelayMs: 100,
};

/**
 * Acquire a distributed lock
 * Returns a release function if successful, null if lock couldn't be acquired
 */
export async function acquireLock(
  lockKey: string,
  options: LockOptions = {}
): Promise<(() => Promise<void>) | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lockId = crypto.randomBytes(16).toString('hex');
  const fullKey = `lock:${lockKey}`;

  for (let attempt = 0; attempt < opts.retryCount; attempt++) {
    // Try to set lock with NX (only if not exists) and PX (expiry in ms)
    const result = await redis.set(fullKey, lockId, 'PX', opts.ttlMs, 'NX');

    if (result === 'OK') {
      console.log(`[Lock] Acquired: ${lockKey}`);

      // Return release function
      const release = async () => {
        // Only release if we still own the lock (check lockId)
        const currentValue = await redis.get(fullKey);
        if (currentValue === lockId) {
          await redis.del(fullKey);
          console.log(`[Lock] Released: ${lockKey}`);
        } else {
          console.warn(`[Lock] Attempted to release lock we don't own: ${lockKey}`);
        }
      };

      return release;
    }

    // Wait before retry
    if (attempt < opts.retryCount - 1) {
      await new Promise(resolve => setTimeout(resolve, opts.retryDelayMs));
    }
  }

  console.warn(`[Lock] Failed to acquire after ${opts.retryCount} attempts: ${lockKey}`);
  return null;
}

/**
 * Execute a function with a distributed lock
 * Automatically acquires and releases the lock
 */
export async function withLock<T>(
  lockKey: string,
  fn: () => Promise<T>,
  options: LockOptions = {}
): Promise<{ success: true; result: T } | { success: false; error: 'LOCK_FAILED' }> {
  const release = await acquireLock(lockKey, options);

  if (!release) {
    return { success: false, error: 'LOCK_FAILED' };
  }

  try {
    const result = await fn();
    return { success: true, result };
  } finally {
    await release();
  }
}

/**
 * Check if a lock is currently held
 */
export async function isLocked(lockKey: string): Promise<boolean> {
  const result = await redis.exists(`lock:${lockKey}`);
  return result === 1;
}

/**
 * Extend a lock's TTL (for long-running operations)
 */
export async function extendLock(
  lockKey: string,
  lockId: string,
  additionalTtlMs: number
): Promise<boolean> {
  const fullKey = `lock:${lockKey}`;
  const currentValue = await redis.get(fullKey);
  
  if (currentValue === lockId) {
    await redis.pexpire(fullKey, additionalTtlMs);
    return true;
  }
  
  return false;
}
