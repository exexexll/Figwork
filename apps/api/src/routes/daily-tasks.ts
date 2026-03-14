import { FastifyInstance } from 'fastify';
import { db } from '@figwork/db';
import { verifyClerkAuth } from '../lib/clerk.js';
import { notFound, forbidden } from '../lib/http-errors.js';
import { calculateMatch } from '../lib/task-matcher.js';
import { TIER_CONFIG } from '@figwork/shared';

const CAREER_MATCHING_URL = process.env.CAREER_MATCHING_URL || '';

function getEligibleTiers(tier: string): string[] {
  const order = ['novice', 'pro', 'elite'];
  const idx = Math.max(0, order.indexOf(tier));
  return order.slice(0, idx + 1);
}

async function getStudentOr403(request: any, reply: any) {
  const auth = await verifyClerkAuth(request, reply);
  if (!auth) return null;
  const student = await db.studentProfile.findUnique({ where: { clerkId: auth.userId } });
  if (!student) {
    forbidden(reply, 'Student profile required');
    return null;
  }
  return student;
}

async function scoreWithFallback(student: any, workUnit: any) {
  // Try external career matching service first if configured.
  if (CAREER_MATCHING_URL) {
    try {
      const res = await fetch(`${CAREER_MATCHING_URL}/match/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student: {
            id: student.id,
            tier: student.tier,
            skills: student.skillTags || [],
            specializations: student.specializations || [],
            totalExp: student.totalExp,
            tasksCompleted: student.tasksCompleted,
            avgQualityScore: student.avgQualityScore,
            revisionRate: student.revisionRate,
            onTimeRate: student.onTimeRate,
          },
          task: {
            id: workUnit.id,
            title: workUnit.title,
            category: workUnit.category,
            spec: workUnit.spec,
            requiredSkills: workUnit.requiredSkills || [],
            minTier: workUnit.minTier,
            complexityScore: workUnit.complexityScore,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json() as any;
        return {
          score: data.score || 0,
          recommendation: data.recommendation || 'good',
          eligible: data.eligible !== false,
          reasons: data.reasons || [],
        };
      }
    } catch {
      // Fall through to local matcher
    }
  }

  const match = await calculateMatch(
    {
      id: student.id,
      tier: student.tier,
      skillTags: student.skillTags || [],
      tasksCompleted: student.tasksCompleted,
      avgQualityScore: student.avgQualityScore,
      revisionRate: student.revisionRate,
      onTimeRate: student.onTimeRate,
      recentFailures: student.recentFailures,
    },
    {
      id: workUnit.id,
      category: workUnit.category,
      requiredSkills: workUnit.requiredSkills || [],
      minTier: workUnit.minTier,
      priceInCents: workUnit.priceInCents,
    }
  );

  const signals = await (db as any).skillSignal.findMany({
    where: { studentId: student.id, category: workUnit.category },
    orderBy: { updatedAt: 'desc' },
    take: 3,
  }).catch(() => []);
  const signalBoost = signals.length > 0
    ? Math.round(signals.reduce((sum: number, s: any) => sum + (s.score || 0), 0) / signals.length * 0.2)
    : 0;

  return {
    score: Math.min(100, match.score + signalBoost),
    recommendation: match.recommendation,
    eligible: match.eligible,
    reasons: match.factors?.map(f => f.reason).filter(Boolean) || [],
  };
}

export default async function dailyTaskRoutes(fastify: FastifyInstance) {
  fastify.get('/daily-tasks', async (request, reply) => {
    const student = await getStudentOr403(request, reply);
    if (!student) return;

    const tierConfig = TIER_CONFIG[student.tier as keyof typeof TIER_CONFIG];
    const workUnits = await (db.workUnit as any).findMany({
      where: {
        status: 'active',
        archivedAt: null,
        assignmentMode: 'auto',
        complexityScore: { lte: tierConfig.benefits.maxComplexity },
        minTier: { in: getEligibleTiers(student.tier) },
        NOT: {
          executions: {
            some: {
              studentId: student.id,
              status: { notIn: ['failed', 'cancelled'] },
            },
          },
        },
      },
      include: {
        company: { select: { companyName: true } },
        milestoneTemplates: true,
      },
      take: 25,
    });

    const scored = [];
    for (const wu of workUnits) {
      const match = await scoreWithFallback(student, wu);
      if (!match.eligible) continue;
      scored.push({
        ...wu,
        matchScore: match.score,
        dailyReasons: match.reasons.slice(0, 3),
        estimatedPayout: Math.round(wu.priceInCents * (1 - tierConfig.benefits.platformFeePercent)),
      });
    }

    scored.sort((a, b) => b.matchScore - a.matchScore);
    const tasks = scored.slice(0, 5);

    // Persist suggestions for the day
    const expiresAt = new Date();
    expiresAt.setHours(23, 59, 59, 999);
    try {
      for (const task of tasks) {
        await (db as any).dailyTaskAssignment.upsert({
          where: { studentId_workUnitId: { studentId: student.id, workUnitId: task.id } },
          update: { matchScore: task.matchScore, expiresAt, consumedAt: null },
          create: {
            studentId: student.id,
            workUnitId: task.id,
            source: 'matching',
            matchScore: task.matchScore,
            expiresAt,
          },
        }).catch((err: any) => {
          // Log but don't fail the request if persistence fails
          console.warn('Failed to persist daily task assignment:', err?.message || err);
        });
      }
    } catch (err: any) {
      // If model doesn't exist yet or table doesn't exist, just log and continue
      console.warn('DailyTaskAssignment persistence error (non-fatal):', err?.message || err);
    }

    return reply.send({ tasks, refreshedAt: new Date().toISOString() });
  });

  fastify.post<{ Params: { id: string } }>('/daily-tasks/:id/consume', async (request, reply) => {
    const student = await getStudentOr403(request, reply);
    if (!student) return;
    const { id } = request.params;
    await (db as any).dailyTaskAssignment.updateMany({
      where: { studentId: student.id, workUnitId: id },
      data: { consumedAt: new Date() },
    }).catch(() => null);
    return reply.send({ success: true });
  });
}
