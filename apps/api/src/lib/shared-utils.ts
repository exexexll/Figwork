/**
 * Shared utility functions used across multiple routes.
 * Extracted to avoid duplication.
 */

import { db } from '@figwork/db';
import { verifyClerkAuth } from './clerk.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

const ADMIN_USER_IDS = process.env.ADMIN_USER_IDS?.split(',') || [];

/**
 * Get tiers a student is eligible to work on based on their tier.
 * Elite can do all tiers, pro can do novice+pro, novice can only do novice.
 */
export function getEligibleTiers(studentTier: string): string[] {
  switch (studentTier) {
    case 'elite': return ['novice', 'pro', 'elite'];
    case 'pro': return ['novice', 'pro'];
    default: return ['novice'];
  }
}

/**
 * Calculate how well a student matches a work unit (0.5 - 1.0 score).
 */
export function calculateMatchScore(student: any, workUnit: any): number {
  let score = 0.5;
  
  // Skill matching: +0.1 per matching skill (up to 0.3)
  const matchingSkills = (workUnit.requiredSkills || []).filter((s: string) => 
    (student.skillTags || []).includes(s)
  );
  score += Math.min(matchingSkills.length * 0.1, 0.3);
  
  // Experience bonus
  if (student.tasksCompleted >= (workUnit.preferredHistory || 0)) score += 0.2;
  
  // Quality bonus
  if (student.avgQualityScore && student.avgQualityScore >= 0.8) score += 0.15;
  
  // On-time bonus
  if (student.onTimeRate && student.onTimeRate >= 0.95) score += 0.05;
  
  return Math.min(Math.max(score, 0.5), 1.0);
}

/**
 * Verify the request is from an admin user.
 */
export async function verifyAdmin(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const authResult = await verifyClerkAuth(request, reply);
  if (!authResult) return null;
  if (!ADMIN_USER_IDS.includes(authResult.userId)) {
    reply.status(403).send({ error: 'Admin access required' });
    return null;
  }
  return authResult.userId;
}
