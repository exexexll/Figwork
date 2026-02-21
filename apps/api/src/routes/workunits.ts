import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db, Prisma } from '@figwork/db';
import { getOpenAIClient } from '@figwork/ai';
import { PRICING_CONFIG, TIER_CONFIG } from '@figwork/shared';
import { verifyClerkAuth } from '../lib/clerk.js';
import { unauthorized, forbidden, notFound, badRequest, internalError } from '../lib/http-errors.js';
import { analyzeTaskForImprovements } from '../lib/task-improvements.js';

interface CreateWorkUnitBody {
  title: string;
  spec: string;
  category: string;
  priceInCents: number;
  deadlineHours: number;
  acceptanceCriteria: Array<{ criterion: string; required: boolean }>;
  deliverableFormat: string[];
  requiredSkills?: string[];
  requiredDocuments?: string[];
  requiredFields?: Record<string, any>;
  revisionLimit?: number;
  complexityScore?: number;
  minTier?: 'novice' | 'pro' | 'elite';
  preferredHistory?: number;
  maxRevisionTendency?: number;
  exampleUrls?: string[];
  infoCollectionTemplateId?: string;
  assignmentMode?: 'auto' | 'manual';
  milestones?: Array<{ description: string; expectedCompletion: number }>;
}

interface UpdateWorkUnitBody {
  title?: string;
  spec?: string;
  category?: string;
  priceInCents?: number;
  deadlineHours?: number;
  acceptanceCriteria?: Array<{ criterion: string; required: boolean }>;
  deliverableFormat?: string[];
  requiredSkills?: string[];
  revisionLimit?: number;
  complexityScore?: number;
  minTier?: 'novice' | 'pro' | 'elite';
  assignmentMode?: 'auto' | 'manual';
  infoCollectionTemplateId?: string | null;
  status?: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
  exampleUrls?: string[];
}

