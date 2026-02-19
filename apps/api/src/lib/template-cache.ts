/**
 * Redis-based template caching for hot templates
 * Reduces database load for frequently accessed templates
 */

import { db } from '@figwork/db';
import { getRedis } from './redis.js';

const redis = getRedis();
const CACHE_TTL = 300; // 5 minutes
const CACHE_PREFIX = 'template:';

interface CachedTemplate {
  id: string;
  ownerId: string;
  name: string;
  personaPrompt: string;
  toneGuidance: string | null;
  globalFollowupLimit: number;
  timeLimitMinutes: number;
  questions: Array<{
    id: string;
    questionText: string;
    rubric: string | null;
    maxFollowups: number;
    askVerbatim: boolean;
    orderIndex: number;
  }>;
}

/**
 * Get template from cache or database
 */
export async function getCachedTemplate(templateId: string): Promise<CachedTemplate | null> {
  const cacheKey = `${CACHE_PREFIX}${templateId}`;

  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    console.log(`[TemplateCache] HIT: ${templateId}`);
    return JSON.parse(cached);
  }

  // Cache miss, fetch from database
  console.log(`[TemplateCache] MISS: ${templateId}`);
  const template = await db.interviewTemplate.findUnique({
    where: { id: templateId },
    include: {
      questions: {
        orderBy: { orderIndex: 'asc' },
      },
    },
  });

  if (!template) return null;

  // Build cache object
  const cachedTemplate: CachedTemplate = {
    id: template.id,
    ownerId: template.ownerId,
    name: template.name,
    personaPrompt: template.personaPrompt,
    toneGuidance: template.toneGuidance,
    globalFollowupLimit: template.globalFollowupLimit,
    timeLimitMinutes: template.timeLimitMinutes,
    questions: template.questions.map((q) => ({
      id: q.id,
      questionText: q.questionText,
      rubric: q.rubric,
      maxFollowups: q.maxFollowups,
      askVerbatim: q.askVerbatim,
      orderIndex: q.orderIndex,
    })),
  };

  // Store in cache
  await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(cachedTemplate));

  return cachedTemplate;
}

/**
 * Invalidate template cache (call when template is updated)
 */
export async function invalidateTemplateCache(templateId: string): Promise<void> {
  const cacheKey = `${CACHE_PREFIX}${templateId}`;
  await redis.del(cacheKey);
  console.log(`[TemplateCache] Invalidated: ${templateId}`);
}

/**
 * Invalidate all templates for an owner (call when bulk changes are made)
 */
export async function invalidateOwnerTemplatesCache(ownerId: string): Promise<void> {
  // Get all templates for owner
  const templates = await db.interviewTemplate.findMany({
    where: { ownerId },
    select: { id: true },
  });

  // Invalidate each
  const keys = templates.map((t) => `${CACHE_PREFIX}${t.id}`);
  if (keys.length > 0) {
    await redis.del(...keys);
    console.log(`[TemplateCache] Invalidated ${keys.length} templates for owner ${ownerId}`);
  }
}

/**
 * Warm cache for frequently used templates
 * Call during startup or periodically
 */
export async function warmTemplateCache(limit: number = 100): Promise<void> {
  console.log(`[TemplateCache] Warming cache for top ${limit} templates...`);

  // Get most recently used templates (via sessions)
  const recentSessions = await db.interviewSession.findMany({
    where: {
      createdAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      },
    },
    select: { templateId: true },
    distinct: ['templateId'],
    take: limit,
  });

  const templateIds = recentSessions.map((s) => s.templateId);

  // Pre-fetch and cache
  for (const templateId of templateIds) {
    await getCachedTemplate(templateId);
  }

  console.log(`[TemplateCache] Warmed ${templateIds.length} templates`);
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  totalCached: number;
  memoryUsage: string;
}> {
  const keys = await redis.keys(`${CACHE_PREFIX}*`);
  const info = await redis.info('memory');
  const memMatch = info.match(/used_memory_human:(\S+)/);
  
  return {
    totalCached: keys.length,
    memoryUsage: memMatch ? memMatch[1] : 'unknown',
  };
}
