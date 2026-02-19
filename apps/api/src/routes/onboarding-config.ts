/**
 * Onboarding Configuration Routes
 *
 * Admin routes for managing the legal onboarding flow:
 *   - CRUD for onboarding steps (enable/disable, reorder, gate levels)
 *   - CRUD for legal agreements (create, edit, version, archive)
 *
 * Student routes:
 *   - Get active onboarding config
 *   - Sign agreements
 *   - Check onboarding completion status
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { db } from '@figwork/db';
import { verifyClerkAuth } from '../lib/clerk.js';
import { unauthorized, forbidden, badRequest, notFound, conflict } from '../lib/http-errors.js';

// Admin user IDs (mirrors admin.ts)
const ADMIN_USER_IDS = process.env.ADMIN_USER_IDS?.split(',') || [];

async function verifyAdmin(request: any, reply: any): Promise<string | null> {
  const authResult = await verifyClerkAuth(request, reply);
  if (!authResult) return null;

  if (!ADMIN_USER_IDS.includes(authResult.userId)) {
    reply.status(403).send({ success: false, error: 'Admin access required' });
    return null;
  }

  return authResult.userId;
}

// =============================================
// DEFAULT STEPS — seeded on first read if empty
// =============================================

const DEFAULT_STEPS = [
  {
    stepType: 'profile',
    label: 'Profile',
    description: 'Basic info — name and skills',
    icon: 'User',
    enabled: true,
    required: true,
    orderIndex: 0,
    gateLevel: 'browse',
    config: {},
  },
  {
    stepType: 'phone',
    label: 'Phone Verification',
    description: 'Verify your phone for proof-of-work check-ins',
    icon: 'Phone',
    enabled: true,
    required: false,
    orderIndex: 1,
    gateLevel: 'accept',
    config: {},
  },
  {
    stepType: 'portfolio',
    label: 'Portfolio & Files',
    description: 'Upload resume, certificates, or portfolio pieces',
    icon: 'FileText',
    enabled: true,
    required: false,
    orderIndex: 2,
    gateLevel: 'accept',
    config: {},
  },
  {
    stepType: 'kyc',
    label: 'Identity Verification',
    description: 'Government ID + selfie via Stripe Identity',
    icon: 'Shield',
    enabled: true,
    required: true,
    orderIndex: 3,
    gateLevel: 'accept',
    config: { kycLevel: 'standard' },
  },
  {
    stepType: 'tax',
    label: 'Tax Information',
    description: 'W-9 (US) or W-8BEN (international) for tax reporting',
    icon: 'Receipt',
    enabled: true,
    required: true,
    orderIndex: 4,
    gateLevel: 'payout',
    config: { formType: 'auto' },
  },
  {
    stepType: 'payout',
    label: 'Payout Setup',
    description: 'Connect your bank account via Stripe Connect',
    icon: 'CreditCard',
    enabled: true,
    required: true,
    orderIndex: 5,
    gateLevel: 'payout',
    config: {},
  },
];

/**
 * Check if onboarding_steps table exists.
 * Returns false if the table hasn't been migrated yet.
 */
async function isOnboardingTableReady(): Promise<boolean> {
  try {
    const prisma = db as any;
    await prisma.onboardingStep.count();
    return true;
  } catch (err: any) {
    if (err?.message?.includes('does not exist')) return false;
    throw err;
  }
}

async function isLegalTablesReady(): Promise<boolean> {
  try {
    const prisma = db as any;
    await prisma.legalAgreement.count();
    return true;
  } catch (err: any) {
    if (err?.message?.includes('does not exist')) return false;
    throw err;
  }
}

async function ensureDefaultSteps(): Promise<void> {
  if (!(await isOnboardingTableReady())) return;
  const prisma = db as any;
  const count = await prisma.onboardingStep.count();
  if (count === 0) {
    await prisma.onboardingStep.createMany({
      data: DEFAULT_STEPS,
    });
  }
}

// =============================================
// ROUTES
// =============================================

