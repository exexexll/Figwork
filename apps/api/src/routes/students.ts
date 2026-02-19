import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '@figwork/db';
import { TIER_CONFIG } from '@figwork/shared';
import { verifyClerkAuth } from '../lib/clerk.js';
import { unauthorized, forbidden, badRequest, notFound, conflict } from '../lib/http-errors.js';
import {
  createIdentityVerificationSession,
  getIdentityVerificationStatus,
  createExpressAccount,
  createConnectAccountLink,
  getConnectAccountStatus,
} from '../lib/stripe-service.js';
import {
  startPhoneVerification,
  checkPhoneVerification,
} from '../lib/twilio-service.js';
import {
  sendContractorAgreement,
  getEnvelopeStatus,
  isDocuSignConfigured,
} from '../lib/docusign-service.js';
import { sendWelcomeEmail } from '../lib/email-service.js';

// Type definitions
interface RegisterStudentBody {
  email: string;
  name: string;
  phone: string;
  skillTags?: string[];
}

interface UpdateProfileBody {
  name?: string;
  phone?: string;
  skillTags?: string[];
  specializations?: string[];
  notificationPrefs?: object;
}

interface UploadFileBody {
  filename: string;
  fileType: string;
  category: 'resume' | 'certificate' | 'portfolio' | 'other';
}

interface SubmitPOWBody {
  workPhotoUrl: string;
  selfiePhotoUrl: string;
  progressDescription?: string;
}

interface FileDisputeBody {
  executionId: string;
  reason: string;
  evidenceUrls?: string[];
}

