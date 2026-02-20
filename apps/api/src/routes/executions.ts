import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '@figwork/db';
import { TIER_CONFIG, calculateTaskExp, checkTierUpgrade, TierName, StudentStats, generateSecureToken } from '@figwork/shared';
import { addHours, addMinutes } from 'date-fns';
import { verifyClerkAuth } from '../lib/clerk.js';
import { unauthorized, forbidden, badRequest, notFound, conflict } from '../lib/http-errors.js';

// Type definitions
interface AcceptTaskBody {
  workUnitId: string;
}

interface SubmitDeliverableBody {
  deliverableUrls: string[];
  submissionNotes?: string;
}

interface ReviewSubmissionBody {
  verdict: 'approved' | 'revision_needed' | 'failed';
  qualityScore?: number;
  feedback?: string;
  revisionIssues?: Array<{
    criterion: string;
    issue: string;
    suggestion?: string;
    severity?: 'minor' | 'major' | 'critical';
  }>;
}

interface CompleteMilestoneBody {
  evidenceUrl?: string;
  notes?: string;
}

export async function executionRoutes(fastify: FastifyInstance) {
  // Middleware: Identify user type
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const student = await db.studentProfile.findUnique({
      where: { clerkId: authResult.userId },
    });

    const company = await db.companyProfile.findUnique({
      where: { userId: authResult.user.id },
    });

    if (!student && !company) {
      return forbidden(reply, 'Profile required');
    }

    (request as any).student = student;
    (request as any).company = company;
    (request as any).userId = authResult.userId;
  });

  // ====================
  // STUDENT ROUTES
  // ====================

  // POST /accept
  fastify.post<{ Body: AcceptTaskBody }>(
    '/accept',
    async (request, reply) => {
      const student = (request as any).student;
      if (!student) {
        return forbidden(reply, 'Only students can accept tasks');
      }

      const { workUnitId } = request.body;

      const workUnit = await db.workUnit.findUnique({
        where: { id: workUnitId },
        include: { milestoneTemplates: { orderBy: { orderIndex: 'asc' } }, escrow: true },
      });

      if (!workUnit) {
        return notFound(reply, 'Work unit not found');
      }

      if (workUnit.status !== 'active') {
        return badRequest(reply, 'Work unit is not active');
      }

      if (!workUnit.escrow || workUnit.escrow.status !== 'funded') {
        return badRequest(reply, 'Work unit escrow not funded');
      }

      const tierConfig = TIER_CONFIG[student.tier as keyof typeof TIER_CONFIG];
      if (workUnit.complexityScore > tierConfig.benefits.maxComplexity) {
        return forbidden(reply, `Your tier cannot accept tasks of complexity ${workUnit.complexityScore}`);
      }

      const tierOrder = ['novice', 'pro', 'elite'];
      if (tierOrder.indexOf(student.tier) < tierOrder.indexOf(workUnit.minTier)) {
        return forbidden(reply, `This task requires ${workUnit.minTier} tier or higher`);
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayCount = await db.execution.count({
        where: {
          studentId: student.id,
          assignedAt: { gte: today },
        },
      });

      if (todayCount >= tierConfig.benefits.dailyTaskLimit) {
        return forbidden(reply, 'Daily task limit reached');
      }

      const isManual = (workUnit as any).assignmentMode === 'manual';
      const hasScreening = !!workUnit.infoCollectionTemplateId;

      // Use transaction to prevent race conditions (double-accept)
      try {
        const execution = await db.$transaction(async (tx) => {
          // Check if THIS student already has an active execution
          const existingSelf = await tx.execution.findFirst({
            where: {
              workUnitId,
              studentId: student.id,
              status: { notIn: ['approved', 'failed', 'cancelled'] },
            },
          });

          if (existingSelf) {
            throw new Error('CONFLICT:Already have an active execution for this work unit');
          }

          // In AUTO mode: only one student can claim the task
          // In MANUAL mode: multiple students can apply; the company will pick
          if (!isManual) {
            const existingOther = await tx.execution.findFirst({
              where: {
                workUnitId,
                status: { notIn: ['approved', 'failed', 'cancelled'] },
              },
            });

            if (existingOther) {
              throw new Error('CONFLICT:This task has already been accepted by another contractor');
            }
          }

          const deadline = addHours(new Date(), workUnit.deadlineHours);

          // Determine initial status:
          // - manual + screening: pending_screening (needs interview, then company picks)
          // - manual (no screening): pending_review (company reviews profile, then assigns)
          // - auto + screening: pending_screening (needs interview, then auto-clears)
          // - auto (no screening): assigned (can clock in immediately)
          let initialStatus = 'assigned';
          if (hasScreening) {
            initialStatus = 'pending_screening';
          } else if (isManual) {
            initialStatus = 'pending_review';
          }

          // Create execution
          const exec = await tx.execution.create({
            data: {
              workUnitId,
              studentId: student.id,
              status: initialStatus,
              deadlineAt: deadline,
              milestones: {
                create: workUnit.milestoneTemplates.map(mt => ({
                  templateId: mt.id,
                })),
              },
            },
            include: {
              workUnit: {
                select: { title: true, priceInCents: true, deadlineHours: true, infoCollectionTemplateId: true },
              },
              milestones: { include: { template: true } },
            },
          });

          // Only mark work unit as in_progress in auto mode (manual allows multiple applicants)
          if (!isManual) {
            await tx.workUnit.update({
              where: { id: workUnitId },
              data: { status: 'in_progress' },
            });
          }

          return exec;
        }, {
          isolationLevel: 'Serializable',
        });

        // ── Screening Interview Bridge ──
        // If the work unit requires an info-collection interview, auto-create a one-time link
        let interviewLink: string | null = null;
        if (hasScreening) {
          const template = await db.interviewTemplate.findUnique({
            where: { id: workUnit.infoCollectionTemplateId! },
          });
          if (template) {
            const link = await db.interviewLink.create({
              data: {
                templateId: template.id,
                token: generateSecureToken(),
                linkType: 'one_time',
                maxUses: 1,
                mode: 'application',
                allowFileUpload: true,
                maxFiles: 5,
                maxFileSizeMb: 10,
                allowedFileTypes: ['pdf', 'docx', 'txt', 'jpg', 'jpeg', 'png'],
              },
            });
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            interviewLink = `${frontendUrl}/interview/${link.token}`;

            // Store the interview link on the execution so the student can resume later
            await db.execution.update({
              where: { id: execution.id },
              data: { infoSessionId: link.id },
            });
          }
        }

        // Send notification outside transaction
        const company = await db.companyProfile.findUnique({ where: { id: workUnit.companyId } });
        if (company) {
          const notifTitle = isManual ? 'New Application' : 'Task Accepted';
          const notifBody = isManual
            ? `${student.name} applied for "${workUnit.title}"${hasScreening ? ' — screening interview pending' : ''}`
            : `${student.name} accepted "${workUnit.title}"`;

          await db.notification.create({
            data: {
              userId: company.userId,
              userType: 'company',
              type: isManual ? 'task_application' : 'task_accepted',
              title: notifTitle,
              body: notifBody,
              data: { executionId: execution.id, workUnitId },
              channels: ['in_app', 'email'],
            },
          });
        }

        return reply.status(201).send({
          ...execution,
          requiresScreening: hasScreening,
          isManualReview: isManual,
          interviewLink,
        });
      } catch (error: any) {
        if (error.message?.startsWith('CONFLICT:')) {
          return conflict(reply, error.message.replace('CONFLICT:', ''));
        }
        throw error;
      }
    }
  );

  // POST /:id/clock-in
  fastify.post<{ Params: { id: string } }>(
    '/:id/clock-in',
    async (request, reply) => {
      const student = (request as any).student;
      if (!student) {
        return forbidden(reply, 'Only students can clock in');
      }

      const { id } = request.params;

      const execution = await db.execution.findFirst({
        where: { id, studentId: student.id },
        include: { workUnit: true },
      });

      if (!execution) {
        return notFound(reply, 'Execution not found');
      }

      // Block clock-in if status doesn't allow it
      if (execution.status === 'pending_review') {
        return reply.status(403).send({
          success: false,
          error: 'Your application is under review by the company. You\'ll be notified when assigned.',
          awaitingReview: true,
        });
      }

      if (execution.status === 'pending_screening') {
        return reply.status(403).send({
          success: false,
          error: 'Please complete the screening interview before clocking in.',
          requiresScreening: true,
        });
      }

      if (!['assigned', 'revision_needed'].includes(execution.status)) {
        return badRequest(reply, `Cannot clock in from status: ${execution.status}`);
      }

      // ── Gate: Screening interview must be completed before clock-in ──
      if (execution.workUnit.infoCollectionTemplateId && !execution.infoSessionId) {
        // Check if any completed interview session exists for this student + template
        const completedSession = await db.interviewSession.findFirst({
          where: {
            templateId: execution.workUnit.infoCollectionTemplateId,
            status: 'completed',
          },
          orderBy: { createdAt: 'desc' },
        });

        if (completedSession) {
          // Link the completed session to this execution
          await db.execution.update({
            where: { id },
            data: { infoSessionId: completedSession.id },
          });
        } else {
          return reply.status(403).send({
            success: false,
            error: 'Please complete the screening interview before clocking in.',
            requiresScreening: true,
          });
        }
      }

      const now = new Date();
      const tierConfig = TIER_CONFIG[student.tier as keyof typeof TIER_CONFIG];
      const powFrequencyMinutes = tierConfig.benefits.powFrequency;

      const updated = await db.execution.update({
        where: { id },
        data: {
          status: 'clocked_in',
          clockedInAt: now,
          clockedOutAt: null,
        },
      });

      const nextPOW = addMinutes(now, powFrequencyMinutes);
      await db.proofOfWorkLog.create({
        data: {
          executionId: id,
          studentId: student.id,
          requestedAt: nextPOW,
          status: 'pending',
        },
      });

      return reply.send({
        ...updated,
        nextPOWAt: nextPOW,
        powFrequencyMinutes,
      });
    }
  );

  // POST /:id/clock-out
  fastify.post<{ Params: { id: string } }>(
    '/:id/clock-out',
    async (request, reply) => {
      const student = (request as any).student;
      if (!student) {
        return forbidden(reply, 'Only students can clock out');
      }

      const { id } = request.params;

      const execution = await db.execution.findFirst({
        where: { id, studentId: student.id, status: 'clocked_in' },
      });

      if (!execution) {
        return notFound(reply, 'Not clocked in');
      }

      if (!execution.clockedInAt) {
        return badRequest(reply, 'No clock-in time recorded');
      }

      const now = new Date();
      const sessionMinutes = Math.round((now.getTime() - execution.clockedInAt.getTime()) / (1000 * 60));

      const updated = await db.execution.update({
        where: { id },
        data: {
          clockedOutAt: now,
          status: 'assigned',
        },
      });

      await db.proofOfWorkLog.updateMany({
        where: { executionId: id, status: 'pending' },
        data: { status: 'expired' },
      });

      return reply.send({
        ...updated,
        sessionMinutes,
      });
    }
  );

  // ============================================
  // COMPANY: MANUAL ASSIGNMENT ENDPOINTS
  // ============================================

  // POST /:id/assign — Company assigns a candidate (manual mode)
  fastify.post<{ Params: { id: string } }>(
    '/:id/assign',
    async (request, reply) => {
      const company = (request as any).company;
      if (!company) {
        return forbidden(reply, 'Only companies can assign candidates');
      }

      const { id } = request.params;

      const execution = await db.execution.findFirst({
        where: { id, status: 'pending_review' },
        include: {
          workUnit: true,
          student: { select: { id: true, name: true, clerkId: true } },
        },
      });

      if (!execution) {
        return notFound(reply, 'Execution not found or not in reviewable state');
      }

      if (execution.workUnit.companyId !== company.id) {
        return forbidden(reply, 'Not your work unit');
      }

      // Assign this candidate
      const updated = await db.execution.update({
        where: { id },
        data: { status: 'assigned' },
        include: {
          student: { select: { id: true, name: true } },
          workUnit: { select: { title: true } },
        },
      });

      // Move work unit to in_progress
      await db.workUnit.update({
        where: { id: execution.workUnitId },
        data: { status: 'in_progress' },
      });

      // Reject all other pending_review executions for this work unit
      const otherExecs = await db.execution.findMany({
        where: {
          workUnitId: execution.workUnitId,
          id: { not: id },
          status: { in: ['pending_review', 'pending_screening'] },
        },
        include: { student: { select: { clerkId: true, name: true } } },
      });

      if (otherExecs.length > 0) {
        await db.execution.updateMany({
          where: {
            workUnitId: execution.workUnitId,
            id: { not: id },
            status: { in: ['pending_review', 'pending_screening'] },
          },
          data: { status: 'cancelled' },
        });

        // Notify rejected candidates
        for (const other of otherExecs) {
          await db.notification.create({
            data: {
              userId: other.student.clerkId,
              userType: 'student',
              type: 'application_rejected',
              title: 'Application Not Selected',
              body: `Another candidate was selected for "${execution.workUnit.title}"`,
              data: { executionId: other.id, workUnitId: execution.workUnitId },
              channels: ['in_app'],
            },
          });
        }
      }

      // Notify the assigned student
      await db.notification.create({
        data: {
          userId: execution.student.clerkId,
          userType: 'student',
          type: 'task_assigned',
          title: 'You\'ve Been Assigned!',
          body: `You've been selected for "${execution.workUnit.title}". You can now clock in and start working.`,
          data: { executionId: id, workUnitId: execution.workUnitId },
          channels: ['in_app', 'email'],
        },
      });

      return reply.send(updated);
    }
  );

  // POST /:id/reject — Company rejects a candidate (manual mode)
  fastify.post<{ Params: { id: string } }>(
    '/:id/reject',
    async (request, reply) => {
      const company = (request as any).company;
      if (!company) {
        return forbidden(reply, 'Only companies can reject candidates');
      }

      const { id } = request.params;

      const execution = await db.execution.findFirst({
        where: { id, status: { in: ['pending_review', 'pending_screening'] } },
        include: {
          workUnit: true,
          student: { select: { id: true, name: true, clerkId: true } },
        },
      });

      if (!execution) {
        return notFound(reply, 'Execution not found or not in reviewable state');
      }

      if (execution.workUnit.companyId !== company.id) {
        return forbidden(reply, 'Not your work unit');
      }

      const updated = await db.execution.update({
        where: { id },
        data: { status: 'cancelled' },
      });

      // Notify the rejected student
      await db.notification.create({
        data: {
          userId: execution.student.clerkId,
          userType: 'student',
          type: 'application_rejected',
          title: 'Application Not Selected',
          body: `Your application for "${execution.workUnit.title}" was not selected.`,
          data: { executionId: id, workUnitId: execution.workUnitId },
          channels: ['in_app'],
        },
      });

      return reply.send(updated);
    }
  );

  // POST /:id/submit
  fastify.post<{ Params: { id: string }; Body: SubmitDeliverableBody }>(
    '/:id/submit',
    async (request, reply) => {
      const student = (request as any).student;
      if (!student) {
        return forbidden(reply, 'Only students can submit');
      }

      const { id } = request.params;
      const { deliverableUrls, submissionNotes } = request.body;

      const execution = await db.execution.findFirst({
        where: { id, studentId: student.id },
        include: {
          workUnit: true,
          milestones: { include: { template: true } },
        },
      });

      if (!execution) {
        return notFound(reply, 'Execution not found');
      }

      if (['approved', 'failed', 'cancelled'].includes(execution.status)) {
        return badRequest(reply, 'Execution already finalized');
      }

      const incompleteMilestones = execution.milestones.filter(m => !m.completedAt);
      if (incompleteMilestones.length > 0) {
        return reply.status(400).send({
          success: false,
          error: 'Complete all milestones before submitting',
          incompleteMilestones: incompleteMilestones.map(m => m.template.description),
        });
      }

      const wasLate = new Date() > execution.deadlineAt;

      const updated = await db.execution.update({
        where: { id },
        data: {
          status: 'submitted',
          submittedAt: new Date(),
          deliverableUrls,
          submissionNotes,
          wasLate,
        },
      });

      if (execution.status === 'clocked_in') {
        await db.execution.update({
          where: { id },
          data: { clockedOutAt: new Date() },
        });
      }

      const company = await db.companyProfile.findUnique({ where: { id: execution.workUnit.companyId } });
      if (company) {
        await db.notification.create({
          data: {
            userId: company.userId,
            userType: 'company',
            type: 'deliverable_submitted',
            title: 'Deliverable Submitted',
            body: `${student.name} submitted work for "${execution.workUnit.title}"`,
            data: { executionId: id, workUnitId: execution.workUnitId },
            channels: ['in_app', 'email'],
          },
        });
      }

      return reply.send(updated);
    }
  );

  // POST /:id/milestones/:milestoneId/complete
  fastify.post<{ Params: { id: string; milestoneId: string }; Body: CompleteMilestoneBody }>(
    '/:id/milestones/:milestoneId/complete',
    async (request, reply) => {
      const student = (request as any).student;
      if (!student) {
        return forbidden(reply, 'Only students can complete milestones');
      }

      const { id, milestoneId } = request.params;
      const { evidenceUrl, notes } = request.body;

      const milestone = await db.taskMilestone.findFirst({
        where: {
          id: milestoneId,
          executionId: id,
          execution: { studentId: student.id },
        },
        include: { template: true, execution: { include: { workUnit: true } } },
      });

      if (!milestone) {
        return notFound(reply, 'Milestone not found');
      }

      if (milestone.completedAt) {
        return badRequest(reply, 'Milestone already completed');
      }

      const updated = await db.taskMilestone.update({
        where: { id: milestoneId },
        data: {
          completedAt: new Date(),
          evidenceUrl,
          notes,
        },
      });

      return reply.send(updated);
    }
  );

  // ====================
  // SHARED ROUTES
  // ====================

  // GET /:id
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    async (request, reply) => {
      const { student, company } = request as any;
      const { id } = request.params;

      const execution = await db.execution.findUnique({
        where: { id },
        include: {
          workUnit: {
            include: {
              company: { select: { companyName: true } },
              milestoneTemplates: { orderBy: { orderIndex: 'asc' } },
            },
          },
          student: {
            select: { id: true, name: true, email: true, tier: true, avgQualityScore: true },
          },
          milestones: { include: { template: true } },
          powLogs: { orderBy: { requestedAt: 'desc' }, take: 10 },
          qaCheck: true,
          revisionRequests: { orderBy: { createdAt: 'desc' } },
          payout: true,
        },
      });

      if (!execution) {
        return notFound(reply, 'Execution not found');
      }

      if (student && execution.studentId !== student.id) {
        return forbidden(reply, 'Access denied');
      }
      if (company && execution.workUnit.companyId !== company.id) {
        return forbidden(reply, 'Access denied');
      }

      // If pending_screening, resolve the interview link URL for the student
      let interviewLink: string | null = null;
      if (execution.status === 'pending_screening' && execution.infoSessionId) {
        const link = await db.interviewLink.findUnique({
          where: { id: execution.infoSessionId },
        });
        if (link) {
          const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
          interviewLink = `${frontendUrl}/interview/${link.token}`;
        }
      }

      return reply.send({
        ...execution,
        interviewLink,
        requiresScreening: !!execution.workUnit.infoCollectionTemplateId,
      });
    }
  );

  // GET /my - Get student's executions
  fastify.get('/my', async (request, reply) => {
    const student = (request as any).student;
    if (!student) {
      return forbidden(reply, 'Only students can access this endpoint');
    }

    const executions = await db.execution.findMany({
      where: { studentId: student.id },
      include: {
        workUnit: {
          select: { id: true, title: true, category: true, priceInCents: true },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });

    return reply.send({ executions });
  });

  // ====================
  // COMPANY ROUTES
  // ====================

  // GET /review-queue - Get executions awaiting review
  fastify.get('/review-queue', async (request, reply) => {
    const company = (request as any).company;
    if (!company) {
      return forbidden(reply, 'Only companies can access review queue');
    }

    const { status = 'submitted' } = request.query as { status?: string };

    const statusFilter = status === 'approved'
      ? ['approved']
      : status === 'revision_needed'
        ? ['revision_needed']
        : ['submitted'];

    const executions = await db.execution.findMany({
      where: {
        workUnit: { companyId: company.id },
        status: { in: statusFilter },
      },
      include: {
        workUnit: {
          select: { id: true, title: true, priceInCents: true, category: true },
        },
        student: {
          select: {
            id: true,
            name: true,
            tier: true,
            avgQualityScore: true,
            tasksCompleted: true,
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    return reply.send({ executions });
  });

  // POST /assign — Company assigns a specific student to a work unit (manual mode)
  fastify.post<{ Body: { workUnitId: string; studentId: string } }>(
    '/assign',
    async (request, reply) => {
      const company = (request as any).company;
      if (!company) {
        return forbidden(reply, 'Only companies can assign tasks');
      }

      const { workUnitId, studentId } = request.body;
      if (!workUnitId || !studentId) {
        return badRequest(reply, 'workUnitId and studentId are required');
      }

      const workUnit = await db.workUnit.findFirst({
        where: { id: workUnitId, companyId: company.id },
        include: { milestoneTemplates: { orderBy: { orderIndex: 'asc' } }, escrow: true },
      });

      if (!workUnit) {
        return notFound(reply, 'Work unit not found');
      }

      if (workUnit.status !== 'active') {
        return badRequest(reply, 'Work unit is not active');
      }

      const student = await db.studentProfile.findUnique({ where: { id: studentId } });
      if (!student) {
        return notFound(reply, 'Student not found');
      }

      // Check no existing active execution
      const existing = await db.execution.findFirst({
        where: {
          workUnitId,
          status: { notIn: ['approved', 'failed', 'cancelled'] },
        },
      });
      if (existing) {
        return conflict(reply, 'This task already has an active assignment');
      }

      const deadline = addHours(new Date(), workUnit.deadlineHours);

      const execution = await db.$transaction(async (tx) => {
        const exec = await tx.execution.create({
          data: {
            workUnitId,
            studentId,
            status: 'assigned',
            deadlineAt: deadline,
            milestones: {
              create: workUnit.milestoneTemplates.map(mt => ({
                templateId: mt.id,
              })),
            },
          },
          include: {
            workUnit: { select: { title: true, priceInCents: true, deadlineHours: true } },
          },
        });

        await tx.workUnit.update({
          where: { id: workUnitId },
          data: { status: 'in_progress' },
        });

        return exec;
      });

      // Notify student
      await db.notification.create({
        data: {
          userId: student.clerkId,
          userType: 'student',
          type: 'task_assigned',
          title: 'Task Assigned',
          body: `You've been assigned to "${workUnit.title}"`,
          data: { executionId: execution.id, workUnitId },
          channels: ['in_app', 'email'],
        },
      });

      return reply.status(201).send(execution);
    }
  );

  // POST /:id/approve-application — Company approves a pending_review application (manual mode)
  fastify.post<{ Params: { id: string } }>(
    '/:id/approve-application',
    async (request, reply) => {
      const company = (request as any).company;
      if (!company) return forbidden(reply, 'Only companies can approve applications');

      const { id } = request.params;
      const execution = await db.execution.findFirst({
        where: { id, workUnit: { companyId: company.id }, status: 'pending_review' },
        include: { workUnit: true, student: true },
      });

      if (!execution) return notFound(reply, 'Pending application not found');

      await db.execution.update({
        where: { id },
        data: { status: 'assigned' },
      });

      // Move work unit to in_progress
      await db.workUnit.update({
        where: { id: execution.workUnitId },
        data: { status: 'in_progress' },
      });

      // Notify student
      await db.notification.create({
        data: {
          userId: execution.student.clerkId,
          userType: 'student',
          type: 'application_approved',
          title: 'Application Approved',
          body: `You've been assigned to "${execution.workUnit.title}"`,
          data: { executionId: id },
          channels: ['in_app', 'email'],
        },
      });

      return reply.send({ success: true, status: 'assigned' });
    }
  );

  // POST /:id/review
  fastify.post<{ Params: { id: string }; Body: ReviewSubmissionBody }>(
    '/:id/review',
    async (request, reply) => {
      const company = (request as any).company;
      if (!company) {
        return forbidden(reply, 'Only companies can review');
      }

      const { id } = request.params;
      const { verdict, qualityScore, feedback, revisionIssues } = request.body;

      const execution = await db.execution.findFirst({
        where: {
          id,
          workUnit: { companyId: company.id },
          status: { in: ['submitted', 'in_review'] },
        },
        include: {
          workUnit: { include: { escrow: true } },
          student: true,
        },
      });

      if (!execution) {
        return notFound(reply, 'Execution not found or not reviewable');
      }

      let updated;

      switch (verdict) {
        case 'approved': {
          const expEarned = calculateTaskExp({
            complexityScore: execution.workUnit.complexityScore,
            revisionCount: execution.revisionCount,
            wasLate: execution.wasLate,
            qualityScore: qualityScore ? qualityScore / 100 : undefined,
          });

          updated = await db.execution.update({
            where: { id },
            data: {
              status: 'approved',
              completedAt: new Date(),
              qualityScore,
              qaVerdict: 'pass',
              expEarned,
            },
          });

          const updatedStudent = await db.studentProfile.update({
            where: { id: execution.studentId },
            data: {
              totalExp: { increment: expEarned },
              tasksCompleted: { increment: 1 },
              avgQualityScore: {
                set: execution.student.tasksCompleted === 0
                  ? (qualityScore || 80)
                  : (execution.student.avgQualityScore * execution.student.tasksCompleted + (qualityScore || 80)) / (execution.student.tasksCompleted + 1),
              },
              onTimeRate: {
                set: execution.student.tasksCompleted === 0
                  ? (execution.wasLate ? 0 : 1)
                  : (execution.student.onTimeRate * execution.student.tasksCompleted + (execution.wasLate ? 0 : 1)) / (execution.student.tasksCompleted + 1),
              },
            },
          });

          const studentStats: StudentStats = {
            totalExp: updatedStudent.totalExp,
            tasksCompleted: updatedStudent.tasksCompleted,
            avgQualityScore: updatedStudent.avgQualityScore,
            onTimeRate: updatedStudent.onTimeRate,
            tier: updatedStudent.tier as TierName,
          };
          const newTier = checkTierUpgrade(studentStats);
          if (newTier && newTier !== updatedStudent.tier) {
            await db.studentProfile.update({
              where: { id: updatedStudent.id },
              data: { tier: newTier },
            });
            await db.notification.create({
              data: {
                userId: execution.student.clerkId,
                userType: 'student',
                type: 'tier_upgrade',
                title: 'Congratulations!',
                body: `You've been promoted to ${newTier} tier!`,
                data: { oldTier: updatedStudent.tier, newTier },
                channels: ['in_app', 'email', 'sms'],
              },
            });
          }

          const payout = await db.payout.create({
            data: {
              studentId: execution.studentId,
              amountInCents: execution.workUnit.escrow?.netAmountInCents || 0,
              status: 'pending',
            },
          });

          await db.execution.update({
            where: { id },
            data: { payoutId: payout.id, payoutStatus: 'pending' },
          });

          if (execution.workUnit.escrow) {
            await db.escrow.update({
              where: { id: execution.workUnit.escrow.id },
              data: { status: 'released', releasedAt: new Date() },
            });
          }

          await db.workUnit.update({
            where: { id: execution.workUnitId },
            data: { status: 'completed' },
          });

          await db.notification.create({
            data: {
              userId: execution.student.clerkId,
              userType: 'student',
              type: 'task_approved',
              title: 'Task Approved!',
              body: `Your work on "${execution.workUnit.title}" was approved!`,
              data: { executionId: id, payoutId: payout.id },
              channels: ['in_app', 'email'],
            },
          });

          break;
        }

        case 'revision_needed': {
          if (!revisionIssues || revisionIssues.length === 0) {
            return badRequest(reply, 'Revision issues required');
          }

          if (execution.revisionCount >= execution.workUnit.revisionLimit) {
            return badRequest(reply, 'Revision limit reached. Must approve or fail.');
          }

          const revisionDeadline = addHours(new Date(), 48);

          updated = await db.execution.update({
            where: { id },
            data: {
              status: 'revision_needed',
              qaVerdict: 'revise',
              revisionCount: { increment: 1 },
            },
          });

          await db.revisionRequest.create({
            data: {
              executionId: id,
              revisionNumber: execution.revisionCount + 1,
              issues: revisionIssues,
              overallFeedback: feedback || '',
              revisionDeadlineAt: revisionDeadline,
            },
          });

          await db.notification.create({
            data: {
              userId: execution.student.clerkId,
              userType: 'student',
              type: 'revision_requested',
              title: 'Revision Needed',
              body: `Revision requested for "${execution.workUnit.title}"`,
              data: { executionId: id, deadline: revisionDeadline },
              channels: ['in_app', 'email', 'sms'],
            },
          });

          break;
        }

        case 'failed': {
          updated = await db.execution.update({
            where: { id },
            data: {
              status: 'failed',
              completedAt: new Date(),
              qaVerdict: 'fail',
            },
          });

          await db.studentProfile.update({
            where: { id: execution.studentId },
            data: {
              totalExp: { decrement: 100 },
              recentFailures: { increment: 1 },
              lastFailureAt: new Date(),
            },
          });

          if (execution.workUnit.escrow) {
            await db.escrow.update({
              where: { id: execution.workUnit.escrow.id },
              data: { status: 'refunded', releasedAt: new Date() },
            });
          }

          await db.workUnit.update({
            where: { id: execution.workUnitId },
            data: { status: 'active' },
          });

          await db.notification.create({
            data: {
              userId: execution.student.clerkId,
              userType: 'student',
              type: 'task_failed',
              title: 'Task Failed',
              body: `Your work on "${execution.workUnit.title}" did not meet requirements`,
              data: { executionId: id, feedback },
              channels: ['in_app', 'email'],
            },
          });

          break;
        }
      }

      return reply.send(updated);
    }
  );

  // GET /:id/qa-results
  fastify.get<{ Params: { id: string } }>(
    '/:id/qa-results',
    async (request, reply) => {
      const { student, company } = request as any;
      const { id } = request.params;

      const execution = await db.execution.findUnique({
        where: { id },
        include: { workUnit: true, qaCheck: true },
      });

      if (!execution) {
        return notFound(reply, 'Execution not found');
      }

      if (student && execution.studentId !== student.id) {
        return forbidden(reply, 'Access denied');
      }
      if (company && execution.workUnit.companyId !== company.id) {
        return forbidden(reply, 'Access denied');
      }

      return reply.send(execution.qaCheck);
    }
  );

  // GET /:id/revisions
  fastify.get<{ Params: { id: string } }>(
    '/:id/revisions',
    async (request, reply) => {
      const { student, company } = request as any;
      const { id } = request.params;

      const execution = await db.execution.findUnique({
        where: { id },
        include: { workUnit: true, revisionRequests: { orderBy: { createdAt: 'asc' } } },
      });

      if (!execution) {
        return notFound(reply, 'Execution not found');
      }

      if (student && execution.studentId !== student.id) {
        return forbidden(reply, 'Access denied');
      }
      if (company && execution.workUnit.companyId !== company.id) {
        return forbidden(reply, 'Access denied');
      }

      return reply.send(execution.revisionRequests);
    }
  );

  // ====================
  // AI WORK ASSISTANT
  // ====================

  // POST /:id/assist - Get AI assistance without doing the work
  fastify.post<{ Params: { id: string }; Body: { question: string } }>(
    '/:id/assist',
    async (request, reply) => {
      const { student } = request as any;
      if (!student) {
        return forbidden(reply, 'Only students can use the work assistant');
      }

      const { id } = request.params;
      const { question } = request.body;

      if (!question || question.trim().length < 10) {
        return badRequest(reply, 'Please provide a detailed question (at least 10 characters)');
      }

      const execution = await db.execution.findUnique({
        where: { id },
        include: {
          workUnit: {
            include: {
              milestoneTemplates: { orderBy: { orderIndex: 'asc' } },
            },
          },
          milestones: true,
          revisionRequests: { orderBy: { createdAt: 'desc' }, take: 3 },
        },
      });

      if (!execution) {
        return notFound(reply, 'Execution not found');
      }

      if (execution.studentId !== student.id) {
        return forbidden(reply, 'Access denied');
      }

      if (!['accepted', 'clocked_in', 'revision_needed'].includes(execution.status)) {
        return badRequest(reply, 'Assistant only available for active tasks');
      }

      // Build context for AI
      const context = buildAssistantContext(execution);
      
      // Get AI response using OpenAI
      const { getOpenAIClient } = await import('@figwork/ai');
      const openai = getOpenAIClient();

      const response = await openai.chat.completions.create({
        model: 'gpt-5.2',
        messages: [
          {
            role: 'system',
            content: `You are a helpful work assistant for a student contractor. Your role is to:
1. Clarify task requirements and acceptance criteria
2. Suggest approaches and best practices
3. Help interpret feedback from previous revisions
4. Answer questions about deliverable formats

IMPORTANT RULES:
- NEVER write code, content, or deliverables for the student
- NEVER provide complete solutions
- If asked to do the actual work, politely decline and offer guidance instead
- Keep responses concise (under 200 words)
- Focus on teaching HOW to do things, not WHAT to deliver

Task Context:
${context}`,
          },
          {
            role: 'user',
            content: question,
          },
        ],
        max_completion_tokens: 400,
        temperature: 0.7,
      });

      const answer = response.choices[0]?.message?.content || 'I apologize, I could not generate a response.';

      // Log the assistance request
      await db.notification.create({
        data: {
          userId: student.clerkId,
          userType: 'student',
          type: 'assistant_used',
          title: 'Work Assistant',
          body: question.substring(0, 100),
          channels: ['in_app'],
          data: {
            executionId: id,
            questionLength: question.length,
            responseLength: answer.length,
          },
        },
      });

      return reply.send({
        question,
        answer,
        disclaimer: 'This assistant provides guidance only. You must complete the actual work yourself.',
      });
    }
  );

  // ====================
  // QA PREVIEW
  // ====================

  // POST /:id/qa-preview - Run QA checks without submitting
  fastify.post<{ Params: { id: string }; Body: { deliverableUrls?: string[] } }>(
    '/:id/qa-preview',
    async (request, reply) => {
      const { student } = request as any;
      if (!student) {
        return forbidden(reply, 'Only students can preview QA');
      }

      const { id } = request.params;
      const { deliverableUrls } = request.body;

      const execution = await db.execution.findUnique({
        where: { id },
        include: {
          workUnit: {
            include: {
              milestoneTemplates: true,
            },
          },
          milestones: true,
          powLogs: { where: { status: { in: ['verified', 'submitted'] } } },
        },
      });

      if (!execution) {
        return notFound(reply, 'Execution not found');
      }

      if (execution.studentId !== student.id) {
        return forbidden(reply, 'Access denied');
      }

      if (!['clocked_in', 'revision_needed'].includes(execution.status)) {
        return badRequest(reply, 'QA preview only available when working on task');
      }

      // Run QA checks (preview mode - doesn't save results)
      const qaResults = await runQAPreview(execution, deliverableUrls || []);

      return reply.send({
        preview: true,
        ...qaResults,
        message: qaResults.blockers.length === 0
          ? 'Your submission looks ready! No blockers detected.'
          : `${qaResults.blockers.length} blocker(s) found. Please address before submitting.`,
      });
    }
  );
}

// Helper: Build context for AI assistant
function buildAssistantContext(execution: any): string {
  const workUnit = execution.workUnit;
  const lines: string[] = [];

  lines.push(`Task: ${workUnit.title}`);
  lines.push(`Category: ${workUnit.category}`);
  lines.push(`\nDescription:\n${workUnit.description}`);

  if (workUnit.acceptanceCriteria) {
    lines.push(`\nAcceptance Criteria:\n${workUnit.acceptanceCriteria}`);
  }

  if (workUnit.deliverableFormat) {
    lines.push(`\nDeliverable Format: ${workUnit.deliverableFormat}`);
  }

  if (workUnit.milestoneTemplates?.length > 0) {
    lines.push(`\nMilestones:`);
    workUnit.milestoneTemplates.forEach((m: any, i: number) => {
      const completed = execution.milestones?.find((em: any) => em.templateId === m.id)?.completedAt;
      lines.push(`${i + 1}. ${m.description} ${completed ? '✓' : '○'}`);
    });
  }

  if (execution.revisionRequests?.length > 0) {
    lines.push(`\nPrevious Revision Feedback:`);
    execution.revisionRequests.forEach((r: any) => {
      lines.push(`- ${r.overallFeedback}`);
      if (r.issues) {
        const issues = typeof r.issues === 'string' ? JSON.parse(r.issues) : r.issues;
        issues.forEach((issue: any) => {
          lines.push(`  • ${issue.criterion}: ${issue.issue}`);
        });
      }
    });
  }

  const hoursRemaining = Math.max(0, (new Date(execution.deadlineAt).getTime() - Date.now()) / (1000 * 60 * 60));
  lines.push(`\nTime Remaining: ${Math.round(hoursRemaining)} hours`);

  return lines.join('\n');
}

// Helper: Run QA preview checks
async function runQAPreview(execution: any, deliverableUrls: string[]): Promise<{
  checksRun: string[];
  checksPassed: number;
  checksFailed: number;
  checksWarning: number;
  results: Record<string, { status: string; message: string }>;
  blockers: string[];
  warnings: string[];
}> {
  const results: Record<string, { status: string; message: string }> = {};
  const blockers: string[] = [];
  const warnings: string[] = [];
  let passed = 0;
  let failed = 0;
  let warning = 0;

  // Check 1: Milestones completed
  const totalMilestones = execution.workUnit.milestoneTemplates?.length || 0;
  const completedMilestones = execution.milestones?.filter((m: any) => m.completedAt).length || 0;

  if (totalMilestones > 0) {
    if (completedMilestones === totalMilestones) {
      results['milestones'] = { status: 'pass', message: `All ${totalMilestones} milestones completed` };
      passed++;
    } else if (completedMilestones >= totalMilestones * 0.8) {
      results['milestones'] = { status: 'warning', message: `${completedMilestones}/${totalMilestones} milestones completed` };
      warnings.push(`Only ${completedMilestones}/${totalMilestones} milestones marked complete`);
      warning++;
    } else {
      results['milestones'] = { status: 'fail', message: `${completedMilestones}/${totalMilestones} milestones completed` };
      blockers.push(`Must complete at least 80% of milestones (${Math.ceil(totalMilestones * 0.8)}/${totalMilestones})`);
      failed++;
    }
  }

  // Check 2: POW compliance
  const powLogs = execution.powLogs || [];
  const hoursWorked = execution.clockedInAt
    ? (Date.now() - new Date(execution.clockedInAt).getTime()) / (1000 * 60 * 60)
    : 0;
  const expectedPOWs = Math.floor(hoursWorked); // 1 POW per hour
  const verifiedPOWs = powLogs.filter((p: any) => p.status === 'verified').length;

  if (hoursWorked > 1) {
    if (verifiedPOWs >= expectedPOWs * 0.8) {
      results['pow_compliance'] = { status: 'pass', message: `${verifiedPOWs} POW verifications` };
      passed++;
    } else if (verifiedPOWs >= expectedPOWs * 0.5) {
      results['pow_compliance'] = { status: 'warning', message: `Low POW compliance: ${verifiedPOWs}/${expectedPOWs}` };
      warnings.push('POW compliance below expected - may affect quality score');
      warning++;
    } else {
      results['pow_compliance'] = { status: 'fail', message: `Insufficient POW: ${verifiedPOWs}/${expectedPOWs}` };
      blockers.push('Insufficient proof of work submissions');
      failed++;
    }
  } else {
    results['pow_compliance'] = { status: 'pass', message: 'Short task - POW not required' };
    passed++;
  }

  // Check 3: Deliverables provided
  if (deliverableUrls.length > 0) {
    results['deliverables'] = { status: 'pass', message: `${deliverableUrls.length} deliverable(s) ready` };
    passed++;
  } else {
    results['deliverables'] = { status: 'warning', message: 'No deliverable URLs provided yet' };
    warnings.push('Remember to include deliverable URLs when submitting');
    warning++;
  }

  // Check 4: Deadline
  const hoursRemaining = (new Date(execution.deadlineAt).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursRemaining > 2) {
    results['deadline'] = { status: 'pass', message: `${Math.round(hoursRemaining)} hours remaining` };
    passed++;
  } else if (hoursRemaining > 0) {
    results['deadline'] = { status: 'warning', message: `Only ${Math.round(hoursRemaining * 60)} minutes remaining!` };
    warnings.push('Deadline approaching - submit soon');
    warning++;
  } else {
    results['deadline'] = { status: 'fail', message: 'Deadline passed' };
    blockers.push('Deadline has passed - submission will be marked late');
    failed++;
  }

  // Check 5: Revision issues addressed (if this is a revision)
  if (execution.status === 'revision_needed' && execution.revisionRequests?.length > 0) {
    results['revision_check'] = { status: 'warning', message: 'Please ensure all revision issues are addressed' };
    warnings.push('This is a revision - make sure all feedback has been addressed');
    warning++;
  }

  return {
    checksRun: Object.keys(results),
    checksPassed: passed,
    checksFailed: failed,
    checksWarning: warning,
    results,
    blockers,
    warnings,
  };
}
