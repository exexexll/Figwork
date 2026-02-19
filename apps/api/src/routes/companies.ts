import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '@figwork/db';
import { PRICING_CONFIG } from '@figwork/shared';
import { verifyClerkAuth } from '../lib/clerk.js';
import { unauthorized, forbidden, badRequest, notFound, conflict } from '../lib/http-errors.js';

// Type definitions for request bodies
interface RegisterCompanyBody {
  companyName: string;
  email: string;
  legalName?: string;
  ein?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  website?: string;
}

interface UpdateCompanyProfileBody {
  companyName?: string;
  legalName?: string;
  ein?: string;
  address?: object;
  website?: string;
}

interface UpdateBillingBody {
  billingMethod?: 'card' | 'ach' | 'wire';
  monthlyBudgetCap?: number;
}

interface CreateBudgetPeriodBody {
  month: number;
  year: number;
  budgetCapInCents: number;
}

export async function companyRoutes(fastify: FastifyInstance) {
  // ====================
  // REGISTRATION
  // ====================

  // POST /register
  fastify.post<{ Body: RegisterCompanyBody }>(
    '/register',
    async (request, reply) => {
      const authResult = await verifyClerkAuth(request, reply);
      if (!authResult) return;

      const user = await db.user.findUnique({
        where: { clerkId: authResult.userId },
      });

      if (!user) {
        return badRequest(reply, 'User not found. Please complete initial signup.');
      }

      const existing = await db.companyProfile.findUnique({
        where: { userId: user.id },
      });
      if (existing) {
        return conflict(reply, 'Company profile already exists');
      }

      const { companyName, legalName, ein, address, website } = request.body;

      const company = await db.companyProfile.create({
        data: {
          userId: user.id,
          companyName,
          legalName,
          ein,
          address: address || undefined,
          website,
          verificationStatus: 'pending',
          contractStatus: 'pending',
        },
      });

      return reply.status(201).send({
        id: company.id,
        nextStep: 'verification',
        message: 'Company profile created. Please complete verification.',
      });
    }
  );

  // ====================
  // AUTHENTICATED ROUTES
  // ====================

  // Middleware: Attach company profile
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url.endsWith('/register') && request.method === 'POST') {
      return;
    }

    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const user = await db.user.findUnique({
      where: { clerkId: authResult.userId },
      include: { companyProfile: true },
    });

    if (!user) {
      return unauthorized(reply, 'User not found');
    }

    if (!user.companyProfile && !request.url.includes('/register')) {
      return forbidden(reply, 'Company profile not found. Please register first.');
    }

    (request as any).user = user;
    (request as any).company = user.companyProfile;
  });

  // GET /me
  fastify.get('/me', async (request, reply) => {
    const company = (request as any).company;
    return reply.send(company);
  });

  // PUT /me
  fastify.put<{ Body: UpdateCompanyProfileBody }>(
    '/me',
    async (request, reply) => {
      const company = (request as any).company;
      const { companyName, legalName, ein, address, website } = request.body;

      const updated = await db.companyProfile.update({
        where: { id: company.id },
        data: {
          ...(companyName && { companyName }),
          ...(legalName && { legalName }),
          ...(ein && { ein }),
          ...(address && { address }),
          ...(website && { website }),
        },
      });

      return reply.send(updated);
    }
  );

  // POST /verify/start
  fastify.post('/verify/start', async (request, reply) => {
    const company = (request as any).company;

    if (company.verificationStatus === 'verified') {
      return badRequest(reply, 'Company already verified');
    }

    await db.companyProfile.update({
      where: { id: company.id },
      data: { verificationStatus: 'in_progress' },
    });

    return reply.send({
      clientSecret: `vs_secret_${company.id}_${Date.now()}`,
      sessionId: `vs_${company.id}`,
    });
  });

  // POST /contract/generate
  fastify.post('/contract/generate', async (request, reply) => {
    const company = (request as any).company;

    if (company.contractStatus === 'signed') {
      return badRequest(reply, 'Contract already signed');
    }

    const mockEnvelope = {
      envelopeId: `env_${company.id}_${Date.now()}`,
      signingUrl: 'https://demo.docusign.net/mock',
    };

    await db.companyProfile.update({
      where: { id: company.id },
      data: {
        contractStatus: 'pending_signature',
        docusignEnvelopeId: mockEnvelope.envelopeId,
      },
    });

    return reply.send(mockEnvelope);
  });

  // ====================
  // BILLING
  // ====================

  // GET /billing
  fastify.get('/billing', async (request, reply) => {
    const company = (request as any).company;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthlyStats = await db.paymentTransaction.aggregate({
      where: {
        companyId: company.id,
        createdAt: { gte: monthStart },
        type: { in: ['escrow_funding', 'task_payment'] },
      },
      _sum: {
        amountInCents: true,
        feeInCents: true,
      },
    });

    const currentBudgetPeriod = await db.budgetPeriod.findUnique({
      where: {
        companyId_month_year: {
          companyId: company.id,
          month: now.getMonth() + 1,
          year: now.getFullYear(),
        },
      },
    });

    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearlySpend = await db.paymentTransaction.aggregate({
      where: {
        companyId: company.id,
        createdAt: { gte: yearStart },
        status: 'completed',
      },
      _sum: { amountInCents: true },
    });

    const applicableDiscount = PRICING_CONFIG.volumeDiscounts
      .filter(d => (yearlySpend._sum.amountInCents || 0) >= d.minMonthlySpendCents)
      .sort((a, b) => b.minMonthlySpendCents - a.minMonthlySpendCents)[0];

    return reply.send({
      billingMethod: company.billingMethod,
      monthlyBudgetCap: company.monthlyBudgetCap,
      currentMonthSpendInCents: monthlyStats._sum.amountInCents || 0,
      currentMonthFeesInCents: monthlyStats._sum.feeInCents || 0,
      yearlySpendInCents: yearlySpend._sum.amountInCents || 0,
      volumeDiscount: applicableDiscount?.discount || 0,
      currentBudgetPeriod,
      stripeCustomerId: company.stripeCustomerId,
    });
  });

  // PUT /billing
  fastify.put<{ Body: UpdateBillingBody }>(
    '/billing',
    async (request, reply) => {
      const company = (request as any).company;
      const { billingMethod, monthlyBudgetCap } = request.body;

      const updated = await db.companyProfile.update({
        where: { id: company.id },
        data: {
          ...(billingMethod && { billingMethod }),
          ...(monthlyBudgetCap !== undefined && { monthlyBudgetCap }),
        },
      });

      return reply.send(updated);
    }
  );

  // POST /billing/setup
  fastify.post('/billing/setup', async (request, reply) => {
    const company = (request as any).company;

    const mockSetup = {
      customerId: company.stripeCustomerId || `cus_${company.id}`,
      clientSecret: `seti_secret_${Date.now()}`,
    };

    if (!company.stripeCustomerId) {
      await db.companyProfile.update({
        where: { id: company.id },
        data: { stripeCustomerId: mockSetup.customerId },
      });
    }

    return reply.send(mockSetup);
  });

  // ====================
  // BUDGET PERIODS
  // ====================

  // GET /budget-periods
  fastify.get('/budget-periods', async (request, reply) => {
    const company = (request as any).company;

    const periods = await db.budgetPeriod.findMany({
      where: { companyId: company.id },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    return reply.send(periods);
  });

  // POST /budget-periods
  fastify.post<{ Body: CreateBudgetPeriodBody }>(
    '/budget-periods',
    async (request, reply) => {
      const company = (request as any).company;
      const { month, year, budgetCapInCents } = request.body;

      const existing = await db.budgetPeriod.findUnique({
        where: {
          companyId_month_year: {
            companyId: company.id,
            month,
            year,
          },
        },
      });

      if (existing) {
        return conflict(reply, 'Budget period already exists');
      }

      const period = await db.budgetPeriod.create({
        data: {
          companyId: company.id,
          month,
          year,
          budgetCapInCents,
        },
      });

      return reply.status(201).send(period);
    }
  );

  // PUT /budget-periods/:year/:month
  fastify.put<{ Params: { year: string; month: string }; Body: { budgetCapInCents: number } }>(
    '/budget-periods/:year/:month',
    async (request, reply) => {
      const company = (request as any).company;
      const { year, month } = request.params;
      const { budgetCapInCents } = request.body;

      const updated = await db.budgetPeriod.update({
        where: {
          companyId_month_year: {
            companyId: company.id,
            month: parseInt(month),
            year: parseInt(year),
          },
        },
        data: { budgetCapInCents },
      });

      return reply.send(updated);
    }
  );

  // ====================
  // INVOICES
  // ====================

  // GET /invoices
  fastify.get('/invoices', async (request, reply) => {
    const company = (request as any).company;

    const invoices = await db.invoice.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: 'desc' },
    });

    const totalOutstanding = await db.invoice.aggregate({
      where: {
        companyId: company.id,
        status: { in: ['issued', 'overdue'] },
      },
      _sum: { totalInCents: true },
    });

    return reply.send({
      invoices: invoices.map(inv => ({
        id: inv.id,
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
        subtotalInCents: inv.subtotalInCents,
        platformFeesInCents: inv.platformFeesInCents,
        taxInCents: inv.taxInCents,
        totalInCents: inv.totalInCents,
        status: inv.status,
        dueAt: inv.dueAt,
        paidAt: inv.paidAt,
        pdfUrl: inv.pdfUrl,
        stripeInvoiceUrl: inv.stripeInvoiceUrl,
      })),
      totalOutstandingInCents: totalOutstanding._sum.totalInCents || 0,
    });
  });

  // GET /invoices/:id
  fastify.get<{ Params: { id: string } }>(
    '/invoices/:id',
    async (request, reply) => {
      const company = (request as any).company;
      const { id } = request.params;

      const invoice = await db.invoice.findFirst({
        where: { id, companyId: company.id },
      });

      if (!invoice) {
        return notFound(reply, 'Invoice not found');
      }

      return reply.send({
        ...invoice,
        lineItems: invoice.lineItems,
      });
    }
  );

  // POST /invoices/:id/pay
  fastify.post<{ Params: { id: string } }>(
    '/invoices/:id/pay',
    async (request, reply) => {
      const company = (request as any).company;
      const { id } = request.params;

      const invoice = await db.invoice.findFirst({
        where: { id, companyId: company.id, status: { in: ['issued', 'overdue'] } },
      });

      if (!invoice) {
        return notFound(reply, 'Invoice not found or already paid');
      }

      return reply.send({
        checkoutUrl: `https://checkout.stripe.com/mock?invoice=${id}`,
      });
    }
  );

  // ====================
  // ANALYTICS
  // ====================

  // GET /analytics
  fastify.get('/analytics', async (request, reply) => {
    const company = (request as any).company;
    const { period } = request.query as { period?: string };

    const now = new Date();
    let periodStart: Date;

    switch (period) {
      case 'week':
        periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        periodStart = new Date(now.getFullYear(), 0, 1);
        break;
      case 'month':
      default:
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const workUnitStats = await db.workUnit.groupBy({
      by: ['status'],
      where: { companyId: company.id },
      _count: true,
    });

    const executionStats = await db.execution.groupBy({
      by: ['status'],
      where: {
        workUnit: { companyId: company.id },
        assignedAt: { gte: periodStart },
      },
      _count: true,
    });

    const qualityMetrics = await db.execution.aggregate({
      where: {
        workUnit: { companyId: company.id },
        status: 'approved',
        completedAt: { gte: periodStart },
      },
      _avg: { qualityScore: true },
      _count: true,
    });

    const revisionsNeeded = await db.execution.count({
      where: {
        workUnit: { companyId: company.id },
        revisionCount: { gt: 0 },
        completedAt: { gte: periodStart },
      },
    });

    const spending = await db.paymentTransaction.aggregate({
      where: {
        companyId: company.id,
        createdAt: { gte: periodStart },
        status: 'completed',
      },
      _sum: { amountInCents: true, feeInCents: true },
    });

    return reply.send({
      period,
      workUnits: Object.fromEntries(workUnitStats.map(s => [s.status, s._count])),
      executions: Object.fromEntries(executionStats.map(s => [s.status, s._count])),
      quality: {
        averageScore: qualityMetrics._avg.qualityScore || 0,
        totalCompleted: qualityMetrics._count,
        revisionRate: qualityMetrics._count > 0 
          ? revisionsNeeded / qualityMetrics._count 
          : 0,
      },
      spending: {
        totalInCents: spending._sum.amountInCents || 0,
        feesInCents: spending._sum.feeInCents || 0,
      },
    });
  });

  // ====================
  // NOTIFICATIONS
  // ====================

  // GET /notifications
  fastify.get('/notifications', async (request, reply) => {
    const user = (request as any).user;

    const notifications = await db.notification.findMany({
      where: { userId: user.clerkId, userType: 'company' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const unreadCount = await db.notification.count({
      where: { userId: user.clerkId, userType: 'company', readAt: null },
    });

    return reply.send({ notifications, unreadCount });
  });

  // POST /notifications/:id/read
  fastify.post<{ Params: { id: string } }>(
    '/notifications/:id/read',
    async (request, reply) => {
      const user = (request as any).user;
      const { id } = request.params;

      await db.notification.updateMany({
        where: { id, userId: user.clerkId },
        data: { readAt: new Date() },
      });

      return reply.send({ success: true });
    }
  );

  // POST /notifications/read-all
  fastify.post('/notifications/read-all', async (request, reply) => {
    const user = (request as any).user;

    await db.notification.updateMany({
      where: { userId: user.clerkId, userType: 'company', readAt: null },
      data: { readAt: new Date() },
    });

    return reply.send({ success: true });
  });

  // ====================
  // DISPUTES
  // ====================

  // GET /disputes
  fastify.get('/disputes', async (request, reply) => {
    const company = (request as any).company;

    const disputes = await db.dispute.findMany({
      where: { companyId: company.id },
      orderBy: { filedAt: 'desc' },
      include: {
        student: { select: { name: true, clerkId: true, tier: true } },
      },
    });

    // Get execution titles
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

  // POST /disputes (company filing a dispute)
  fastify.post<{ Body: { executionId: string; reason: string; evidenceUrls?: string[] } }>(
    '/disputes',
    async (request, reply) => {
      const company = (request as any).company;
      const { executionId, reason, evidenceUrls } = request.body;

      if (!reason || reason.trim().length < 10) {
        return badRequest(reply, 'Please provide a detailed reason (at least 10 characters)');
      }

      // Verify the execution belongs to this company
      const execution = await db.execution.findUnique({
        where: { id: executionId },
        include: { workUnit: true },
      });

      if (!execution || execution.workUnit.companyId !== company.id) {
        return notFound(reply, 'Execution not found');
      }

      const dispute = await db.dispute.create({
        data: {
          executionId,
          studentId: execution.studentId,
          companyId: company.id,
          filedBy: 'company',
          reason,
          evidenceUrls: evidenceUrls || [],
          status: 'filed',
        },
      });

      return reply.status(201).send(dispute);
    }
  );
}