export async function studentRoutes(fastify: FastifyInstance) {
  // ====================
  // REGISTRATION
  // ====================

  // POST /register
  fastify.post<{ Body: RegisterStudentBody }>(
    '/register',
    async (request, reply) => {
      const authResult = await verifyClerkAuth(request, reply);
      if (!authResult) return;

      const { email, name, phone, skillTags } = request.body;

      const existing = await db.studentProfile.findUnique({
        where: { clerkId: authResult.userId },
      });
      if (existing) {
        return conflict(reply, 'Student profile already exists');
      }

      const emailExists = await db.studentProfile.findUnique({
        where: { email },
      });
      if (emailExists) {
        return conflict(reply, 'Email already registered');
      }

      const student = await db.studentProfile.create({
        data: {
          clerkId: authResult.userId,
          email,
          name,
          phone,
          skillTags: skillTags || [],
          specializations: [],
          tier: 'novice',
          kycStatus: 'pending',
          taxStatus: 'pending',
          contractStatus: 'pending',
          stripeConnectStatus: 'pending',
        },
      });

      // Send welcome email (non-blocking)
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      sendWelcomeEmail(email, {
        name,
        dashboardUrl: `${frontendUrl}/student`,
      }).catch((err) => fastify.log.error('Welcome email failed:', err));

      // Kick off phone verification (non-blocking)
      startPhoneVerification(phone).catch((err) =>
        fastify.log.error('Phone verification start failed:', err)
      );

      return reply.status(201).send({
        id: student.id,
        nextStep: 'phone_verification',
        message: 'Verification code sent to your phone',
      });
    }
  );

  // ====================
  // AUTHENTICATED ROUTES
  // ====================

  // Middleware
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url.endsWith('/register') && request.method === 'POST') {
      return;
    }

    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const student = await db.studentProfile.findUnique({
      where: { clerkId: authResult.userId },
    });

    if (!student && !request.url.includes('/register')) {
      return forbidden(reply, 'Student profile not found. Please register first.');
    }

    (request as any).student = student;
  });

  // POST /verify-phone/send — Send OTP via Twilio Verify
  fastify.post('/verify-phone/send', async (request, reply) => {
    const student = (request as any).student;

    if (!student.phone) {
      return badRequest(reply, 'No phone number on file');
    }

    const result = await startPhoneVerification(student.phone);

    if (!result.success) {
      return reply.status(500).send({ error: result.error || 'Failed to send verification code' });
    }

    return reply.send({ sent: true, message: 'Verification code sent to your phone' });
  });

  // POST /verify-phone — Check OTP via Twilio Verify
  fastify.post<{ Body: { code: string } }>(
    '/verify-phone',
    async (request, reply) => {
      const student = (request as any).student;
      const { code } = request.body;

      if (!code || code.length < 4) {
        return badRequest(reply, 'Please enter a valid verification code');
      }

      const result = await checkPhoneVerification(student.phone, code);

      if (!result.success) {
        return badRequest(reply, result.error || 'Invalid verification code');
      }

      return reply.send({
        verified: true,
        nextStep: 'kyc',
        message: 'Phone verified successfully',
      });
    }
  );

  // GET /kyc/session — Create or retrieve a Stripe Identity verification session
  fastify.get('/kyc/session', async (request, reply) => {
    const student = (request as any).student;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    if (student.kycStatus === 'verified') {
      return badRequest(reply, 'KYC already verified');
    }

    // If there's an existing session, check its status first
    if (student.stripeIdentityId) {
      try {
        const existingStatus = await getIdentityVerificationStatus(student.stripeIdentityId);
        if (existingStatus.status === 'verified') {
          await db.studentProfile.update({
            where: { id: student.id },
            data: { kycStatus: 'verified' },
          });
          return reply.send({ alreadyVerified: true });
        }
        if (existingStatus.status === 'requires_input') {
          // Session still active — return it
          return reply.send({
            sessionId: student.stripeIdentityId,
            clientSecret: null, // Client should re-use the session
            url: `${frontendUrl}/student/onboard?step=kyc`,
            status: existingStatus.status,
          });
        }
        // Otherwise (canceled, processing) — create a new one
      } catch {
        // Session may be expired — create a new one
      }
    }

    // Create a new Stripe Identity verification session
    const session = await createIdentityVerificationSession({
      studentId: student.id,
      returnUrl: `${frontendUrl}/student/onboard?step=kyc&status=complete`,
    });

    await db.studentProfile.update({
      where: { id: student.id },
      data: {
        kycStatus: 'in_progress',
        stripeIdentityId: session.sessionId,
      },
    });

    return reply.send({
      sessionId: session.sessionId,
      clientSecret: session.clientSecret,
      url: session.url,
    });
  });

  // GET /kyc/status — Poll KYC verification status
  fastify.get('/kyc/status', async (request, reply) => {
    const student = (request as any).student;

    if (!student.stripeIdentityId) {
      return reply.send({ status: student.kycStatus || 'pending' });
    }

    const status = await getIdentityVerificationStatus(student.stripeIdentityId);

    // Sync status to DB if changed
    let dbStatus = student.kycStatus;
    if (status.status === 'verified' && dbStatus !== 'verified') {
      dbStatus = 'verified';
      await db.studentProfile.update({
        where: { id: student.id },
        data: { kycStatus: 'verified' },
      });
    } else if (status.status === 'requires_input' && dbStatus !== 'action_required') {
      dbStatus = 'action_required';
    }

    return reply.send({
      status: dbStatus,
      stripeStatus: status.status,
      lastError: status.lastError,
    });
  });

  // GET /tax/form
  fastify.get('/tax/form', async (request, reply) => {
    const student = (request as any).student;

    if (student.taxStatus === 'verified') {
      return badRequest(reply, 'Tax form already submitted');
    }

    const formType = 'W9';

    return reply.send({
      formType,
      stripeUrl: 'https://dashboard.stripe.com/tax/mock',
      instructions: 'Complete your W-9 form for US tax reporting',
    });
  });

  // GET /contract — Send contractor agreement via DocuSign for signing
  fastify.get('/contract', async (request, reply) => {
    const student = (request as any).student;

    if (student.contractStatus === 'signed') {
      return badRequest(reply, 'Contract already signed');
    }

    // If there's an existing envelope, check its status
    if (student.docusignEnvelopeId) {
      try {
        const envStatus = await getEnvelopeStatus(student.docusignEnvelopeId);
        if (envStatus.status === 'completed') {
          await db.studentProfile.update({
            where: { id: student.id },
            data: { contractStatus: 'signed' },
          });
          return reply.send({ alreadySigned: true });
        }
        if (envStatus.status === 'sent' || envStatus.status === 'delivered') {
          // Envelope already sent — return existing info
          return reply.send({
            envelopeId: student.docusignEnvelopeId,
            status: envStatus.status,
            message: 'Contract already sent. Please check your email or continue signing.',
          });
        }
        // Otherwise (voided, declined) — create new
      } catch {
        // Envelope may not exist — create new
      }
    }

    // Get the latest active contractor agreement from DB
    const latestAgreement = await (db as any).legalAgreement.findFirst({
      where: { status: 'active', title: { contains: 'Contractor' } },
      orderBy: { version: 'desc' },
    });

    const agreementContent = latestAgreement?.content || getDefaultContractorAgreement(student.name);
    const agreementName = latestAgreement?.title || 'Figwork Contractor Agreement';
    const agreementVersion = String(latestAgreement?.version || 1);

    // Lookup the student's email from the User table
    const user = await db.user.findFirst({
      where: { id: student.userId },
      select: { email: true },
    });

    const result = await sendContractorAgreement({
      studentId: student.id,
      studentName: student.name,
      studentEmail: user?.email || '',
      agreementContent,
      agreementName,
      agreementVersion,
      clientUserId: student.id, // For embedded signing
    });

    await db.studentProfile.update({
      where: { id: student.id },
      data: {
        contractStatus: 'pending_signature',
        docusignEnvelopeId: result.envelopeId,
      },
    });

    return reply.send({
      envelopeId: result.envelopeId,
      signingUrl: result.signingUrl,
    });
  });

  // GET /contract/status — Poll contract signing status
  fastify.get('/contract/status', async (request, reply) => {
    const student = (request as any).student;

    if (!student.docusignEnvelopeId) {
      return reply.send({ status: student.contractStatus || 'pending' });
    }

    const envStatus = await getEnvelopeStatus(student.docusignEnvelopeId);

    // Sync status
    if (envStatus.status === 'completed' && student.contractStatus !== 'signed') {
      await db.studentProfile.update({
        where: { id: student.id },
        data: { contractStatus: 'signed' },
      });
      return reply.send({ status: 'signed', completedAt: envStatus.completedDateTime });
    }

    if (envStatus.status === 'declined') {
      await db.studentProfile.update({
        where: { id: student.id },
        data: { contractStatus: 'declined' },
      });
      return reply.send({ status: 'declined' });
    }

    return reply.send({
      status: student.contractStatus,
      envelopeStatus: envStatus.status,
    });
  });

  // GET /connect/onboard — Create or resume Stripe Connect Express onboarding
  fastify.get('/connect/onboard', async (request, reply) => {
    const student = (request as any).student;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    if (student.stripeConnectStatus === 'active') {
      return badRequest(reply, 'Stripe Connect already active');
    }

    // If the student already has a Connect account, check status and create link
    let accountId = student.stripeConnectId;

    if (accountId) {
      try {
        const status = await getConnectAccountStatus(accountId);
        if (status.chargesEnabled && status.payoutsEnabled) {
          await db.studentProfile.update({
            where: { id: student.id },
            data: { stripeConnectStatus: 'active' },
          });
          return reply.send({ alreadyActive: true });
        }
        // Account exists but onboarding incomplete — generate new link
      } catch {
        // Account may have been deleted — create new
        accountId = null;
      }
    }

    // Create Express account if needed
    if (!accountId) {
      const user = await db.user.findFirst({
        where: { id: student.userId },
        select: { email: true },
      });

      const account = await createExpressAccount({
        email: user?.email || '',
        studentId: student.id,
      });
      accountId = account.accountId;

      await db.studentProfile.update({
        where: { id: student.id },
        data: {
          stripeConnectId: accountId,
          stripeConnectStatus: 'onboarding',
        },
      });
    }

    // Generate an account link for the Connect onboarding flow
    const onboardUrl = await createConnectAccountLink(
      accountId,
      `${frontendUrl}/student/onboard?step=connect&status=complete`,
      `${frontendUrl}/student/onboard?step=connect&status=refresh`
    );

    return reply.send({
      accountId,
      url: onboardUrl,
    });
  });

  // GET /connect/status — Poll Connect account status
  fastify.get('/connect/status', async (request, reply) => {
    const student = (request as any).student;

    if (!student.stripeConnectId) {
      return reply.send({ status: student.stripeConnectStatus || 'pending' });
    }

    try {
      const status = await getConnectAccountStatus(student.stripeConnectId);
      const isActive = status.chargesEnabled && status.payoutsEnabled;

      if (isActive && student.stripeConnectStatus !== 'active') {
        await db.studentProfile.update({
          where: { id: student.id },
          data: { stripeConnectStatus: 'active' },
        });
      }

      return reply.send({
        status: isActive ? 'active' : student.stripeConnectStatus,
        chargesEnabled: status.chargesEnabled,
        payoutsEnabled: status.payoutsEnabled,
        detailsSubmitted: status.detailsSubmitted,
      });
    } catch {
      return reply.send({ status: student.stripeConnectStatus || 'unknown' });
    }
  });

  // GET /me
  fastify.get('/me', async (request, reply) => {
    const student = (request as any).student;
    const tierConfig = TIER_CONFIG[student.tier as keyof typeof TIER_CONFIG];

    return reply.send({
      ...student,
      tierConfig: {
        name: tierConfig.name,
        color: tierConfig.color,
        benefits: tierConfig.benefits,
        nextTierRequirements: student.tier !== 'elite' 
          ? TIER_CONFIG[student.tier === 'novice' ? 'pro' : 'elite'].requirements
          : null,
      },
    });
  });

  // PUT /me
  fastify.put<{ Body: UpdateProfileBody }>(
    '/me',
    async (request, reply) => {
      const student = (request as any).student;
      const { name, phone, skillTags, specializations, notificationPrefs } = request.body;

      const updated = await db.studentProfile.update({
        where: { id: student.id },
        data: {
          ...(name && { name }),
          ...(phone && { phone }),
          ...(skillTags && { skillTags }),
          ...(specializations && { specializations }),
          ...(notificationPrefs && { notificationPrefs }),
        },
      });

      return reply.send(updated);
    }
  );

  // GET /me/files
  fastify.get('/me/files', async (request, reply) => {
    const student = (request as any).student;

    const files = await db.studentFile.findMany({
      where: { studentId: student.id },
      orderBy: { uploadedAt: 'desc' },
    });

    return reply.send(files);
  });

  // POST /me/files
  const ALLOWED_FILE_TYPES = ['pdf', 'docx', 'doc', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov', 'zip'];
  const ALLOWED_FILE_CATEGORIES = ['resume', 'certificate', 'portfolio', 'other'];
  const MAX_FILENAME_LENGTH = 255;
  const MAX_FILES_PER_STUDENT = 25;

  fastify.post<{ Body: UploadFileBody }>(
    '/me/files',
    {
      schema: {
        body: {
          type: 'object',
          required: ['filename', 'fileType', 'category'],
          properties: {
            filename: { type: 'string', minLength: 1, maxLength: MAX_FILENAME_LENGTH },
            fileType: { type: 'string', enum: ALLOWED_FILE_TYPES },
            category: { type: 'string', enum: ALLOWED_FILE_CATEGORIES },
          },
        },
      },
    },
    async (request, reply) => {
      const student = (request as any).student;
      const { filename, fileType, category } = request.body;

      // Prevent path traversal in filename
      const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      if (sanitizedFilename.includes('..') || sanitizedFilename.startsWith('/')) {
        return badRequest(reply, 'Invalid filename');
      }

      // Enforce max file count per student
      const existingCount = await db.studentFile.count({
        where: { studentId: student.id },
      });
      if (existingCount >= MAX_FILES_PER_STUDENT) {
        return reply.status(400).send({
          success: false,
          error: `Maximum ${MAX_FILES_PER_STUDENT} files allowed. Please delete some files first.`,
        });
      }

      const timestamp = Math.round(Date.now() / 1000);
      const publicId = `students/${student.id}/${category}/${timestamp}_${sanitizedFilename}`;

      const file = await db.studentFile.create({
        data: {
          studentId: student.id,
          filename: sanitizedFilename,
          fileType,
          category,
          cloudinaryPublicId: publicId,
          cloudinaryUrl: '',
        },
      });

      return reply.send({
        fileId: file.id,
        uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/auto/upload`,
        publicId,
        uploadPreset: 'figwork_students',
      });
    }
  );

  // DELETE /me/files/:fileId
  fastify.delete<{ Params: { fileId: string } }>(
    '/me/files/:fileId',
    async (request, reply) => {
      const student = (request as any).student;
      const { fileId } = request.params;

      const file = await db.studentFile.findFirst({
        where: { id: fileId, studentId: student.id },
      });

      if (!file) {
        return notFound(reply, 'File not found');
      }

      await db.studentFile.delete({
        where: { id: fileId },
      });

      return reply.status(204).send();
    }
  );

  // GET /me/tasks
  fastify.get('/me/tasks', async (request, reply) => {
    const student = (request as any).student;
    const tierConfig = TIER_CONFIG[student.tier as keyof typeof TIER_CONFIG];

    const workUnits = await db.workUnit.findMany({
      where: {
        status: 'active',
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
        _count: { select: { executions: true } },
      },
      orderBy: [{ priceInCents: 'desc' }, { deadlineHours: 'asc' }],
      take: 20,
    });

    const tasksWithScores = workUnits.map(wu => ({
      ...wu,
      matchScore: calculateMatchScore(student, wu),
      estimatedPayout: calculateStudentPayout(wu.priceInCents, student.tier),
    }));

    const matchScores: Record<string, number> = {};
    tasksWithScores.forEach(t => { matchScores[t.id] = t.matchScore; });

    return reply.send({ tasks: tasksWithScores, matchScores });
  });

  // GET /me/tasks/:id — Single task detail for student preview
  fastify.get<{ Params: { id: string } }>('/me/tasks/:id', async (request, reply) => {
    const student = (request as any).student;
    const { id } = request.params;

    const workUnit = await db.workUnit.findUnique({
      where: { id },
      include: {
        company: { select: { companyName: true, website: true } },
        milestoneTemplates: { orderBy: { orderIndex: 'asc' } },
        _count: { select: { executions: true } },
        executions: {
          where: {
            studentId: student.id,
            status: { notIn: ['failed', 'cancelled'] },
          },
          select: { id: true, status: true },
          take: 1,
        },
      },
    });

    if (!workUnit || workUnit.status !== 'active') {
      return notFound(reply, 'Task not found or not available');
    }

    const tierConfig = TIER_CONFIG[student.tier as keyof typeof TIER_CONFIG];
    const tierOrder = ['novice', 'pro', 'elite'];
    const meetsComplexity = workUnit.complexityScore <= tierConfig.benefits.maxComplexity;
    const meetsTier = tierOrder.indexOf(student.tier) >= tierOrder.indexOf(workUnit.minTier);
    const alreadyAccepted = workUnit.executions.length > 0;
    const skillMatch = workUnit.requiredSkills.filter(s =>
      student.skillTags.includes(s)
    );

    return reply.send({
      ...workUnit,
      executions: undefined, // Don't leak other student's data
      matchScore: calculateMatchScore(student, workUnit),
      estimatedPayout: calculateStudentPayout(workUnit.priceInCents, student.tier),
      eligibility: {
        eligible: meetsComplexity && meetsTier && !alreadyAccepted,
        meetsComplexity,
        meetsTier,
        alreadyAccepted,
        skillMatch,
        missingSkills: workUnit.requiredSkills.filter(s => !student.skillTags.includes(s)),
      },
      requiresScreening: !!workUnit.infoCollectionTemplateId,
    });
  });

  // GET /me/executions
  fastify.get('/me/executions', async (request, reply) => {
    const student = (request as any).student;
    const { status } = request.query as { status?: string };

    const executions = await db.execution.findMany({
      where: {
        studentId: student.id,
        ...(status && { status }),
      },
      include: {
        workUnit: {
          select: {
            title: true,
            priceInCents: true,
            deadlineHours: true,
            company: { select: { companyName: true } },
          },
        },
        milestones: {
          include: { template: true },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });

    return reply.send(executions);
  });

  // GET /me/executions/:id
  fastify.get<{ Params: { id: string } }>(
    '/me/executions/:id',
    async (request, reply) => {
      const student = (request as any).student;
      const { id } = request.params;

      const execution = await db.execution.findFirst({
        where: { id, studentId: student.id },
        include: {
          workUnit: {
            include: {
              company: { select: { companyName: true } },
              milestoneTemplates: true,
            },
          },
          milestones: { include: { template: true } },
          powLogs: { orderBy: { requestedAt: 'desc' }, take: 10 },
          qaCheck: true,
          revisionRequests: { orderBy: { createdAt: 'desc' } },
        },
      });

      if (!execution) {
        return notFound(reply, 'Execution not found');
      }

      return reply.send(execution);
    }
  );

  // GET /me/pow
  fastify.get('/me/pow', async (request, reply) => {
    const student = (request as any).student;

    const pendingPOW = await db.proofOfWorkLog.findMany({
      where: {
        studentId: student.id,
        status: 'pending',
      },
      include: {
        execution: {
          select: {
            workUnit: { select: { title: true } },
          },
        },
      },
      orderBy: { requestedAt: 'asc' },
    });

    return reply.send(pendingPOW);
  });

  // POST /me/pow/:powId
  fastify.post<{ Params: { powId: string }; Body: SubmitPOWBody }>(
    '/me/pow/:powId',
    async (request, reply) => {
      const student = (request as any).student;
      const { powId } = request.params;
      const { workPhotoUrl, selfiePhotoUrl, progressDescription } = request.body;

      const pow = await db.proofOfWorkLog.findFirst({
        where: { id: powId, studentId: student.id, status: 'pending' },
      });

      if (!pow) {
        return notFound(reply, 'POW request not found or already submitted');
      }

      const updated = await db.proofOfWorkLog.update({
        where: { id: powId },
        data: {
          workPhotoUrl,
          selfiePhotoUrl,
          progressDescription,
          respondedAt: new Date(),
          status: 'submitted',
        },
      });

      return reply.send({
        ...updated,
        message: 'POW submitted successfully. Analysis in progress.',
      });
    }
  );

  // GET /me/payouts
  fastify.get('/me/payouts', async (request, reply) => {
    const student = (request as any).student;

    const payouts = await db.payout.findMany({
      where: { studentId: student.id },
      include: {
        executions: {
          select: {
            workUnit: { select: { title: true, priceInCents: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalEarned = await db.payout.aggregate({
      where: { studentId: student.id, status: 'completed' },
      _sum: { amountInCents: true },
    });

    return reply.send({
      payouts,
      totalEarnedInCents: totalEarned._sum.amountInCents || 0,
    });
  });

  // GET /me/disputes
  fastify.get('/me/disputes', async (request, reply) => {
    const student = (request as any).student;

    const disputes = await db.dispute.findMany({
      where: { studentId: student.id },
      orderBy: { filedAt: 'desc' },
    });

    // Get work unit titles for disputes with execution IDs
    const disputesWithTitles = await Promise.all(
      disputes.map(async (d) => {
        let workUnitTitle = null;
        if (d.executionId) {
          const execution = await db.execution.findUnique({
            where: { id: d.executionId },
            include: { workUnit: { select: { title: true } } },
          });
          workUnitTitle = execution?.workUnit.title || null;
        }
        return { ...d, workUnitTitle };
      })
    );

    return reply.send({ disputes: disputesWithTitles });
  });

  // POST /me/disputes
  fastify.post<{ Body: FileDisputeBody }>(
    '/me/disputes',
    async (request, reply) => {
      const student = (request as any).student;
      const { executionId, reason, evidenceUrls } = request.body;

      let companyId: string | null = null;

      // If executionId provided, verify ownership and get company
      if (executionId) {
        const execution = await db.execution.findFirst({
          where: { id: executionId, studentId: student.id },
          include: { workUnit: true },
        });

        if (!execution) {
          return notFound(reply, 'Execution not found');
        }
        companyId = execution.workUnit.companyId;
      }

      // For general disputes without execution, we need a default company or platform ID
      // For now, we'll make companyId required only when executionId is provided
      if (!companyId && !executionId) {
        // Get the most recent company the student worked with
        const recentExec = await db.execution.findFirst({
          where: { studentId: student.id },
          include: { workUnit: true },
          orderBy: { assignedAt: 'desc' },
        });
        companyId = recentExec?.workUnit.companyId || null;
      }

      if (!companyId) {
        return badRequest(reply, 'Cannot determine company for dispute. Please select a specific task.');
      }

      const dispute = await db.dispute.create({
        data: {
          executionId: executionId || null,
          studentId: student.id,
          companyId,
          filedBy: 'student',
          reason,
          evidenceUrls: evidenceUrls || [],
          status: 'filed',
        },
      });

      return reply.status(201).send(dispute);
    }
  );

  // ====================
  // NOTIFICATIONS
  // ====================

  // GET /me/notifications
  fastify.get('/me/notifications', async (request, reply) => {
    const student = (request as any).student;

    const notifications = await db.notification.findMany({
      where: { userId: student.clerkId, userType: 'student' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const unreadCount = await db.notification.count({
      where: { userId: student.clerkId, userType: 'student', readAt: null },
    });

    return reply.send({ notifications, unreadCount });
  });

  // POST /me/notifications/:id/read
  fastify.post<{ Params: { id: string } }>(
    '/me/notifications/:id/read',
    async (request, reply) => {
      const student = (request as any).student;
      const { id } = request.params;

      await db.notification.updateMany({
        where: { id, userId: student.clerkId, userType: 'student' },
        data: { readAt: new Date() },
      });

      return reply.send({ success: true });
    }
  );

  // POST /me/notifications/read-all
  fastify.post('/me/notifications/read-all', async (request, reply) => {
    const student = (request as any).student;

    await db.notification.updateMany({
      where: { userId: student.clerkId, userType: 'student', readAt: null },
      data: { readAt: new Date() },
    });

    return reply.send({ success: true });
  });

  // GET /screening-link
  fastify.get('/screening-link', async (request, reply) => {
    const student = (request as any).student;
    const tierConfig = TIER_CONFIG[student.tier as keyof typeof TIER_CONFIG];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayExecutions = await db.execution.count({
      where: {
        studentId: student.id,
        assignedAt: { gte: today },
      },
    });

    if (todayExecutions < tierConfig.benefits.dailyTaskLimit) {
      return badRequest(reply, 'You still have available task slots today');
    }

    if (!student.screeningTemplateId) {
      return badRequest(reply, 'No screening interview configured');
    }

    const link = await db.interviewLink.findFirst({
      where: {
        templateId: student.screeningTemplateId,
        linkType: 'permanent',
        isActive: true,
      },
    });

    if (!link) {
      return badRequest(reply, 'Screening interview not available');
    }

    return reply.send({
      interviewUrl: `/interview/${link.token}`,
      message: 'Complete this interview to unlock additional tasks',
    });
  });
}

// Helper functions
function getEligibleTiers(studentTier: string): string[] {
  switch (studentTier) {
    case 'elite': return ['novice', 'pro', 'elite'];
    case 'pro': return ['novice', 'pro'];
    default: return ['novice'];
  }
}

function calculateMatchScore(student: any, workUnit: any): number {
  let score = 0.5;
  
  const matchingSkills = (workUnit.requiredSkills || []).filter((s: string) => 
    student.skillTags.includes(s)
  );
  score += matchingSkills.length * 0.1;
  
  if (student.tasksCompleted >= workUnit.preferredHistory) {
    score += 0.2;
  }
  
  if (student.avgQualityScore >= 0.8) {
    score += 0.15;
  }
  
  return Math.min(score, 1);
}

function calculateStudentPayout(priceInCents: number, tier: string): number {
  const feePercent = TIER_CONFIG[tier as keyof typeof TIER_CONFIG]?.benefits.platformFeePercent || 0.15;
  return Math.round(priceInCents * (1 - feePercent));
}

/**
 * Default contractor agreement content (HTML).
 * Used when no custom agreement is configured in the admin panel.
 * Includes anchor tags for DocuSign signature placement.
 */
function getDefaultContractorAgreement(contractorName: string): string {
  return `
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px;">
      <h1 style="text-align: center;">Figwork Independent Contractor Agreement</h1>
      <p style="text-align: center; color: #666;">Effective Date: ${new Date().toLocaleDateString()}</p>

      <h2>1. Parties</h2>
      <p>This Independent Contractor Agreement ("Agreement") is entered into between Figwork, Inc. ("Company") and <strong>${contractorName}</strong> ("Contractor").</p>

      <h2>2. Services</h2>
      <p>Contractor agrees to perform work tasks assigned through the Figwork platform. Each task constitutes a separate engagement with specific deliverables, deadlines, and compensation as described in the task listing.</p>

      <h2>3. Independent Contractor Status</h2>
      <p>Contractor is an independent contractor, not an employee. Contractor is responsible for their own taxes, insurance, and equipment. Contractor may accept or decline any task at their discretion.</p>

      <h2>4. Compensation</h2>
      <p>Contractor will be paid the amount specified in each accepted task, minus the applicable platform fee. Payments are processed through Stripe Connect to the Contractor's connected bank account.</p>

      <h2>5. Proof of Work</h2>
      <p>Contractor agrees to submit proof of work as requested by the platform. This may include photos, screenshots, or other documentation of work in progress. Failure to submit timely proof of work may result in task reassignment.</p>

      <h2>6. Quality Standards</h2>
      <p>Contractor agrees to deliver work that meets the quality standards specified in each task. Work that does not meet standards may be subject to revision requests or rejection.</p>

      <h2>7. Confidentiality</h2>
      <p>Contractor agrees to keep confidential all proprietary information received through the platform, including but not limited to client information, trade secrets, and business processes.</p>

      <h2>8. Intellectual Property</h2>
      <p>All work product created by Contractor for a task shall be the property of the commissioning company upon payment. Contractor retains the right to include work in their portfolio unless otherwise specified.</p>

      <h2>9. Termination</h2>
      <p>Either party may terminate this Agreement at any time. Contractor will be compensated for all completed and approved work prior to termination.</p>

      <h2>10. Dispute Resolution</h2>
      <p>Any disputes will first be addressed through the platform's dispute resolution process. If unresolved, disputes shall be settled through binding arbitration.</p>

      <br/><br/>

      <p><strong>Contractor Signature:</strong></p>
      <p>/sig1/</p>
      <p><strong>Full Name:</strong></p>
      <p>/name1/</p>
      <p><strong>Date:</strong></p>
      <p>/date1/</p>
    </body>
    </html>
  `;
}
