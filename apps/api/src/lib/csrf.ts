/**
 * CSRF Protection middleware
 * Generates and validates CSRF tokens for state-changing requests
 */

import crypto from 'crypto';
import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { getRedis } from './redis.js';

const redis = getRedis();
const CSRF_TOKEN_TTL = 3600; // 1 hour
const CSRF_HEADER = 'x-csrf-token';

/**
 * Generate a CSRF token for a user session
 */
export async function generateCsrfToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await redis.setex(`csrf:${userId}`, CSRF_TOKEN_TTL, token);
  return token;
}

/**
 * Validate a CSRF token
 */
export async function validateCsrfToken(userId: string, token: string): Promise<boolean> {
  const storedToken = await redis.get(`csrf:${userId}`);
  if (!storedToken) return false;
  
  // Use timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(storedToken),
      Buffer.from(token)
    );
  } catch {
    return false;
  }
}

/**
 * Middleware to validate CSRF token on state-changing requests
 * Should be used after authentication middleware
 */
export async function validateCsrf(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip for safe methods
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(request.method)) {
    return;
  }

  // Skip for public endpoints (interview routes for candidates)
  if (request.url.startsWith('/api/interview/')) {
    return;
  }

  // Skip if no user (public endpoints)
  if (!(request as any).user?.id) {
    return;
  }

  const userId = (request as any).user.id;
  const csrfToken = request.headers[CSRF_HEADER] as string;

  if (!csrfToken) {
    return reply.status(403).send({
      success: false,
      error: 'Missing CSRF token',
      code: 'CSRF_MISSING',
    });
  }

  const isValid = await validateCsrfToken(userId, csrfToken);
  if (!isValid) {
    return reply.status(403).send({
      success: false,
      error: 'Invalid CSRF token',
      code: 'CSRF_INVALID',
    });
  }
}

/**
 * Invalidate CSRF token (on logout or token refresh)
 */
export async function invalidateCsrfToken(userId: string): Promise<void> {
  await redis.del(`csrf:${userId}`);
}

/**
 * Refresh CSRF token (call periodically or on sensitive actions)
 */
export async function refreshCsrfToken(userId: string): Promise<string> {
  await invalidateCsrfToken(userId);
  return generateCsrfToken(userId);
}
