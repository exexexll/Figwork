/**
 * Admin Routes - Platform administration
 * 
 * Routes for:
 * - Dispute management
 * - Student management
 * - Platform analytics
 * - Coaching oversight
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { db } from '@figwork/db';
import { verifyClerkAuth } from '../lib/clerk.js';
import { unauthorized, forbidden, badRequest, notFound } from '../lib/http-errors.js';
import { runEarlyWarningCheck, getCompanyWarnings, getStudentWarnings } from '../lib/early-warning.js';
import { runCoachingCheck, analyzeForCoaching } from '../lib/coaching.js';
import { generateMonthlyInvoices } from '../workers/invoice.worker.js';

// Admin user IDs (in production, this would be from a config or database)
const ADMIN_USER_IDS = process.env.ADMIN_USER_IDS?.split(',') || [];

async function verifyAdmin(request: any, reply: any): Promise<string | null> {
  const authResult = await verifyClerkAuth(request, reply);
  if (!authResult) {
    return null; // 401 already sent by verifyClerkAuth
  }
  
  if (!ADMIN_USER_IDS.includes(authResult.userId)) {
    reply.status(403).send({ success: false, error: 'Admin access required' });
    return null;
  }
  
  return authResult.userId;
}

export default async function adminRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
) {
  // =========================
  // DISPUTE MANAGEMENT
  // =========================

  /**
   * GET /api/admin/disputes - List all disputes
   */
  fastify.get('/disputes', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;

    const { status, page: pageStr = '1', limit: limitStr = '20' } = request.query as {
      status?: string;
      page?: string;
      limit?: string;
    };

    const where = status ? { status } : {};
    const pageNum = Math.max(1, parseInt(pageStr) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limitStr) || 20), 100);
    const skip = (pageNum - 1) * limitNum;

    const [disputes, total] = await Promise.all([
      db.dispute.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { filedAt: 'desc' },
        include: {
          student: { select: { name: true, clerkId: true } },
          company: { select: { companyName: true } },
        },
      }),
      db.dispute.count({ where }),
    ]);

    return {
      disputes,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  });

  /**
   * GET /api/admin/disputes/:id - Get dispute details
   */
  fastify.get('/disputes/:id', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;

    const { id } = request.params as { id: string };

    const dispute = await db.dispute.findUnique({
      where: { id },
      include: {
        student: true,
        company: true,
      },
    });

    if (!dispute) {
      throw notFound(reply, 'Dispute not found');
    }

    // If executionId exists, fetch execution details separately
    let execution = null;
    if (dispute.executionId) {
      execution = await db.execution.findUnique({
        where: { id: dispute.executionId },
        include: {
          workUnit: true,
          milestones: true,
          revisionRequests: true,
          powLogs: true,
        },
      });
    }

    return { dispute, execution };
  });

  /**
   * POST /api/admin/disputes/:id/resolve - Resolve a dispute
   */
  fastify.post('/disputes/:id/resolve', async (request, reply) => {
    const adminId = await verifyAdmin(request, reply);
    if (!adminId) return;

    const { id } = request.params as { id: string };
    const { resolutionType, resolutionText, payoutAdjustment, expAdjustment } = request.body as {
      resolutionType: 'resolved_student' | 'resolved_company' | 'partial';
      resolutionText: string;
      payoutAdjustment?: number;
      expAdjustment?: number;
    };

    const dispute = await db.dispute.findUnique({
      where: { id },
    });

    if (!dispute) {
      throw notFound(reply, 'Dispute not found');
    }

    if (dispute.status.startsWith('resolved') || dispute.status === 'partial') {
      throw badRequest(reply, 'Dispute already resolved');
    }

    // Update dispute
    const updatedDispute = await db.$transaction(async (tx) => {
      const updated = await tx.dispute.update({
        where: { id },
        data: {
          status: resolutionType,
          resolutionType,
          resolution: resolutionText,
          resolvedAt: new Date(),
          assignedTo: adminId,
          payoutAdjustment: payoutAdjustment || null,
          expAdjustment: expAdjustment || null,
        },
      });

      // If execution exists, update its status based on resolution
      if (dispute.executionId) {
        await tx.execution.update({
          where: { id: dispute.executionId },
          data: {
            status: resolutionType === 'resolved_student' ? 'approved' : 'failed',
          },
        });

        // Handle escrow release for the work unit
        const execution = await tx.execution.findUnique({
          where: { id: dispute.executionId },
          select: { workUnitId: true },
        });

        if (execution) {
          const escrow = await tx.escrow.findUnique({
            where: { workUnitId: execution.workUnitId },
          });

          if (escrow && escrow.status === 'funded') {
            const newStatus = resolutionType === 'resolved_company' ? 'refunded' : 'released';
            await tx.escrow.update({
              where: { id: escrow.id },
              data: {
                status: newStatus,
                releasedAt: new Date(),
              },
            });
          }
        }
      }

      return updated;
    });

    return { dispute: updatedDispute };
  });

  // =========================
  // STUDENT MANAGEMENT
  // =========================

  /**
   * GET /api/admin/students - List all students
   */
  fastify.get('/students', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;

    const { tier, status, page: pageStr = '1', limit: limitStr = '20', search } = request.query as {
      tier?: string;
      status?: string;
      page?: string;
      limit?: string;
      search?: string;
    };

    const where: any = {};
    if (tier) where.tier = tier;
    if (status === 'active') where.kycStatus = 'verified';
    if (status === 'pending') where.kycStatus = 'pending';
    if (search) {
      // Sanitize search input
      const sanitized = search.trim().substring(0, 100);
      if (sanitized) {
        where.OR = [
          { name: { contains: sanitized, mode: 'insensitive' } },
          { email: { contains: sanitized, mode: 'insensitive' } },
        ];
      }
    }

    const pageNum = Math.max(1, parseInt(pageStr) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limitStr) || 20), 100);
    const skip = (pageNum - 1) * limitNum;

    const [students, total] = await Promise.all([
      db.studentProfile.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          clerkId: true,
          name: true,
          email: true,
          tier: true,
          totalExp: true,
          tasksCompleted: true,
          avgQualityScore: true,
          onTimeRate: true,
          revisionRate: true,
          kycStatus: true,
          createdAt: true,
          _count: {
            select: {
              executions: true,
              disputes: true,
            },
          },
        },
      }),
      db.studentProfile.count({ where }),
    ]);

    return {
      students,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  });

  /**
   * GET /api/admin/students/:id - Get student details
   */
  fastify.get('/students/:id', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;

    const { id } = request.params as { id: string };

    const student = await db.studentProfile.findUnique({
      where: { id },
      include: {
        uploadedFiles: true,
        executions: {
          take: 20,
          orderBy: { assignedAt: 'desc' },
          include: {
            workUnit: { select: { title: true, category: true } },
          },
        },
        disputes: true,
        payouts: true,
      },
    });

    if (!student) {
      throw notFound(reply, 'Student not found');
    }

    // Get coaching analysis
    const coaching = await analyzeForCoaching(id);

    // Get warnings
    const warnings = await getStudentWarnings(id);

    return { student, coaching, warnings };
  });

  /**
   * POST /api/admin/students/:id/tier - Update student tier
   */
  fastify.post('/students/:id/tier', async (request, reply) => {
    const adminId = await verifyAdmin(request, reply);
    if (!adminId) return;

    const { id } = request.params as { id: string };
    const { tier, reason } = request.body as { tier: string; reason: string };

    if (!['novice', 'pro', 'elite'].includes(tier)) {
      throw badRequest(reply, 'Invalid tier');
    }

    const student = await db.studentProfile.update({
      where: { id },
      data: {
        tier,
        // Log the manual tier change
        totalExp: tier === 'pro' ? Math.max(2000, 2000) : tier === 'elite' ? Math.max(5000, 5000) : undefined,
      },
    });

    // Log admin action
    await db.notification.create({
      data: {
        userId: id,
        userType: 'student',
        type: 'admin_tier_change',
        title: 'Tier Updated',
        body: `Your tier has been changed to ${tier}. Reason: ${reason}`,
        channels: ['in_app'],
        data: { adminId, previousTier: student.tier, newTier: tier, reason },
      },
    });

    return { student };
  });

  /**
   * POST /api/admin/students/:id/suspend - Suspend a student
   */
  fastify.post('/students/:id/suspend', async (request, reply) => {
    const adminId = await verifyAdmin(request, reply);
    if (!adminId) return;

    const { id } = request.params as { id: string };
    const { reason, duration } = request.body as { reason: string; duration?: number };

    const suspendedUntil = duration
      ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000)
      : null;

    const student = await db.studentProfile.update({
      where: { id },
      data: {
        kycStatus: 'suspended',
        // suspendedUntil, // Would need to add this field to schema
      },
    });

    await db.notification.create({
      data: {
        userId: id,
        userType: 'student',
        type: 'account_suspended',
        title: 'Account Suspended',
        body: `Your account has been suspended. Reason: ${reason}`,
        channels: ['in_app'],
        data: { adminId, reason, suspendedUntil },
      },
    });

    return { student };
  });

  // =========================
  // PLATFORM ANALYTICS
  // =========================

  /**
   * GET /api/admin/analytics - Platform analytics
   */
  fastify.get('/analytics', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;

    const { period: periodStr = '30' } = request.query as { period?: string };
    const periodDays = Math.min(Math.max(1, parseInt(periodStr) || 30), 365);
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - periodDays);

    // Get various metrics
    const [
      totalStudents,
      activeStudents,
      totalCompanies,
      totalWorkUnits,
      activeWorkUnits,
      totalExecutions,
      completedExecutions,
      totalPayouts,
      openDisputes,
    ] = await Promise.all([
      db.studentProfile.count(),
      db.studentProfile.count({ where: { kycStatus: 'verified' } }),
      db.companyProfile.count(),
      db.workUnit.count(),
      db.workUnit.count({ where: { status: 'active' } }),
      db.execution.count({ where: { assignedAt: { gte: daysAgo } } }),
      db.execution.count({ where: { status: 'approved', completedAt: { gte: daysAgo } } }),
      db.payout.aggregate({ where: { status: 'completed' }, _sum: { amountInCents: true } }),
      db.dispute.count({ where: { status: { in: ['pending', 'under_review'] } } }),
    ]);

    // Get tier distribution
    const tierDistribution = await db.studentProfile.groupBy({
      by: ['tier'],
      _count: true,
    });

    // Get category breakdown
    const categoryBreakdown = await db.workUnit.groupBy({
      by: ['category'],
      _count: true,
    });

    // Get quality metrics
    const qualityMetrics = await db.studentProfile.aggregate({
      _avg: {
        avgQualityScore: true,
        onTimeRate: true,
        revisionRate: true,
      },
    });

    return {
      period: periodDays,
      students: {
        total: totalStudents,
        active: activeStudents,
        tierDistribution: Object.fromEntries(
          tierDistribution.map(t => [t.tier, t._count])
        ),
      },
      companies: {
        total: totalCompanies,
      },
      workUnits: {
        total: totalWorkUnits,
        active: activeWorkUnits,
        categoryBreakdown: Object.fromEntries(
          categoryBreakdown.map(c => [c.category, c._count])
        ),
      },
      executions: {
        total: totalExecutions,
        completed: completedExecutions,
        completionRate: totalExecutions > 0 ? completedExecutions / totalExecutions : 0,
      },
      payouts: {
        totalInCents: totalPayouts._sum.amountInCents || 0,
      },
      disputes: {
        open: openDisputes,
      },
      quality: {
        avgQualityScore: qualityMetrics._avg.avgQualityScore || 0,
        avgOnTimeRate: qualityMetrics._avg.onTimeRate || 0,
        avgRevisionRate: qualityMetrics._avg.revisionRate || 0,
      },
    };
  });

  // =========================
  // SYSTEM OPERATIONS
  // =========================

  /**
   * POST /api/admin/run-early-warnings - Manually run early warning check
   */
  fastify.post('/run-early-warnings', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;

    const result = await runEarlyWarningCheck();

    return {
      success: true,
      result,
    };
  });

  /**
   * POST /api/admin/run-coaching - Manually run coaching check
   */
  fastify.post('/run-coaching', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;

    const result = await runCoachingCheck();

    return {
      success: true,
      result,
    };
  });

  /**
   * POST /api/admin/generate-invoices - Manually generate monthly invoices
   */
  fastify.post('/generate-invoices', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;

    const result = await generateMonthlyInvoices();

    return {
      success: true,
      result,
    };
  });

  /**
   * GET /api/admin/warnings - Get all active warnings
   */
  fastify.get('/warnings', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;

    const activeExecutions = await db.execution.findMany({
      where: {
        status: { in: ['accepted', 'clocked_in', 'revision_needed', 'submitted'] },
      },
      include: {
        workUnit: { select: { companyId: true } },
      },
    });

    // Group by company
    const companyIds = [...new Set(activeExecutions.map(e => e.workUnit.companyId))];
    
    const warningsByCompany: Record<string, any[]> = {};
    for (const companyId of companyIds) {
      warningsByCompany[companyId] = await getCompanyWarnings(companyId);
    }

    const totalWarnings = Object.values(warningsByCompany).flat().length;
    const criticalCount = Object.values(warningsByCompany)
      .flat()
      .filter(w => w.level === 'critical').length;

    return {
      totalWarnings,
      criticalCount,
      warningsByCompany,
    };
  });

  /**
   * POST /api/admin/trigger-defect-analysis - Manually run defect analysis on recent failures
   */
  fastify.post('/trigger-defect-analysis', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;

    // Find recent failed/revised executions without defect analysis
    const executions = await db.execution.findMany({
      where: {
        status: { in: ['failed', 'revision_needed'] },
        defectAnalysis: null,
        completedAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        },
      },
      select: { id: true, status: true },
    });

    // Queue each for defect analysis
    const { Queue } = await import('bullmq');
    const { getRedis } = await import('../lib/redis.js');
    const { QUEUE_NAMES } = await import('@figwork/shared');
    const defectQueue = new Queue(QUEUE_NAMES.DEFECT_ANALYSIS, { connection: getRedis() });

    let queued = 0;
    for (const exec of executions) {
      await defectQueue.add('analyze', {
        executionId: exec.id,
        trigger: exec.status === 'failed' ? 'failed' : 'revision',
      });
      queued++;
    }

    return {
      success: true,
      message: `Queued ${queued} executions for defect analysis`,
      executionsFound: executions.length,
    };
  });

  /**
   * POST /api/admin/generate-weekly-reports - Send weekly quality reports to companies
   */
  fastify.post('/generate-weekly-reports', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;

    const { sendWeeklyReports } = await import('../workers/defect-analysis.worker.js');
    const result = await sendWeeklyReports();

    return {
      success: true,
      message: `Sent reports to ${result.companiesSent} companies`,
      ...result,
    };
  });

  /**
   * POST /api/admin/cleanup-expired - Clean up expired sessions and orphaned data
   */
  fastify.post('/cleanup-expired', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;

    const now = new Date();

    // Clean up expired interview sessions (older than 7 days)
    const expiredSessions = await db.interviewSession.updateMany({
      where: {
        status: 'in_progress',
        lastActivityAt: {
          lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        },
      },
      data: { status: 'expired' },
    });

    // Clean up expired POW requests (older than 1 hour)
    const expiredPOWs = await db.proofOfWorkLog.updateMany({
      where: {
        status: 'pending',
        requestedAt: {
          lt: new Date(now.getTime() - 60 * 60 * 1000),
        },
      },
      data: { status: 'expired' },
    });

    // Clean up old read notifications (older than 30 days)
    const oldNotifications = await db.notification.deleteMany({
      where: {
        readAt: { not: null },
        createdAt: {
          lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        },
      },
    });

    return {
      success: true,
      message: 'Cleanup completed',
      results: {
        expiredSessions: expiredSessions.count,
        expiredPOWs: expiredPOWs.count,
        deletedNotifications: oldNotifications.count,
      },
    };
  });
}