export default async function onboardingConfigRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
) {
  const _db = db as any;

  // Pre-check: if onboarding_steps table doesn't exist, return a helpful message
  const TABLE_NOT_READY_MSG = {
    error: 'Onboarding tables not migrated yet. Run `npx prisma migrate dev` to create them.',
    steps: [],
  };

  // =============================================
  // ADMIN — STEP MANAGEMENT
  // =============================================

  /**
   * GET /api/onboarding-config/steps — List all onboarding steps
   * (Admin sees all; students get only active via /active endpoint)
   */
  fastify.get('/steps', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;

    if (!(await isOnboardingTableReady())) {
      return reply.send(TABLE_NOT_READY_MSG);
    }

    await ensureDefaultSteps();

    const steps = await _db.onboardingStep.findMany({
      orderBy: { orderIndex: 'asc' },
      include: {
        agreement: {
          select: { id: true, title: true, slug: true, version: true, status: true },
        },
      },
    });

    return { steps };
  });

  /**
   * POST /api/onboarding-config/steps — Create a new onboarding step
   */
  fastify.post('/steps', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;
    if (!(await isOnboardingTableReady())) {
      return reply.status(503).send(TABLE_NOT_READY_MSG);
    }

    const {
      stepType,
      label,
      description,
      icon,
      enabled,
      required,
      gateLevel,
      agreementId,
      config,
    } = request.body as {
      stepType: string;
      label: string;
      description?: string;
      icon?: string;
      enabled?: boolean;
      required?: boolean;
      gateLevel?: string;
      agreementId?: string;
      config?: Record<string, unknown>;
    };

    if (!stepType || !label) {
      return badRequest(reply, 'stepType and label are required');
    }

    // Validate agreement exists if type is 'agreement'
    if (stepType === 'agreement') {
      if (!agreementId) {
        return badRequest(reply, 'agreementId is required for agreement steps');
      }
      const agreement = await _db.legalAgreement.findUnique({ where: { id: agreementId } });
      if (!agreement) {
        return notFound(reply, 'Agreement not found');
      }
    }

    // Get next order index
    const maxOrder = await _db.onboardingStep.aggregate({ _max: { orderIndex: true } });
    const nextOrder = (maxOrder._max.orderIndex ?? -1) + 1;

    const step = await _db.onboardingStep.create({
      data: {
        stepType,
        label,
        description: description || null,
        icon: icon || null,
        enabled: enabled ?? true,
        required: required ?? false,
        orderIndex: nextOrder,
        gateLevel: gateLevel || 'accept',
        agreementId: agreementId || null,
        config: config || {},
      },
      include: {
        agreement: {
          select: { id: true, title: true, slug: true, version: true, status: true },
        },
      },
    });

    return reply.status(201).send({ step });
  });

  /**
   * PUT /api/onboarding-config/steps/:id — Update a step
   */
  fastify.put('/steps/:id', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;
    if (!(await isOnboardingTableReady())) {
      return reply.status(503).send(TABLE_NOT_READY_MSG);
    }

    const { id } = request.params as { id: string };
    const updates = request.body as {
      label?: string;
      description?: string;
      icon?: string;
      enabled?: boolean;
      required?: boolean;
      gateLevel?: string;
      agreementId?: string;
      config?: Record<string, unknown>;
    };

    const existing = await _db.onboardingStep.findUnique({ where: { id } });
    if (!existing) return notFound(reply, 'Step not found');

    const step = await _db.onboardingStep.update({
      where: { id },
      data: {
        ...(updates.label !== undefined && { label: updates.label }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.icon !== undefined && { icon: updates.icon }),
        ...(updates.enabled !== undefined && { enabled: updates.enabled }),
        ...(updates.required !== undefined && { required: updates.required }),
        ...(updates.gateLevel !== undefined && { gateLevel: updates.gateLevel }),
        ...(updates.agreementId !== undefined && { agreementId: updates.agreementId }),
        ...(updates.config !== undefined && { config: updates.config }),
      },
      include: {
        agreement: {
          select: { id: true, title: true, slug: true, version: true, status: true },
        },
      },
    });

    return { step };
  });

  /**
   * POST /api/onboarding-config/steps/reorder — Reorder all steps
   * Body: { order: [{ id, orderIndex }] }
   */
  fastify.post('/steps/reorder', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;
    if (!(await isOnboardingTableReady())) {
      return reply.status(503).send(TABLE_NOT_READY_MSG);
    }

    const { order } = request.body as { order: Array<{ id: string; orderIndex: number }> };

    if (!Array.isArray(order) || order.length === 0) {
      return badRequest(reply, 'order array is required');
    }

    await db.$transaction(
      order.map(({ id, orderIndex }) =>
        _db.onboardingStep.update({
          where: { id },
          data: { orderIndex },
        })
      )
    );

    const steps = await _db.onboardingStep.findMany({
      orderBy: { orderIndex: 'asc' },
      include: {
        agreement: {
          select: { id: true, title: true, slug: true, version: true, status: true },
        },
      },
    });

    return { steps };
  });

  /**
   * DELETE /api/onboarding-config/steps/:id — Delete a step
   * (Only custom agreement steps can be deleted; built-in steps can only be disabled)
   */
  fastify.delete('/steps/:id', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;
    if (!(await isOnboardingTableReady())) {
      return reply.status(503).send(TABLE_NOT_READY_MSG);
    }

    const { id } = request.params as { id: string };

    const existing = await _db.onboardingStep.findUnique({ where: { id } });
    if (!existing) return notFound(reply, 'Step not found');

    const builtInTypes = ['profile', 'phone', 'portfolio', 'kyc', 'tax', 'payout'];
    if (builtInTypes.includes(existing.stepType)) {
      return badRequest(reply, 'Built-in steps cannot be deleted. Disable them instead.');
    }

    await _db.onboardingStep.delete({ where: { id } });
    return reply.status(204).send();
  });

  // =============================================
  // ADMIN — LEGAL AGREEMENT MANAGEMENT
  // =============================================

  /**
   * GET /api/onboarding-config/agreements — List all agreements
   */
  fastify.get('/agreements', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;
    if (!(await isLegalTablesReady())) {
      return reply.send([]);
    }

    const agreements = await _db.legalAgreement.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { signatures: true } },
      },
    });

    return { agreements };
  });

  /**
   * POST /api/onboarding-config/agreements — Create a new agreement
   */
  fastify.post('/agreements', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;
    if (!(await isLegalTablesReady())) {
      return reply.status(503).send(TABLE_NOT_READY_MSG);
    }

    const { title, slug, content, status } = request.body as {
      title: string;
      slug: string;
      content: string;
      status?: string;
    };

    if (!title || !slug || !content) {
      return badRequest(reply, 'title, slug, and content are required');
    }

    // Sanitize slug
    const sanitizedSlug = slug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 100);

    const existingSlug = await _db.legalAgreement.findUnique({ where: { slug: sanitizedSlug } });
    if (existingSlug) {
      return conflict(reply, 'An agreement with this slug already exists');
    }

    const agreement = await _db.legalAgreement.create({
      data: {
        title,
        slug: sanitizedSlug,
        content,
        version: 1,
        status: status || 'draft',
      },
    });

    return reply.status(201).send({ agreement });
  });

  /**
   * GET /api/onboarding-config/agreements/:id — Get single agreement
   */
  fastify.get('/agreements/:id', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;
    if (!(await isLegalTablesReady())) {
      return reply.status(503).send(TABLE_NOT_READY_MSG);
    }

    const { id } = request.params as { id: string };

    const agreement = await _db.legalAgreement.findUnique({
      where: { id },
      include: {
        _count: { select: { signatures: true } },
        signatures: {
          take: 10,
          orderBy: { signedAt: 'desc' },
          include: {
            student: { select: { name: true, email: true } },
          },
        },
      },
    });

    if (!agreement) return notFound(reply, 'Agreement not found');
    return { agreement };
  });

  /**
   * PUT /api/onboarding-config/agreements/:id — Update an agreement
   * If content changes, optionally bump version
   */
  fastify.put('/agreements/:id', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;
    if (!(await isLegalTablesReady())) {
      return reply.status(503).send(TABLE_NOT_READY_MSG);
    }

    const { id } = request.params as { id: string };
    const { title, content, status, bumpVersion } = request.body as {
      title?: string;
      content?: string;
      status?: string;
      bumpVersion?: boolean;
    };

    const existing = await _db.legalAgreement.findUnique({ where: { id } });
    if (!existing) return notFound(reply, 'Agreement not found');

    const agreement = await _db.legalAgreement.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(content && { content }),
        ...(status && { status }),
        ...(bumpVersion && { version: existing.version + 1 }),
      },
    });

    return { agreement };
  });

  /**
   * DELETE /api/onboarding-config/agreements/:id — Archive an agreement
   */
  fastify.delete('/agreements/:id', async (request, reply) => {
    const _admin = await verifyAdmin(request, reply);
    if (!_admin) return;
    if (!(await isLegalTablesReady())) {
      return reply.status(503).send(TABLE_NOT_READY_MSG);
    }

    const { id } = request.params as { id: string };

    const existing = await _db.legalAgreement.findUnique({ where: { id } });
    if (!existing) return notFound(reply, 'Agreement not found');

    // Don't hard-delete; archive it so signatures remain valid
    await _db.legalAgreement.update({
      where: { id },
      data: { status: 'archived' },
    });

    return reply.status(204).send();
  });

  // =============================================
  // STUDENT — READ CONFIG & SIGN AGREEMENTS
  // =============================================

  /**
   * GET /api/onboarding-config/active — Get active onboarding steps
   * (Public for authenticated students)
   */
  fastify.get('/active', async (request, reply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    if (!(await isOnboardingTableReady())) {
      return reply.send({ steps: [] });
    }

    await ensureDefaultSteps();

    interface StepRow {
      id: string;
      stepType: string;
      label: string;
      description: string | null;
      icon: string | null;
      required: boolean;
      gateLevel: string;
      agreementId: string | null;
      agreement: { id: string; title: string; slug: string; version: number; status: string; content: string; requiresResign?: boolean } | null;
    }

    const steps: StepRow[] = await _db.onboardingStep.findMany({
      where: { enabled: true },
      orderBy: { orderIndex: 'asc' },
      include: {
        agreement: {
          select: { id: true, title: true, slug: true, version: true, status: true, content: true, requiresResign: true },
        },
      },
    });

    // Get student's signing status for agreement steps
    const student = await db.studentProfile.findUnique({
      where: { clerkId: authResult.userId },
    });

    let signatures: Record<string, { signedAt: string; agreementVersion: number }> = {};

    if (student) {
      const sigs: Array<{ agreementId: string; signedAt: Date; agreementVersion: number }> =
        await _db.agreementSignature.findMany({
          where: { studentId: student.id },
        });

      signatures = Object.fromEntries(
        sigs.map((s) => [
          s.agreementId,
          { signedAt: s.signedAt.toISOString(), agreementVersion: s.agreementVersion },
        ])
      );
    }

    // Annotate steps with completion status
    const annotatedSteps = steps.map((step: StepRow) => {
      let completed = false;
      let needsResign = false;

      if (student) {
        switch (step.stepType) {
          case 'profile':
            completed = !!student.name && student.skillTags.length > 0;
            break;
          case 'phone':
            completed = !!student.phone;
            break;
          case 'portfolio':
            // Portfolio is always "complete" even if no files uploaded (it's optional by nature)
            completed = true;
            break;
          case 'kyc':
            completed = student.kycStatus === 'verified';
            break;
          case 'tax':
            completed = student.taxStatus === 'verified';
            break;
          case 'payout':
            completed = student.stripeConnectStatus === 'active';
            break;
          case 'agreement':
            if (step.agreementId && signatures[step.agreementId]) {
              const sig = signatures[step.agreementId];
              completed = true;
              // Check if agreement version bumped and requires re-signing
              if (
                step.agreement &&
                step.agreement.version > sig.agreementVersion &&
                step.agreement.requiresResign !== false
              ) {
                completed = false;
                needsResign = true;
              }
            }
            break;
        }
      }

      return {
        id: step.id,
        stepType: step.stepType,
        label: step.label,
        description: step.description,
        icon: step.icon,
        required: step.required,
        gateLevel: step.gateLevel,
        agreement: step.stepType === 'agreement' ? step.agreement : undefined,
        completed,
        needsResign,
      };
    });

    // Compute gate statuses
    type AnnotatedStep = typeof annotatedSteps[number];
    const gateStatus = {
      browse: annotatedSteps
        .filter((s: AnnotatedStep) => s.gateLevel === 'browse' && s.required)
        .every((s: AnnotatedStep) => s.completed),
      accept: annotatedSteps
        .filter((s: AnnotatedStep) => ['browse', 'accept'].includes(s.gateLevel) && s.required)
        .every((s: AnnotatedStep) => s.completed),
      payout: annotatedSteps
        .filter((s: AnnotatedStep) => s.required)
        .every((s: AnnotatedStep) => s.completed),
    };

    return {
      steps: annotatedSteps,
      gateStatus,
    };
  });

  /**
   * POST /api/onboarding-config/agreements/:id/sign — Student signs an agreement
   */
  fastify.post('/agreements/:id/sign', async (request, reply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;
    if (!(await isLegalTablesReady())) {
      return reply.status(503).send(TABLE_NOT_READY_MSG);
    }

    const { id } = request.params as { id: string };
    const { signedName } = request.body as { signedName: string };

    if (!signedName || signedName.trim().length < 2) {
      return badRequest(reply, 'Please type your full legal name to sign');
    }

    // Get student
    const student = await db.studentProfile.findUnique({
      where: { clerkId: authResult.userId },
    });
    if (!student) {
      return forbidden(reply, 'Student profile not found');
    }

    // Get agreement
    const agreement = await _db.legalAgreement.findUnique({ where: { id } });
    if (!agreement || agreement.status !== 'active') {
      return notFound(reply, 'Agreement not found or not active');
    }

    // Upsert signature (allows re-signing on version bump)
    const signature = await _db.agreementSignature.upsert({
      where: {
        agreementId_studentId: {
          agreementId: id,
          studentId: student.id,
        },
      },
      create: {
        agreementId: id,
        studentId: student.id,
        agreementVersion: agreement.version,
        signedName: signedName.trim(),
        ipAddress: (request.ip || '').substring(0, 45),
        userAgent: ((request.headers['user-agent'] as string) || '').substring(0, 500),
      },
      update: {
        agreementVersion: agreement.version,
        signedName: signedName.trim(),
        signedAt: new Date(),
        ipAddress: (request.ip || '').substring(0, 45),
        userAgent: ((request.headers['user-agent'] as string) || '').substring(0, 500),
      },
    });

    // Update contract status on the student profile
    await db.studentProfile.update({
      where: { id: student.id },
      data: {
        contractStatus: 'signed',
        contractSignedAt: new Date(),
      },
    });

    return {
      signature: {
        id: signature.id,
        signedAt: signature.signedAt,
        agreementVersion: signature.agreementVersion,
      },
      message: 'Agreement signed successfully',
    };
  });

  /**
   * GET /api/onboarding-config/my-status — Student's onboarding completion
   */
  fastify.get('/my-status', async (request, reply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const student = await db.studentProfile.findUnique({
      where: { clerkId: authResult.userId },
    });

    if (!student) {
      return {
        hasProfile: false,
        completedSteps: [],
        canBrowse: false,
        canAccept: false,
        canGetPaid: false,
      };
    }

    if (!(await isOnboardingTableReady())) {
      return reply.send({
        hasProfile: true,
        completedSteps: [],
        canBrowse: true,
        canAccept: true,
        canGetPaid: false,
      });
    }

    await ensureDefaultSteps();

    interface StatusStepRow {
      stepType: string;
      label: string;
      required: boolean;
      gateLevel: string;
      agreementId: string | null;
      agreement: { version: number; requiresResign: boolean } | null;
    }

    const steps: StatusStepRow[] = await _db.onboardingStep.findMany({
      where: { enabled: true },
      orderBy: { orderIndex: 'asc' },
      include: { agreement: true },
    });

    const signatures: Array<{ agreementId: string; agreementVersion: number }> =
      await _db.agreementSignature.findMany({
        where: { studentId: student.id },
      });
    const sigMap = new Map(signatures.map((s) => [s.agreementId, s]));

    const completedSteps: string[] = [];
    const pendingRequired: Array<{ stepType: string; gateLevel: string }> = [];

    for (const step of steps) {
      let completed = false;

      switch (step.stepType) {
        case 'profile':
          completed = !!student.name && student.skillTags.length > 0;
          break;
        case 'phone':
          completed = !!student.phone;
          break;
        case 'portfolio':
          completed = true; // Optional by nature
          break;
        case 'kyc':
          completed = student.kycStatus === 'verified';
          break;
        case 'tax':
          completed = student.taxStatus === 'verified';
          break;
        case 'payout':
          completed = student.stripeConnectStatus === 'active';
          break;
        case 'agreement':
          if (step.agreementId) {
            const sig = sigMap.get(step.agreementId);
            if (sig && step.agreement) {
              completed =
                !step.agreement.requiresResign ||
                sig.agreementVersion >= step.agreement.version;
            }
          }
          break;
      }

      if (completed) {
        completedSteps.push(step.stepType);
      } else if (step.required) {
        pendingRequired.push({
          stepType: step.stepType,
          gateLevel: step.gateLevel,
        });
      }
    }

    const canBrowse = !pendingRequired.some((s) => s.gateLevel === 'browse');
    const canAccept = !pendingRequired.some((s) =>
      ['browse', 'accept'].includes(s.gateLevel)
    );
    const canGetPaid = pendingRequired.length === 0;

    return {
      hasProfile: true,
      completedSteps,
      pendingRequired: pendingRequired.map((s) => s.stepType),
      canBrowse,
      canAccept,
      canGetPaid,
      student: {
        name: student.name,
        tier: student.tier,
        kycStatus: student.kycStatus,
        taxStatus: student.taxStatus,
        stripeConnectStatus: student.stripeConnectStatus,
        contractStatus: student.contractStatus,
      },
    };
  });
}
