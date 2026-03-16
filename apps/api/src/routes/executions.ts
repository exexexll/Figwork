import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '@figwork/db';
import { getDependentWorkUnits } from '../lib/publish-conditions.js';
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

      const isManual = (workUnit as any).assignmentMode === 'manual';
      const hasScreening = !!workUnit.infoCollectionTemplateId;

      // For auto-review tasks (not manual), check credentials before allowing acceptance
      if (!isManual) {
        // Check if student has required credentials for payouts
        if (student.stripeConnectStatus !== 'active' || !student.stripeConnectId) {
          return badRequest(reply, 'Please complete your Stripe Connect setup to accept tasks. Go to Profile > Payout Settings to set up payments.');
        }
        // Check KYC status if required
        if (student.kycStatus !== 'verified' && student.kycStatus !== 'approved') {
          return badRequest(reply, 'Please complete identity verification (KYC) to accept tasks. Go to Profile > Verification to complete.');
        }
      }

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

        // Check if task has an onboarding page
        let hasOnboarding = false;
        try {
          const comp = await db.companyProfile.findUnique({ where: { id: workUnit.companyId } });
          if (comp) {
            const addr = (comp.address as any) || {};
            const pages = addr.onboardingPages || {};
            const page = pages[workUnitId];
            if (page && (page.blocks?.length > 0 || page.welcome || page.instructions || page.checklist?.length > 0)) {
              hasOnboarding = true;
            }
          }
        } catch {}

        // Also check for active contracts that need signing
        let hasUnsignedContracts = false;
        try {
          const wuPrefix = `wu-${workUnitId.slice(0, 8)}-`;
          const allActive = await db.legalAgreement.findMany({
            where: { status: 'active' },
            select: { id: true, slug: true },
          });
          const relevant = allActive.filter((c: any) => c.slug.startsWith(wuPrefix) || !c.slug.startsWith('wu-'));
          if (relevant.length > 0) {
            const signatures = await (db as any).agreementSignature.findMany({
              where: { studentId: student.id, agreementId: { in: relevant.map((c: any) => c.id) } },
            });
            hasUnsignedContracts = signatures.length < relevant.length;
          }
        } catch {}

        // Extract interview token from link URL
        const interviewToken = interviewLink ? interviewLink.split('/interview/')[1] : null;

        return reply.status(201).send({
          ...execution,
          requiresScreening: hasScreening,
          isManualReview: isManual,
          interviewLink,
          interviewToken,
          hasOnboarding: hasOnboarding || hasUnsignedContracts, // Route to onboard page if contracts OR onboarding exist
        });
      } catch (error: any) {
        if (error.message?.startsWith('CONFLICT:')) {
          return conflict(reply, error.message.replace('CONFLICT:', ''));
        }
        throw error;
      }
    }
  );

  // GET /:id/contracts — List contracts the student needs to sign for this execution
  fastify.get<{ Params: { id: string } }>('/:id/contracts', async (request, reply) => {
    const student = (request as any).student;
    if (!student) return forbidden(reply, 'Students only');
    const { id } = request.params;

    const execution = await db.execution.findFirst({
      where: { id, studentId: student.id },
      include: { workUnit: { select: { id: true, companyId: true } } },
    });
    if (!execution) return notFound(reply, 'Execution not found');

    // Contracts are linked to work units via slug prefix: "wu-{wuId.slice(0,8)}-"
    // Company-wide contracts have no "wu-" prefix in their slug
    const wuPrefix = `wu-${execution.workUnitId.slice(0, 8)}-`;

    let contracts: any[] = [];
    try {
      // Get all active contracts
      const allActive = await db.legalAgreement.findMany({
        where: { status: 'active' },
        select: { id: true, title: true, content: true, version: true, slug: true },
      });
      // Filter: task-specific (slug starts with wu-prefix) + company-wide (slug doesn't start with "wu-")
      contracts = allActive.filter((c: any) =>
        c.slug.startsWith(wuPrefix) || !c.slug.startsWith('wu-')
      );
    } catch (err: any) {
      console.warn('[Contracts] Failed to load:', err?.message?.slice(0, 60));
    }

    // Check which ones the student already signed
    let signedIds = new Set<string>();
    if (contracts.length > 0) {
      try {
        const signatures = await (db as any).agreementSignature.findMany({
          where: { studentId: student.id, agreementId: { in: contracts.map((c: any) => c.id) } },
        });
        signedIds = new Set(signatures.map((s: any) => s.agreementId));
      } catch {}
    }

    return reply.send({
      contracts: contracts.map((c: any) => ({
        id: c.id,
        title: c.title,
        content: c.content,
        version: c.version,
        signed: signedIds.has(c.id),
      })),
    });
  });

  // GET /:id/onboarding-status — Check if student needs to complete onboarding/contracts
  fastify.get<{ Params: { id: string } }>('/:id/onboarding-status', async (request, reply) => {
    const student = (request as any).student;
    const company = (request as any).company;
    const { id } = request.params;

    const execution = await db.execution.findFirst({
      where: { id, ...(student ? { studentId: student.id } : {}) },
      include: { workUnit: { select: { id: true, companyId: true, infoCollectionTemplateId: true } } },
    });
    if (!execution) return notFound(reply, 'Execution not found');

    let requiresOnboarding = false;
    let requiresContract = false;
    let requiresScreening = false;

    // Check for onboarding page (stored in CompanyProfile.address.onboardingPages)
    try {
      const company = await db.companyProfile.findUnique({
        where: { id: execution.workUnit.companyId },
      });
      if (company) {
        const addr = (company.address as any) || {};
        const pages = addr.onboardingPages || {};
        const page = pages[execution.workUnitId];
        // Has onboarding if there are blocks, welcome text, instructions, or checklist
        if (page && (page.blocks?.length > 0 || page.welcome || page.instructions || page.checklist?.length > 0)) {
          requiresOnboarding = true;
        }
      }
    } catch (err: any) {
      console.warn('[OnboardingStatus] Onboarding check failed:', err?.message?.slice(0, 60));
    }

    // Check for unsigned contracts (matched by slug prefix)
    if (student) {
      try {
        const wuPrefix = `wu-${execution.workUnitId.slice(0, 8)}-`;
        const allActive = await db.legalAgreement.findMany({
          where: { status: 'active' },
          select: { id: true, slug: true },
        });
        const relevant = allActive.filter((c: any) => c.slug.startsWith(wuPrefix) || !c.slug.startsWith('wu-'));
        if (relevant.length > 0) {
          const signatures = await (db as any).agreementSignature.findMany({
            where: { studentId: student.id, agreementId: { in: relevant.map((c: any) => c.id) } },
          });
          requiresContract = signatures.length < relevant.length;
        }
      } catch (err: any) {
        console.warn('[OnboardingStatus] Contract check failed:', err?.message?.slice(0, 60));
      }
    }

    // Check for screening interview
    if (execution.workUnit.infoCollectionTemplateId && !execution.infoSessionId) {
      requiresScreening = true;
    }

    return reply.send({ requiresOnboarding, requiresContract, requiresScreening });
  });

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

  // POST /:id/reject — Company rejects/cancels a candidate at any pre-completion stage
  fastify.post<{ Params: { id: string } }>(
    '/:id/reject',
    async (request, reply) => {
      const company = (request as any).company;
      if (!company) {
        return forbidden(reply, 'Only companies can reject candidates');
      }

      const { id } = request.params;

      const execution = await db.execution.findFirst({
        where: { id, status: { in: ['pending_review', 'pending_screening', 'assigned', 'clocked_in'] } },
        include: {
          workUnit: true,
          student: { select: { id: true, name: true, clerkId: true } },
        },
      });

      if (!execution) {
        return notFound(reply, 'Execution not found or not in a cancellable state');
      }

      if (execution.workUnit.companyId !== company.id) {
        return forbidden(reply, 'Not your work unit');
      }

      const wasActive = ['assigned', 'clocked_in'].includes(execution.status);

      const updated = await db.execution.update({
        where: { id },
        data: { status: 'cancelled' },
      });

      // Notify the student
      await db.notification.create({
        data: {
          userId: execution.student.clerkId,
          userType: 'student',
          type: wasActive ? 'execution_cancelled' : 'application_rejected',
          title: wasActive ? 'Assignment Cancelled' : 'Application Not Selected',
          body: wasActive
            ? `Your assignment for "${execution.workUnit.title}" has been cancelled by the company.`
            : `Your application for "${execution.workUnit.title}" was not selected.`,
          data: { executionId: id, workUnitId: execution.workUnitId },
          channels: ['in_app'],
        },
      });

      return reply.send(updated);
    }
  );

  // POST /:id/status-update — Contractor sends a custom status update
  fastify.post<{ Params: { id: string }; Body: { statusUpdate: string; files?: string[] } }>(
    '/:id/status-update',
    async (request, reply) => {
      const student = (request as any).student;
      if (!student) return forbidden(reply, 'Only contractors can update status');

      const { id } = request.params;
      const { statusUpdate, files } = request.body;

      if (!statusUpdate?.trim()) return badRequest(reply, 'Status update text is required');

      const execution = await db.execution.findUnique({
        where: { id },
        include: { workUnit: { select: { title: true, companyId: true } } },
      });

      if (!execution || execution.studentId !== student.id) {
        return notFound(reply, 'Execution not found');
      }

      if (['approved', 'failed', 'cancelled'].includes(execution.status)) {
        return badRequest(reply, 'Cannot update status on a completed execution');
      }

      // Save the status update
      const updated = await (db.execution as any).update({
        where: { id },
        data: {
          statusUpdate: statusUpdate.trim(),
          ...(files?.length ? { deliverableUrls: [...(execution.deliverableUrls || []), ...files] } : {}),
        },
      });

      // Also create a notification for the company
      try {
        const company = await db.companyProfile.findUnique({
          where: { id: execution.workUnit.companyId },
          include: { user: { select: { clerkId: true } } },
        });
        if (company?.user?.clerkId) {
          await db.notification.create({
            data: {
              userId: company.user.clerkId,
              userType: 'company',
              type: 'contractor_status_update',
              title: 'Contractor Update',
              body: `${student.name} updated status on "${execution.workUnit.title}": ${statusUpdate.trim().slice(0, 100)}`,
              data: { executionId: id, statusUpdate: statusUpdate.trim() },
              channels: ['in_app'],
            },
          });
        }
      } catch {}

      return reply.send({ success: true, statusUpdate: (updated as any).statusUpdate });
    }
  );

  // POST /:id/milestones/:milestoneId/submit — Student submits a milestone
  fastify.post<{ Params: { id: string; milestoneId: string }; Body: { evidenceUrl?: string; fileUrls?: string[]; notes?: string } }>(
    '/:id/milestones/:milestoneId/submit',
    async (request, reply) => {
      const student = (request as any).student;
      if (!student) return forbidden(reply, 'Only students can submit milestones');

      const { id, milestoneId } = request.params;
      const { evidenceUrl, fileUrls, notes } = request.body;

      const execution = await db.execution.findFirst({
        where: { id, studentId: student.id },
        include: { workUnit: true },
      });
      if (!execution) return notFound(reply, 'Execution not found');
      if (['approved', 'failed', 'cancelled'].includes(execution.status)) {
        return badRequest(reply, 'Execution already finalized');
      }

      const milestone = await (db as any).taskMilestone.findFirst({
        where: { id: milestoneId, executionId: id },
        include: { template: true },
      });
      if (!milestone) return notFound(reply, 'Milestone not found');
      if (milestone.status === 'approved') return badRequest(reply, 'Milestone already approved');

      // Calculate payout amount for this milestone
      const payoutPercent = milestone.template.payoutPercent || 0;
      const payoutAmount = Math.round(execution.workUnit.priceInCents * (payoutPercent / 100));

      const updated = await (db as any).taskMilestone.update({
        where: { id: milestoneId },
        data: {
          status: milestone.template.requiresReview ? 'submitted' : 'approved',
          submittedAt: new Date(),
          completedAt: milestone.template.requiresReview ? null : new Date(),
          evidenceUrl: evidenceUrl || null,
          fileUrls: fileUrls || [],
          notes: notes || null,
          payoutAmountInCents: payoutAmount > 0 ? payoutAmount : null,
        },
        include: { template: true },
      });

      // If no review required, auto-approve
      if (!milestone.template.requiresReview && payoutAmount > 0) {
        await (db as any).taskMilestone.update({
          where: { id: milestoneId },
          data: { verifiedAt: new Date(), verifiedBy: 'auto', payoutStatus: 'completed' },
        });
      }

      // Notify company about milestone submission
      try {
        const company = await db.companyProfile.findUnique({ where: { id: execution.workUnit.companyId } });
        if (company) {
          await db.notification.create({
            data: {
              userId: company.userId,
              userType: 'company',
              type: 'milestone_submitted',
              title: 'Milestone Submitted',
              body: `${student.name} submitted "${milestone.template.description}" for "${execution.workUnit.title}"`,
              data: { executionId: id, milestoneId, workUnitId: execution.workUnitId },
              channels: ['in_app'],
            },
          });
        }
      } catch {}

      return reply.send({ success: true, milestone: updated });
    }
  );

  // POST /:id/milestones/:milestoneId/complete — Backward compat alias
  fastify.post<{ Params: { id: string; milestoneId: string }; Body: { evidenceUrl?: string; notes?: string } }>(
    '/:id/milestones/:milestoneId/complete',
    async (request, reply) => {
      // Redirect to the submit endpoint
      const { id, milestoneId } = request.params;
      const { evidenceUrl, notes } = request.body;
      const student = (request as any).student;
      if (!student) return forbidden(reply, 'Only students can complete milestones');

      const milestone = await (db as any).taskMilestone.findFirst({
        where: { id: milestoneId, executionId: id },
        include: { template: true },
      });
      if (!milestone) return notFound(reply, 'Milestone not found');

      await (db as any).taskMilestone.update({
        where: { id: milestoneId },
        data: {
          status: 'submitted',
          submittedAt: new Date(),
          completedAt: new Date(),
          evidenceUrl: evidenceUrl || null,
          notes: notes || null,
        },
        include: { template: true },
      });

      return reply.send({ success: true });
    }
  );

  // POST /:id/milestones/:milestoneId/review — Company reviews a milestone submission
  fastify.post<{ Params: { id: string; milestoneId: string }; Body: { verdict: 'approved' | 'revision_needed'; feedback?: string } }>(
    '/:id/milestones/:milestoneId/review',
    async (request, reply) => {
      const company = (request as any).company;
      if (!company) return forbidden(reply, 'Only companies can review milestones');

      const { id, milestoneId } = request.params;
      const { verdict, feedback } = request.body;

      const execution = await db.execution.findFirst({
        where: { id, workUnit: { companyId: company.id } },
        include: { workUnit: true, student: { select: { name: true, id: true } } },
      });
      if (!execution) return notFound(reply, 'Execution not found');

      const milestone = await (db as any).taskMilestone.findFirst({
        where: { id: milestoneId, executionId: id },
        include: { template: true },
      });
      if (!milestone) return notFound(reply, 'Milestone not found');
      if (milestone.status !== 'submitted') return badRequest(reply, 'Milestone not submitted for review');

      if (verdict === 'approved') {
        await (db as any).taskMilestone.update({
          where: { id: milestoneId },
          data: {
            status: 'approved',
            completedAt: new Date(),
            verifiedAt: new Date(),
            verifiedBy: 'company',
            payoutStatus: milestone.payoutAmountInCents > 0 ? 'processing' : 'completed',
          },
        });

        // Trigger milestone payout if amount > 0
        if (milestone.payoutAmountInCents > 0 && execution.student) {
          // Queue payout (handled by payout worker)
          try {
            const studentProfile = await db.studentProfile.findUnique({ where: { id: execution.studentId } });
            if (studentProfile?.stripeConnectId) {
              const { createTransfer } = await import('../lib/stripe-service.js');
              await createTransfer({
                amountInCents: milestone.payoutAmountInCents,
                destinationAccountId: studentProfile.stripeConnectId,
                executionId: id,
                description: `Milestone payout: ${milestone.template.description}`,
              });
              await (db as any).taskMilestone.update({
                where: { id: milestoneId },
                data: { payoutStatus: 'completed' },
              });
            }
          } catch (err: any) {
            console.error('[MilestoneReview] Payout failed:', err?.message?.slice(0, 100));
          }
        }
      } else {
        // Revision needed
        await (db as any).taskMilestone.update({
          where: { id: milestoneId },
          data: {
            status: 'revision_needed',
            revisionNotes: feedback || 'Please revise and resubmit.',
            completedAt: null,
            submittedAt: null,
          },
        });
      }

      // Notify student
      try {
        await db.notification.create({
          data: {
            userId: execution.student.id,
            userType: 'student',
            type: verdict === 'approved' ? 'milestone_approved' : 'milestone_revision',
            title: verdict === 'approved' ? 'Milestone Approved' : 'Revision Requested',
            body: verdict === 'approved'
              ? `"${milestone.template.description}" approved${milestone.payoutAmountInCents > 0 ? ` — $${(milestone.payoutAmountInCents / 100).toFixed(2)} payout processing` : ''}`
              : `"${milestone.template.description}" needs revision: ${feedback || 'See notes'}`,
            data: { executionId: id, milestoneId },
            channels: ['in_app'],
          },
        });
      } catch {}

      return reply.send({ success: true, verdict });
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

      // If pending_screening or pending_review with screening, resolve the interview link URL for the student
      let interviewLink: string | null = null;
      if ((execution.status === 'pending_screening' || execution.status === 'pending_review') && execution.infoSessionId) {
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

  // POST /:id/approve-application — Company approves a pending_review or pending_screening application
  fastify.post<{ Params: { id: string } }>(
    '/:id/approve-application',
    async (request, reply) => {
      const company = (request as any).company;
      if (!company) return forbidden(reply, 'Only companies can approve applications');

      const { id } = request.params;
      const execution = await db.execution.findFirst({
        where: { id, workUnit: { companyId: company.id }, status: { in: ['pending_review', 'pending_screening'] } },
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

          // Trigger re-evaluation of dependent work units
          try {
            const dependents = await getDependentWorkUnits(execution.workUnitId);
            if (dependents.length > 0) {
              console.log(`[Executions] Work unit ${execution.workUnitId} completed, triggering re-evaluation for ${dependents.length} dependent work unit(s)`);
              // The scheduler worker will pick these up on the next cycle
            }
          } catch (err) {
            console.error('[Executions] Error checking dependent work units:', err);
          }

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

  // POST /:id/assist - AI assistant with full task + company context + conversation memory
  fastify.post<{ Params: { id: string }; Body: { question: string; conversationHistory?: Array<{ role: string; content: string }> } }>(
    '/:id/assist',
    async (request, reply) => {
      const { student } = request as any;
      if (!student) {
        return forbidden(reply, 'Only students can use the work assistant');
      }

      const { id } = request.params;
      const { question, conversationHistory } = request.body;

      if (!question || question.trim().length < 3) {
        return badRequest(reply, 'Please provide a question');
      }

      const execution = await db.execution.findUnique({
        where: { id },
        include: {
          workUnit: {
            include: {
              milestoneTemplates: { orderBy: { orderIndex: 'asc' } },
              company: { select: { companyName: true, website: true, address: true } },
            },
          },
          milestones: true,
          revisionRequests: { orderBy: { createdAt: 'desc' }, take: 3 },
          powLogs: { orderBy: { requestedAt: 'desc' }, take: 3 },
        },
      });

      if (!execution) {
        return notFound(reply, 'Execution not found');
      }

      if (execution.studentId !== student.id) {
        return forbidden(reply, 'Access denied');
      }

      if (!['assigned', 'clocked_in', 'revision_needed', 'submitted'].includes(execution.status)) {
        return badRequest(reply, 'Assistant only available for active tasks');
      }

      // Build rich context with task + company + onboarding knowledge
      const context = buildAssistantContext(execution);
      
      // Get onboarding page content if it exists (company knowledge base)
      let onboardingContext = '';
      try {
        const company = execution.workUnit.company;
        const addr = (company.address as any) || {};
        const pages = addr.onboardingPages || {};
        const page = pages[execution.workUnit.id];
        if (page?.blocks?.length) {
          const blockTexts = page.blocks.map((b: any) => {
            const c = b.content || {};
            if (b.type === 'hero') return `# ${c.heading || ''}\n${c.subheading || ''}`;
            if (b.type === 'text') return `## ${c.heading || ''}\n${c.body || ''}`;
            if (b.type === 'checklist') return `Checklist: ${c.heading || ''}\n${(c.items || []).map((i: string) => `- ${i}`).join('\n')}`;
            if (b.type === 'cta') return `CTA: ${c.heading || ''} — ${c.body || ''}`;
            return '';
          }).filter(Boolean).join('\n\n');
          onboardingContext = `\n\nONBOARDING PAGE CONTENT (company-provided instructions):\n${blockTexts}`;
        }
      } catch {}

      // Get shared context from dependencies if available
      let sharedContext = '';
      try {
        const conds = execution.workUnit.publishConditions as any;
        if (conds?.dependencies?.length) {
          const depIds = conds.dependencies.map((d: any) => d.workUnitId).filter(Boolean);
          if (depIds.length > 0) {
            const depWUs = await db.workUnit.findMany({
              where: { id: { in: depIds } },
              select: { title: true, spec: true },
            });
            if (depWUs.length > 0) {
              sharedContext = '\n\nRELATED TASKS (your work builds on these):\n' +
                depWUs.map(d => `- ${d.title}: ${(d.spec || '').slice(0, 200)}`).join('\n');
            }
          }
        }
      } catch {}

      const { getOpenAIClient } = await import('@figwork/ai');
      const openai = getOpenAIClient();

      // Build messages with conversation history for multi-turn chat
      const messages: any[] = [
        {
          role: 'system',
          content: `You are a knowledgeable work assistant for a contractor on the Figwork platform. You have full knowledge of:
- The task requirements, spec, and acceptance criteria
- The company that posted this task (${execution.workUnit.company.companyName})
- The onboarding instructions the company provided
- Any previous revision feedback
- Milestone progress and deadlines

YOUR ROLE:
1. Answer questions about the task, company, requirements, or deliverable format
2. Clarify ambiguous instructions using the onboarding content and task spec
3. Interpret revision feedback and suggest how to address it
4. Help with approach and best practices for the task category
5. If the contractor wants to contact the client directly, tell them to use the "Request Meeting" button

RULES:
- NEVER produce actual deliverables (no code, no designs, no written content)
- NEVER provide complete solutions — guide them to find the answer
- Be conversational, helpful, and specific to THIS task
- Reference specific details from the task spec and onboarding page
- Keep responses under 300 words
- If you don't know something about the company, say so honestly

TASK CONTEXT:
${context}${onboardingContext}${sharedContext}`,
        },
      ];

      // Add conversation history (last 10 messages max)
      if (conversationHistory?.length) {
        const recent = conversationHistory.slice(-10);
        for (const msg of recent) {
          if (msg.role === 'user' || msg.role === 'assistant') {
            messages.push({ role: msg.role, content: (msg.content || '').slice(0, 500) });
          }
        }
      }

      messages.push({ role: 'user', content: question });

      const response = await openai.chat.completions.create({
        model: 'gpt-5.2',
        messages,
        max_completion_tokens: 600,
        temperature: 0.3,
      });

      const answer = response.choices[0]?.message?.content || 'Sorry, I couldn\'t generate a response. Try rephrasing your question.';

      return reply.send({
        answer,
        disclaimer: 'This assistant provides guidance only. You must complete the actual work yourself.',
      });
    }
  );

  // POST /:id/request-meeting - Contractor requests a meeting with the client
  fastify.post<{ Params: { id: string }; Body: { message?: string; preferredTime?: string } }>(
    '/:id/request-meeting',
    async (request, reply) => {
      const { student } = request as any;
      if (!student) return forbidden(reply, 'Only students can request meetings');

      const { id } = request.params;
      const { message, preferredTime } = request.body;

      const execution = await db.execution.findUnique({
        where: { id },
        include: {
          workUnit: { include: { company: { include: { user: true } } } },
        },
      });

      if (!execution) return notFound(reply, 'Execution not found');
      if (execution.studentId !== student.id) return forbidden(reply, 'Access denied');

      // Create notification for the company
      await db.notification.create({
        data: {
          userId: execution.workUnit.company.user.clerkId,
          userType: 'company',
          type: 'meeting_request',
          title: `Meeting requested by ${student.name}`,
          body: `${student.name} working on "${execution.workUnit.title}" is requesting a meeting.${message ? ` Message: ${message}` : ''}${preferredTime ? ` Preferred time: ${preferredTime}` : ''}`,
          channels: ['in_app', 'email'],
          data: {
            executionId: id,
            workUnitId: execution.workUnit.id,
            studentId: student.id,
            studentName: student.name,
            message: message || null,
            preferredTime: preferredTime || null,
          },
        },
      });

      // Also notify the student it was sent
      await db.notification.create({
        data: {
          userId: student.clerkId,
          userType: 'student',
          type: 'meeting_request_sent',
          title: 'Meeting request sent',
          body: `Your meeting request for "${execution.workUnit.title}" has been sent to ${execution.workUnit.company.companyName}.`,
          channels: ['in_app'],
        },
      });

      return reply.send({
        success: true,
        message: `Meeting request sent to ${execution.workUnit.company.companyName}. They'll be notified via email and in-app notification.`,
      });
    }
  );

  // ====================
  // EXECUTION MESSAGING (client ↔ contractor)
  // ====================

  // GET /:id/messages — List all messages in thread
  fastify.get<{ Params: { id: string } }>(
    '/:id/messages',
    async (request, reply) => {
      const authResult = await verifyClerkAuth(request, reply);
      if (!authResult) return;
      const { id } = request.params;

      // Verify access — must be the assigned student OR the company that owns the WU
      const execution = await db.execution.findUnique({
        where: { id },
        include: { workUnit: { select: { companyId: true } }, student: { select: { clerkId: true } } },
      });
      if (!execution) return notFound(reply, 'Execution not found');

      const user = await db.user.findUnique({ where: { clerkId: authResult.userId }, include: { companyProfile: true } });
      const isCompany = user?.companyProfile?.id === execution.workUnit.companyId;
      const isStudent = execution.student.clerkId === authResult.userId;
      if (!isCompany && !isStudent) return forbidden(reply, 'Access denied');

      const messages = await (db as any).executionMessage.findMany({
        where: { executionId: id },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });

      // Count unread for the current user
      const myType = isCompany ? 'company' : 'student';
      const unreadCount = messages.filter((m: any) => m.senderType !== myType && m.senderType !== 'system' && !m.readAt).length;

      return reply.send({ messages, unreadCount });
    }
  );

  // POST /:id/messages — Send a message
  fastify.post<{ Params: { id: string }; Body: { content: string; messageType?: string; attachments?: any[]; metadata?: any } }>(
    '/:id/messages',
    async (request, reply) => {
      const authResult = await verifyClerkAuth(request, reply);
      if (!authResult) return;
      const { id } = request.params;
      const { content, messageType, attachments, metadata } = request.body;

      if (!content?.trim()) return badRequest(reply, 'Message content is required');
      if (content.length > 10000) return badRequest(reply, 'Message too long (max 10,000 characters)');

      const execution = await db.execution.findUnique({
        where: { id },
        include: {
          workUnit: { include: { company: { include: { user: true } } } },
          student: { select: { id: true, clerkId: true, name: true } },
        },
      });
      if (!execution) return notFound(reply, 'Execution not found');

      const user = await db.user.findUnique({ where: { clerkId: authResult.userId }, include: { companyProfile: true } });
      const isCompany = user?.companyProfile?.id === execution.workUnit.companyId;
      const isStudent = execution.student.clerkId === authResult.userId;
      if (!isCompany && !isStudent) return forbidden(reply, 'Access denied');

      const senderType = isCompany ? 'company' : 'student';
      const senderName = isCompany ? execution.workUnit.company.companyName : execution.student.name;

      const message = await (db as any).executionMessage.create({
        data: {
          executionId: id,
          senderId: authResult.userId,
          senderType,
          senderName: senderName || 'Unknown',
          messageType: messageType || 'text',
          content: content.trim(),
          attachments: attachments || undefined,
          metadata: metadata || undefined,
        },
      });

      // Notify the other party
      if (isCompany) {
        // Notify the student
        await db.notification.create({
          data: {
            userId: execution.student.clerkId,
            userType: 'student',
            type: 'execution_message',
            title: `Message from ${senderName}`,
            body: content.slice(0, 150),
            channels: ['in_app', 'email'],
            data: { executionId: id, messageId: message.id, workUnitTitle: execution.workUnit.title },
          },
        });
      } else {
        // Notify the company
        await db.notification.create({
          data: {
            userId: execution.workUnit.company.user.clerkId,
            userType: 'company',
            type: 'execution_message',
            title: `Message from ${senderName} on "${execution.workUnit.title}"`,
            body: content.slice(0, 150),
            channels: ['in_app', 'email'],
            data: { executionId: id, messageId: message.id, workUnitId: execution.workUnit.id, studentName: senderName },
          },
        });
      }

      // Emit WebSocket event if available
      try {
        const { getIO } = await import('../websocket/index.js');
        const io = getIO();
        if (io) {
          const marketplace = io.of('/marketplace');
          // Emit to both user-specific room and execution room
          const userRoom = isCompany ? `student:${execution.student.clerkId}` : `company:${execution.workUnit.company.user.clerkId}`;
          const execRoom = `execution:${id}`;
          const payload = { executionId: id, message };
          marketplace.to(userRoom).emit('execution:message:new', payload);
          marketplace.to(execRoom).emit('execution:message:new', payload);
        }
      } catch {}

      return reply.status(201).send(message);
    }
  );

  // POST /:id/messages/read-all — Mark all messages as read
  fastify.post<{ Params: { id: string } }>(
    '/:id/messages/read-all',
    async (request, reply) => {
      const authResult = await verifyClerkAuth(request, reply);
      if (!authResult) return;
      const { id } = request.params;

      const execution = await db.execution.findUnique({
        where: { id },
        include: { workUnit: { select: { companyId: true } }, student: { select: { clerkId: true } } },
      });
      if (!execution) return notFound(reply, 'Execution not found');

      const user = await db.user.findUnique({ where: { clerkId: authResult.userId }, include: { companyProfile: true } });
      const isCompany = user?.companyProfile?.id === execution.workUnit.companyId;
      const isStudent = execution.student.clerkId === authResult.userId;
      if (!isCompany && !isStudent) return forbidden(reply, 'Access denied');

      // Mark messages from the OTHER party as read
      const otherType = isCompany ? 'student' : 'company';
      await (db as any).executionMessage.updateMany({
        where: { executionId: id, senderType: { in: [otherType, 'ai'] }, readAt: null },
        data: { readAt: new Date() },
      });

      return reply.send({ success: true });
    }
  );

  // GET /:id/messages/unread — Get unread count (lightweight for badges)
  fastify.get<{ Params: { id: string } }>(
    '/:id/messages/unread',
    async (request, reply) => {
      const authResult = await verifyClerkAuth(request, reply);
      if (!authResult) return;
      const { id } = request.params;

      const execution = await db.execution.findUnique({
        where: { id },
        include: { workUnit: { select: { companyId: true } }, student: { select: { clerkId: true } } },
      });
      if (!execution) return notFound(reply, 'Execution not found');

      const user = await db.user.findUnique({ where: { clerkId: authResult.userId }, include: { companyProfile: true } });
      const isCompany = user?.companyProfile?.id === execution.workUnit.companyId;
      const isStudent = execution.student.clerkId === authResult.userId;
      if (!isCompany && !isStudent) return forbidden(reply, 'Access denied');

      const otherType = isCompany ? 'student' : 'company';
      const count = await (db as any).executionMessage.count({
        where: { executionId: id, senderType: { in: [otherType, 'ai'] }, readAt: null },
      });

      return reply.send({ unreadCount: count });
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
  const wu = execution.workUnit;
  const company = wu.company;
  const lines: string[] = [];

  // Company info
  lines.push(`COMPANY: ${company.companyName}${company.website ? ` (${company.website})` : ''}`);

  // Task details
  lines.push(`\nTASK: ${wu.title}`);
  lines.push(`Category: ${wu.category}`);
  lines.push(`Status: ${execution.status}`);
  lines.push(`Price: $${(wu.priceInCents / 100).toFixed(2)}`);
  lines.push(`Complexity: ${wu.complexityScore}/5`);
  if (wu.requiredSkills?.length) lines.push(`Required Skills: ${wu.requiredSkills.join(', ')}`);

  // Full spec
  lines.push(`\nSPECIFICATION:\n${wu.spec || wu.description || 'No detailed spec provided.'}`);

  // Acceptance criteria
  if (wu.acceptanceCriteria) {
    const criteria = Array.isArray(wu.acceptanceCriteria) ? wu.acceptanceCriteria : [wu.acceptanceCriteria];
    lines.push(`\nACCEPTANCE CRITERIA:`);
    criteria.forEach((c: any) => {
      if (typeof c === 'string') lines.push(`- ${c}`);
      else if (c.criterion) lines.push(`- ${c.criterion}${c.required ? ' (required)' : ''}`);
    });
  }

  // Deliverable format
  if (wu.deliverableFormat?.length) {
    lines.push(`\nDELIVERABLE FORMAT: ${Array.isArray(wu.deliverableFormat) ? wu.deliverableFormat.join(', ') : wu.deliverableFormat}`);
  }

  // Milestones with progress
  if (wu.milestoneTemplates?.length > 0) {
    const completed = execution.milestones?.filter((m: any) => m.completedAt).length || 0;
    lines.push(`\nMILESTONES (${completed}/${wu.milestoneTemplates.length} done):`);
    wu.milestoneTemplates.forEach((m: any, i: number) => {
      const done = execution.milestones?.find((em: any) => em.templateId === m.id)?.completedAt;
      lines.push(`${i + 1}. ${m.description} ${done ? '✓ completed' : '○ pending'}`);
    });
  }

  // Revision feedback (critical for contractor)
  if (execution.revisionRequests?.length > 0) {
    lines.push(`\nREVISION FEEDBACK (address these issues):`);
    execution.revisionRequests.forEach((r: any, i: number) => {
      lines.push(`Revision ${i + 1}: ${r.overallFeedback}`);
      if (r.issues) {
        try {
          const issues = typeof r.issues === 'string' ? JSON.parse(r.issues) : r.issues;
          if (Array.isArray(issues)) {
            issues.forEach((issue: any) => {
              lines.push(`  • ${issue.criterion || 'Issue'}: ${issue.issue || issue}`);
            });
          }
        } catch {}
      }
    });
  }

  // POW check history
  if (execution.powLogs?.length > 0) {
    const failed = execution.powLogs.filter((p: any) => p.status === 'failed').length;
    if (failed > 0) {
      lines.push(`\n⚠ POW CHECK: ${failed} failed check-in(s). Stay active and responsive.`);
    }
  }

  // Deadline
  if (execution.deadlineAt) {
    const hoursRemaining = Math.max(0, (new Date(execution.deadlineAt).getTime() - Date.now()) / (1000 * 60 * 60));
    const urgency = hoursRemaining < 6 ? '🔴 URGENT' : hoursRemaining < 24 ? '🟡 Soon' : '🟢 OK';
    lines.push(`\nDEADLINE: ${Math.round(hoursRemaining)} hours remaining ${urgency}`);
  }

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