export async function workUnitRoutes(fastify: FastifyInstance) {
  // Middleware: Attach company profile to request
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const user = await db.user.findUnique({
      where: { clerkId: authResult.userId },
      include: { companyProfile: true },
    });

    if (!user?.companyProfile) {
      return forbidden(reply, 'Company profile required');
    }

    (request as any).company = user.companyProfile;
  });

  // POST / - Create new work unit
  fastify.post<{ Body: CreateWorkUnitBody }>(
    '/',
    async (request, reply) => {
      const company = (request as any).company;
      const {
        title,
        spec,
        category,
        priceInCents,
        deadlineHours,
        acceptanceCriteria,
        deliverableFormat,
        requiredSkills,
        requiredDocuments,
        requiredFields,
        revisionLimit,
        complexityScore,
        minTier,
        preferredHistory,
        maxRevisionTendency,
        exampleUrls,
        infoCollectionTemplateId,
        assignmentMode,
        milestones,
      } = request.body;

      // AI-driven clarity scoring
      let clarityScore: number = 3;
      let clarityIssues: string[] = [];

      try {
        const openai = getOpenAIClient();
        const clarityPrompt = `Analyze this work unit specification for clarity. Score 1-5 (5 = crystal clear).

Title: ${title}
Category: ${category}
Specification: ${spec}
Acceptance Criteria: ${JSON.stringify(acceptanceCriteria)}
Deliverable Format: ${deliverableFormat.join(', ')}
Has Examples: ${(exampleUrls || []).length > 0}

Return JSON: {
  "score": number,
  "issues": ["issue1", "issue2"],
  "suggestions": ["suggestion1"]
}`;

        const response = await openai.chat.completions.create({
          model: 'gpt-5.2',
          messages: [{ role: 'user', content: clarityPrompt }],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_completion_tokens: 300,
        });

        const analysis = JSON.parse(response.choices[0].message.content || '{}');
        clarityScore = analysis.score || 3;
        clarityIssues = analysis.issues || [];

        if (clarityScore < 2) {
          return reply.status(400).send({
            success: false,
            error: 'Work unit specification is too unclear',
            clarityScore,
            issues: clarityIssues,
            suggestions: analysis.suggestions || [],
          });
        }
      } catch (error) {
        console.error('Clarity analysis failed:', error);
        clarityScore = 3;
      }

      const platformFeePercent = PRICING_CONFIG.platformFees[minTier as keyof typeof PRICING_CONFIG.platformFees] || 0.15;

      const workUnit = await db.workUnit.create({
        data: {
          companyId: company.id,
          title,
          spec,
          category,
          priceInCents,
          deadlineHours,
          acceptanceCriteria: acceptanceCriteria as Prisma.InputJsonValue,
          deliverableFormat,
          requiredSkills: requiredSkills || [],
          requiredDocuments: requiredDocuments || [],
          requiredFields: requiredFields as Prisma.InputJsonValue ?? Prisma.JsonNull,
          revisionLimit: revisionLimit ?? 2,
          complexityScore: complexityScore ?? 1,
          minTier: minTier ?? 'novice',
          preferredHistory: preferredHistory ?? 0,
          maxRevisionTendency: maxRevisionTendency ?? 0.3,
          clarityScore,
          clarityIssues: clarityIssues.length > 0 ? clarityIssues : Prisma.JsonNull,
          hasExamples: (exampleUrls || []).length > 0,
          exampleUrls: exampleUrls || [],
          infoCollectionTemplateId,
          assignmentMode: assignmentMode ?? 'auto',
          platformFeePercent,
          status: 'draft',
          milestoneTemplates: {
            create: (milestones || []).map((m, idx) => ({
              orderIndex: idx,
              description: m.description,
              expectedCompletion: m.expectedCompletion,
            })),
          },
        },
        include: {
          milestoneTemplates: { orderBy: { orderIndex: 'asc' } },
        },
      });

      const feeInCents = Math.round(priceInCents * platformFeePercent);
      await db.escrow.create({
        data: {
          workUnitId: workUnit.id,
          companyId: company.id,
          amountInCents: priceInCents,
          platformFeeInCents: feeInCents,
          netAmountInCents: priceInCents - feeInCents,
          status: 'pending',
        },
      });

      return reply.status(201).send(workUnit);
    }
  );

  // GET / - List company's work units
  fastify.get('/', async (request, reply) => {
    const company = (request as any).company;
    const { status, category } = request.query as { status?: string; category?: string };

    const workUnits = await db.workUnit.findMany({
      where: {
        companyId: company.id,
        ...(status && { status }),
        ...(category && { category }),
      },
      include: {
        milestoneTemplates: { orderBy: { orderIndex: 'asc' } },
        escrow: true,
        _count: {
          select: { executions: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send(workUnits);
  });

  // GET /:id
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    async (request, reply) => {
      const company = (request as any).company;
      const { id } = request.params;

      const workUnit = await db.workUnit.findFirst({
        where: { id, companyId: company.id },
        include: {
          milestoneTemplates: { orderBy: { orderIndex: 'asc' } },
          escrow: true,
          executions: {
            include: {
              student: {
                select: { id: true, name: true, email: true, tier: true, avgQualityScore: true },
              },
              milestones: true,
              qaCheck: true,
            },
            orderBy: { assignedAt: 'desc' },
          },
          defectAnalyses: { orderBy: { analyzedAt: 'desc' }, take: 5 },
        },
      });

      if (!workUnit) {
        return notFound(reply, 'Work unit not found');
      }

      return reply.send(workUnit);
    }
  );

  // PUT /:id
  fastify.put<{ Params: { id: string }; Body: UpdateWorkUnitBody }>(
    '/:id',
    async (request, reply) => {
      const company = (request as any).company;
      const { id } = request.params;
      const updates = request.body;

      const existing = await db.workUnit.findFirst({
        where: { id, companyId: company.id },
        include: { escrow: true },
      });

      if (!existing) {
        return notFound(reply, 'Work unit not found');
      }

      if (existing.status === 'active') {
        const activeExecutions = await db.execution.count({
          where: {
            workUnitId: id,
            status: { notIn: ['approved', 'failed', 'cancelled'] },
          },
        });
        if (activeExecutions > 0 && (updates.spec || updates.priceInCents || updates.deadlineHours)) {
          return badRequest(reply, 'Cannot modify critical fields while executions are in progress');
        }
      }

      let clarityScore = existing.clarityScore;
      let clarityIssues = existing.clarityIssues;

      if (updates.spec && updates.spec !== existing.spec) {
        try {
          const openai = getOpenAIClient();
          const response = await openai.chat.completions.create({
            model: 'gpt-5.2',
            messages: [{
              role: 'user',
              content: `Rate clarity 1-5: "${updates.spec}". Return JSON: {"score": number, "issues": []}`
            }],
            response_format: { type: 'json_object' },
            max_completion_tokens: 150,
          });
          const analysis = JSON.parse(response.choices[0].message.content || '{}');
          clarityScore = analysis.score || clarityScore;
          clarityIssues = analysis.issues || clarityIssues;

          if (clarityScore && clarityScore < 2 && updates.status === 'active') {
            return reply.status(400).send({
              success: false,
              error: 'Cannot activate work unit with low clarity score',
              clarityScore,
              issues: clarityIssues,
            });
          }
        } catch (error) {
          console.error('Re-analysis failed:', error);
        }
      }

      if (updates.status === 'active' && existing.status !== 'active') {
        if (!existing.escrow || existing.escrow.status !== 'funded') {
          return badRequest(reply, 'Escrow must be funded before activating');
        }
      }

      const updated = await db.workUnit.update({
        where: { id },
        data: {
          ...updates,
          acceptanceCriteria: updates.acceptanceCriteria as Prisma.InputJsonValue,
          clarityScore,
          clarityIssues: clarityIssues as Prisma.InputJsonValue ?? existing.clarityIssues,
          hasExamples: updates.exampleUrls ? updates.exampleUrls.length > 0 : existing.hasExamples,
          ...(updates.status === 'active' && !existing.publishedAt && { publishedAt: new Date() }),
        },
        include: {
          milestoneTemplates: { orderBy: { orderIndex: 'asc' } },
          escrow: true,
        },
      });

      // Sync escrow if price changed
      if (updates.priceInCents && updates.priceInCents !== existing.priceInCents) {
        const feePercent = updated.platformFeePercent || 0.15;
        const fee = Math.round(updates.priceInCents * feePercent);
        await db.escrow.updateMany({
          where: { workUnitId: id },
          data: { amountInCents: updates.priceInCents, platformFeeInCents: fee, netAmountInCents: updates.priceInCents - fee },
        });
      }

      // Sync escrow on status change
      if (updates.status === 'cancelled' && existing.status !== 'cancelled') {
        await db.escrow.updateMany({ where: { workUnitId: id, status: { in: ['pending', 'funded'] } }, data: { status: 'refunded', releasedAt: new Date() } });
      }

      // Reload with updated escrow
      const refreshed = await db.workUnit.findUnique({ where: { id }, include: { milestoneTemplates: { orderBy: { orderIndex: 'asc' } }, escrow: true } });
      return reply.send(refreshed);
    }
  );

  // DELETE /:id
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    async (request, reply) => {
      const company = (request as any).company;
      const { id } = request.params;

      const workUnit = await db.workUnit.findFirst({
        where: { id, companyId: company.id },
        include: { executions: true, escrow: true },
      });

      if (!workUnit) {
        return notFound(reply, 'Work unit not found');
      }

      // Block only if actively running executions
      const activeExecs = workUnit.executions.filter((e: any) => ['assigned', 'clocked_in', 'submitted', 'revision_needed'].includes(e.status));
      if (activeExecs.length > 0) {
        return badRequest(reply, `Cannot delete — ${activeExecs.length} active execution(s). Cancel them first.`);
      }

      // Clean up all related records
      for (const exec of workUnit.executions) {
        await db.proofOfWorkLog.deleteMany({ where: { executionId: exec.id } });
        await db.revisionRequest.deleteMany({ where: { executionId: exec.id } });
        await db.taskMilestone.deleteMany({ where: { executionId: exec.id } });
        await db.dispute.deleteMany({ where: { executionId: exec.id } });
      }
      await db.execution.deleteMany({ where: { workUnitId: id } });
      await db.milestoneTemplate.deleteMany({ where: { workUnitId: id } });
      await db.defectAnalysis.deleteMany({ where: { workUnitId: id } });
      await db.agentConversation.deleteMany({ where: { workUnitId: id } });
      if (workUnit.escrow) await db.escrow.delete({ where: { id: workUnit.escrow.id } });

      await db.workUnit.delete({ where: { id } });
      return reply.status(204).send();
    }
  );

  // POST /:id/fund-escrow
  fastify.post<{ Params: { id: string }; Body: { confirm: boolean } }>(
    '/:id/fund-escrow',
    async (request, reply) => {
      const company = (request as any).company;
      const { id } = request.params;

      if (!request.body.confirm) {
        return badRequest(reply, 'Confirmation required');
      }

      const workUnit = await db.workUnit.findFirst({
        where: { id, companyId: company.id },
        include: { escrow: true },
      });

      if (!workUnit) {
        return notFound(reply, 'Work unit not found');
      }

      if (!workUnit.escrow) {
        return internalError(reply, 'Escrow account missing');
      }

      if (workUnit.escrow.status === 'funded') {
        return badRequest(reply, 'Escrow already funded');
      }

      const now = new Date();
      const budgetPeriod = await db.budgetPeriod.findUnique({
        where: {
          companyId_month_year: {
            companyId: company.id,
            month: now.getMonth() + 1,
            year: now.getFullYear(),
          },
        },
      });

      if (budgetPeriod?.budgetCapInCents) {
        const projectedSpend = budgetPeriod.totalEscrowedInCents + workUnit.priceInCents;
        if (projectedSpend > budgetPeriod.budgetCapInCents) {
          return reply.status(400).send({
            success: false,
            error: 'Would exceed monthly budget cap',
            budgetRemaining: budgetPeriod.budgetCapInCents - budgetPeriod.totalEscrowedInCents,
            required: workUnit.priceInCents,
          });
        }
      }

      // Create Stripe payment intent for escrow
      let stripePaymentIntentId = `pi_${Date.now()}_${workUnit.id.slice(0, 8)}`;
      try {
        const { createEscrowPaymentIntent } = await import('../lib/stripe-service.js');
        const stripeResult = await createEscrowPaymentIntent({
          amountInCents: workUnit.priceInCents,
          customerId: company.stripeCustomerId || '',
          workUnitId: workUnit.id,
          companyId: company.id,
        });
        stripePaymentIntentId = stripeResult.paymentIntentId;
      } catch (stripeErr) {
        fastify.log.warn('Stripe escrow payment skipped (not configured or failed)');
      }

      const escrow = await db.escrow.update({
        where: { id: workUnit.escrow.id },
        data: {
          status: 'funded',
          fundedAt: new Date(),
          stripePaymentIntentId,
        },
      });

      if (budgetPeriod) {
        await db.budgetPeriod.update({
          where: { id: budgetPeriod.id },
          data: {
            totalEscrowedInCents: { increment: workUnit.priceInCents },
            tasksPosted: { increment: 1 },
          },
        });
      }

      await db.paymentTransaction.create({
        data: {
          companyId: company.id,
          type: 'escrow_funding',
          workUnitId: workUnit.id,
          amountInCents: workUnit.priceInCents,
          feeInCents: workUnit.escrow.platformFeeInCents,
          netAmountInCents: workUnit.escrow.netAmountInCents,
          direction: 'debit',
          status: 'completed',
          description: `Escrow funding for: ${workUnit.title}`,
        },
      });

      return reply.send(escrow);
    }
  );

  // GET /:id/milestones
  fastify.get<{ Params: { id: string } }>(
    '/:id/milestones',
    async (request, reply) => {
      const company = (request as any).company;
      const { id } = request.params;

      const milestones = await db.milestoneTemplate.findMany({
        where: { workUnitId: id, workUnit: { companyId: company.id } },
        orderBy: { orderIndex: 'asc' },
      });

      return reply.send(milestones);
    }
  );

  // GET /:id/candidates - Get matched students for a work unit
  fastify.get<{ Params: { id: string } }>(
    '/:id/candidates',
    async (request, reply) => {
      const company = (request as any).company;
      const { id } = request.params;

      const workUnit = await db.workUnit.findFirst({
        where: { id, companyId: company.id },
      });

      if (!workUnit) {
        return notFound(reply, 'Work unit not found');
      }

      const eligibleTiers = getEligibleTiersForWorkUnit(workUnit.minTier);
      
      const students = await db.studentProfile.findMany({
        where: {
          tier: { in: eligibleTiers },
          revisionRate: { lte: workUnit.maxRevisionTendency },
          tasksCompleted: { gte: workUnit.preferredHistory },
        },
        select: {
          id: true,
          name: true,
          tier: true,
          tasksCompleted: true,
          avgQualityScore: true,
          onTimeRate: true,
          skillTags: true,
        },
        take: 20,
        orderBy: [
          { avgQualityScore: 'desc' },
          { tasksCompleted: 'desc' },
        ],
      });

      const rankedStudents = students.map(s => ({
        ...s,
        matchScore: calculateMatchScore(s, workUnit),
        tierConfig: TIER_CONFIG[s.tier as keyof typeof TIER_CONFIG],
      })).sort((a, b) => b.matchScore - a.matchScore);

      return reply.send(rankedStudents);
    }
  );

  // GET /:id/improvements - Get AI-powered improvement suggestions
  fastify.get<{ Params: { id: string } }>(
    '/:id/improvements',
    async (request, reply) => {
      const authResult = await verifyClerkAuth(request, reply);
      if (!authResult) return;

      const { id } = request.params;

      const workUnit = await db.workUnit.findUnique({
        where: { id },
        include: { company: { select: { userId: true } } },
      });

      if (!workUnit) {
        return notFound(reply, 'Work unit not found');
      }

      // Only company owners can view improvements
      if (workUnit.company.userId !== authResult.user.id) {
        return forbidden(reply, 'Access denied');
      }

      try {
        const analysis = await analyzeTaskForImprovements(id);
        return reply.send(analysis);
      } catch (error) {
        console.error('Failed to analyze task:', error);
        return internalError(reply, 'Failed to analyze task');
      }
    }
  );

  // GET /:id/interviews/:sessionId - View a screening interview transcript
  fastify.get<{ Params: { id: string; sessionId: string } }>(
    '/:id/interviews/:sessionId',
    async (request, reply) => {
      const company = (request as any).company;
      const { id, sessionId } = request.params;

      // Verify the company owns this work unit
      const workUnit = await db.workUnit.findFirst({
        where: { id, companyId: company.id },
      });

      if (!workUnit) {
        return notFound(reply, 'Work unit not found');
      }

      // Load the interview session with full transcript
      const session = await db.interviewSession.findUnique({
        where: { id: sessionId },
        include: {
          transcriptMessages: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              role: true,
              content: true,
              createdAt: true,
            },
          },
          summary: true,
          candidateFiles: {
            select: {
              id: true,
              filename: true,
              fileType: true,
              cloudinaryUrl: true,
            },
          },
        },
      });

      if (!session) {
        return notFound(reply, 'Interview session not found');
      }

      return reply.send({
        id: session.id,
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        transcriptMessages: session.transcriptMessages.map(m => ({
          ...m,
          timestamp: m.createdAt,
        })),
        summary: session.summary,
        candidateFiles: session.candidateFiles,
      });
    }
  );
}

function getEligibleTiersForWorkUnit(minTier: string): string[] {
  switch (minTier) {
    case 'elite': return ['elite'];
    case 'pro': return ['pro', 'elite'];
    default: return ['novice', 'pro', 'elite'];
  }
}

function calculateMatchScore(student: any, workUnit: any): number {
  let score = 0.5;
  
  const matchingSkills = (workUnit.requiredSkills || []).filter((s: string) =>
    (student.skillTags || []).includes(s)
  );
  score += matchingSkills.length * 0.15;
  
  if (student.avgQualityScore >= 0.9) score += 0.2;
  else if (student.avgQualityScore >= 0.8) score += 0.1;
  
  if (student.tasksCompleted >= workUnit.preferredHistory * 2) score += 0.1;
  
  if (student.onTimeRate >= 0.95) score += 0.1;
  
  return Math.min(score, 1);
}
