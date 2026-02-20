import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '@figwork/db';
import { PRICING_CONFIG, TIER_CONFIG } from '@figwork/shared';
import { verifyClerkAuth } from '../lib/clerk.js';
import { unauthorized, forbidden, badRequest } from '../lib/http-errors.js';
import {
  constructWebhookEvent,
  createCheckoutSession,
  getOrCreateCustomer,
  isStripeConfigured,
} from '../lib/stripe-service.js';

export async function paymentRoutes(fastify: FastifyInstance) {
  // ====================
  // STUDENT PAYMENT ROUTES
  // ====================

  // GET /student/balance - Get student's current balance
  fastify.get('/student/balance', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const student = await db.studentProfile.findUnique({
      where: { clerkId: authResult.userId },
    });

    if (!student) {
      return forbidden(reply, 'Student profile required');
    }

    const pendingPayouts = await db.payout.aggregate({
      where: { studentId: student.id, status: 'pending' },
      _sum: { amountInCents: true },
    });

    const processingPayouts = await db.payout.aggregate({
      where: { studentId: student.id, status: 'processing' },
      _sum: { amountInCents: true },
    });

    const completedPayouts = await db.payout.aggregate({
      where: { studentId: student.id, status: 'completed' },
      _sum: { amountInCents: true },
    });

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const monthlyEarnings = await db.payout.aggregate({
      where: {
        studentId: student.id,
        status: 'completed',
        processedAt: { gte: monthStart },
      },
      _sum: { amountInCents: true },
    });

    const tierConfig = TIER_CONFIG[student.tier as keyof typeof TIER_CONFIG];

    return reply.send({
      pendingInCents: pendingPayouts._sum.amountInCents || 0,
      processingInCents: processingPayouts._sum.amountInCents || 0,
      totalEarnedInCents: completedPayouts._sum.amountInCents || 0,
      monthlyEarnedInCents: monthlyEarnings._sum.amountInCents || 0,
      stripeConnectStatus: student.stripeConnectStatus,
      tier: student.tier,
      platformFeePercent: tierConfig.benefits.platformFeePercent,
    });
  });

  // GET /student/payouts - List payouts
  fastify.get('/student/payouts', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const student = await db.studentProfile.findUnique({
      where: { clerkId: authResult.userId },
    });

    if (!student) {
      return forbidden(reply, 'Student profile required');
    }

    const { status, limit: limitStr = '20', offset: offsetStr = '0' } = request.query as {
      status?: string;
      limit?: string;
      offset?: string;
    };

    const limitNum = Math.min(Math.max(1, parseInt(limitStr) || 20), 100);
    const offsetNum = Math.max(0, parseInt(offsetStr) || 0);

    const payouts = await db.payout.findMany({
      where: {
        studentId: student.id,
        ...(status && { status }),
      },
      include: {
        executions: {
          include: {
            workUnit: { select: { title: true, priceInCents: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limitNum,
      skip: offsetNum,
    });

    return reply.send(payouts);
  });

  // POST /student/instant-payout
  fastify.post('/student/instant-payout', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const student = await db.studentProfile.findUnique({
      where: { clerkId: authResult.userId },
    });

    if (!student) {
      return forbidden(reply, 'Student profile required');
    }

    if (student.stripeConnectStatus !== 'active') {
      return badRequest(reply, 'Stripe Connect must be active for instant payouts');
    }

    // Use transaction to prevent double-payout race condition
    try {
      const result = await db.$transaction(async (tx) => {
        const pendingPayouts = await tx.payout.findMany({
          where: { studentId: student.id, status: 'pending' },
        });

        if (pendingPayouts.length === 0) {
          throw new Error('BAD_REQUEST:No pending payouts available');
        }

        const totalPending = pendingPayouts.reduce((sum, p) => sum + p.amountInCents, 0);
        const instantFee = Math.round(totalPending * PRICING_CONFIG.instantPayoutFeePercent);
        const netAmount = totalPending - instantFee;

        if (netAmount < 100) {
          throw new Error('BAD_REQUEST:Minimum instant payout is $1 after fees');
        }

        const payoutIds = pendingPayouts.map(p => p.id);

        // Atomically mark as processing to prevent concurrent claims
        await tx.payout.updateMany({
          where: { id: { in: payoutIds }, status: 'pending' }, // re-check status
          data: { status: 'processing' },
        });

        await tx.paymentTransaction.create({
          data: {
            studentId: student.id,
            type: 'instant_payout',
            amountInCents: totalPending,
            feeInCents: instantFee,
            netAmountInCents: netAmount,
            direction: 'credit',
            status: 'processing',
            description: `Instant payout: ${pendingPayouts.length} tasks`,
          },
        });

        return {
          totalAmountInCents: totalPending,
          feeInCents: instantFee,
          netAmountInCents: netAmount,
          payoutCount: pendingPayouts.length,
          payoutIds,
        };
      }, {
        isolationLevel: 'Serializable',
      });

      // Queue actual Stripe transfer asynchronously (outside transaction)
      // The payout worker will handle the actual Stripe transfer
      return reply.send({
        ...result,
        status: 'processing',
        estimatedArrival: new Date(Date.now() + 30 * 60 * 1000),
      });
    } catch (error: any) {
      if (error.message?.startsWith('BAD_REQUEST:')) {
        return badRequest(reply, error.message.replace('BAD_REQUEST:', ''));
      }
      throw error;
    }
  });

  // GET /student/transactions
  fastify.get('/student/transactions', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const student = await db.studentProfile.findUnique({
      where: { clerkId: authResult.userId },
    });

    if (!student) {
      return forbidden(reply, 'Student profile required');
    }

    const { limit: lStr = '50', offset: oStr = '0' } = request.query as { limit?: string; offset?: string };
    const takeNum = Math.min(Math.max(1, parseInt(lStr) || 50), 100);
    const skipNum = Math.max(0, parseInt(oStr) || 0);

    const transactions = await db.paymentTransaction.findMany({
      where: { studentId: student.id },
      orderBy: { createdAt: 'desc' },
      take: takeNum,
      skip: skipNum,
    });

    return reply.send(transactions);
  });

  // ====================
  // COMPANY PAYMENT ROUTES
  // ====================

  // GET /company/balance
  fastify.get('/company/balance', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const user = await db.user.findUnique({
      where: { clerkId: authResult.userId },
      include: { companyProfile: true },
    });

    if (!user?.companyProfile) {
      return forbidden(reply, 'Company profile required');
    }

    const company = user.companyProfile;

    const activeEscrow = await db.escrow.aggregate({
      where: { companyId: company.id, status: 'funded' },
      _sum: { amountInCents: true },
    });

    const pendingEscrow = await db.escrow.aggregate({
      where: { companyId: company.id, status: 'pending' },
      _sum: { amountInCents: true },
    });

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    // Count both payment transactions AND escrows funded this month (agent creates escrows without transactions)
    const [monthlyTxns, monthlyEscrows] = await Promise.all([
      db.paymentTransaction.aggregate({
        where: { companyId: company.id, type: { in: ['escrow_funding', 'task_payment'] }, createdAt: { gte: monthStart }, status: 'completed' },
        _sum: { amountInCents: true, feeInCents: true },
      }),
      db.escrow.aggregate({
        where: { companyId: company.id, status: { in: ['funded', 'released'] }, fundedAt: { gte: monthStart } },
        _sum: { amountInCents: true },
      }),
    ]);
    // Use the higher of the two (escrow total is more accurate since agent bypasses transactions)
    const monthlySpendAmount = Math.max(monthlyTxns._sum.amountInCents || 0, monthlyEscrows._sum.amountInCents || 0);

    const budgetPeriod = await db.budgetPeriod.findUnique({
      where: {
        companyId_month_year: {
          companyId: company.id,
          month: new Date().getMonth() + 1,
          year: new Date().getFullYear(),
        },
      },
    });

    return reply.send({
      activeEscrowInCents: activeEscrow._sum.amountInCents || 0,
      pendingEscrowInCents: pendingEscrow._sum.amountInCents || 0,
      monthlySpendInCents: monthlySpendAmount,
      monthlyFeesInCents: monthlyTxns._sum.feeInCents || 0,
      budgetCapInCents: budgetPeriod?.budgetCapInCents,
      budgetRemainingInCents: budgetPeriod
        ? (budgetPeriod.budgetCapInCents || 0) - (budgetPeriod.totalSpentInCents + budgetPeriod.totalEscrowedInCents)
        : null,
      stripeCustomerId: company.stripeCustomerId,
      billingMethod: company.billingMethod,
    });
  });

  // GET /company/transactions
  fastify.get('/company/transactions', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const user = await db.user.findUnique({
      where: { clerkId: authResult.userId },
      include: { companyProfile: true },
    });

    if (!user?.companyProfile) {
      return forbidden(reply, 'Company profile required');
    }

    const { type, limit: cLimitStr = '50', offset: cOffsetStr = '0' } = request.query as {
      type?: string;
      limit?: string;
      offset?: string;
    };

    const transactions = await db.paymentTransaction.findMany({
      where: {
        companyId: user.companyProfile.id,
        ...(type && { type }),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(1, parseInt(cLimitStr) || 50), 100),
      skip: Math.max(0, parseInt(cOffsetStr) || 0),
    });

    return reply.send(transactions);
  });

  // POST /company/add-funds — Creates a Stripe Checkout Session for adding funds
  fastify.post<{ Body: { amountInCents: number; workUnitId?: string } }>(
    '/company/add-funds',
    {
      schema: {
        body: {
          type: 'object',
          required: ['amountInCents'],
          properties: {
            amountInCents: { type: 'number', minimum: 1000 },
            workUnitId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const authResult = await verifyClerkAuth(request, reply);
      if (!authResult) return;

      const user = await db.user.findUnique({
        where: { clerkId: authResult.userId },
        include: { companyProfile: true },
      });

      if (!user?.companyProfile) {
        return forbidden(reply, 'Company profile required');
      }

      const { amountInCents, workUnitId } = request.body;
      const company = user.companyProfile;
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

      // Ensure Stripe customer exists
      const customerId = await getOrCreateCustomer(
        company.stripeCustomerId,
        { email: user.email, name: company.companyName }
      );

      // Update company profile with Stripe customer ID if new
      if (!company.stripeCustomerId) {
        await db.companyProfile.update({
          where: { id: company.id },
          data: { stripeCustomerId: customerId },
        });
      }

      const session = await createCheckoutSession({
        customerId,
        amountInCents,
        workUnitId,
        companyId: company.id,
        successUrl: `${frontendUrl}/dashboard/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${frontendUrl}/dashboard/billing?cancelled=true`,
      });

      return reply.send({
        checkoutUrl: session.checkoutUrl,
        sessionId: session.sessionId,
        amountInCents,
      });
    }
  );

  // ====================
  // WEBHOOK ROUTES (Stripe)
  // ====================

  fastify.post('/webhooks/stripe', {
    config: { rawBody: true },
  }, async (request, reply) => {
    // Verify Stripe webhook signature in production
    let event: any;
    const stripeSignature = request.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (webhookSecret && stripeSignature) {
      try {
        const rawBody = (request as any).rawBody || JSON.stringify(request.body);
        event = await constructWebhookEvent(rawBody, stripeSignature, webhookSecret);
      } catch (err: any) {
        fastify.log.error(`Stripe webhook signature verification failed: ${err.message}`);
        return reply.status(400).send({ error: 'Invalid signature' });
      }
    } else {
      // Dev mode — accept unverified webhooks
      event = request.body as any;
      if (!event?.type) {
        return reply.status(400).send({ error: 'Invalid webhook payload' });
      }
    }

    fastify.log.info(`Stripe webhook received: ${event.type}`);

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        if (paymentIntent.metadata?.workUnitId) {
          await db.escrow.updateMany({
            where: { stripePaymentIntentId: paymentIntent.id },
            data: { status: 'funded', fundedAt: new Date() },
          });
        }
        break;
      }

      case 'transfer.created': {
        const transfer = event.data.object;
        if (transfer.metadata?.payoutId) {
          await db.payout.update({
            where: { id: transfer.metadata.payoutId },
            data: { status: 'processing', stripeTransferId: transfer.id },
          });
        }
        break;
      }

      case 'transfer.paid': {
        const transfer = event.data.object;
        await db.payout.updateMany({
          where: { stripeTransferId: transfer.id },
          data: { status: 'completed', processedAt: new Date() },
        });
        break;
      }

      case 'transfer.failed': {
        const transfer = event.data.object;
        await db.payout.updateMany({
          where: { stripeTransferId: transfer.id },
          data: { 
            status: 'failed', 
            failureReason: transfer.failure_message || 'Transfer failed',
          },
        });
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        if (invoice.metadata?.companyId) {
          await db.invoice.updateMany({
            where: { stripeInvoiceId: invoice.id },
            data: { status: 'paid', paidAt: new Date() },
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.metadata?.companyId) {
          await db.invoice.updateMany({
            where: { stripeInvoiceId: invoice.id },
            data: { status: 'overdue' },
          });

          const company = await db.companyProfile.findFirst({
            where: { stripeCustomerId: invoice.customer as string },
          });

          if (company) {
            await db.notification.create({
              data: {
                userId: company.userId,
                userType: 'company',
                type: 'payment_failed',
                title: 'Payment Failed',
                body: 'Your invoice payment failed. Please update your payment method.',
                data: { invoiceId: invoice.id },
                channels: ['in_app', 'email'],
              },
            });
          }
        }
        break;
      }

      case 'account.updated': {
        const account = event.data.object;
        if (account.metadata?.studentId) {
          const chargesEnabled = account.charges_enabled;
          const payoutsEnabled = account.payouts_enabled;

          await db.studentProfile.updateMany({
            where: { stripeConnectId: account.id },
            data: {
              stripeConnectStatus: chargesEnabled && payoutsEnabled ? 'active' : 'restricted',
            },
          });
        }
        break;
      }

      // ── Checkout Session (company add-funds) ──
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { companyId, workUnitId, type: paymentType } = session.metadata || {};

        if (paymentType === 'escrow' && workUnitId) {
          await db.escrow.updateMany({
            where: { workUnitId, status: 'pending' },
            data: {
              status: 'funded',
              fundedAt: new Date(),
              stripePaymentIntentId: session.payment_intent,
            },
          });
        }

        if (companyId) {
          await db.paymentTransaction.create({
            data: {
              companyId,
              type: paymentType === 'escrow' ? 'escrow_funding' : 'add_funds',
              amountInCents: session.amount_total || 0,
              feeInCents: 0,
              netAmountInCents: session.amount_total || 0,
              direction: 'debit',
              status: 'completed',
              stripePaymentId: session.payment_intent,
              description: paymentType === 'escrow'
                ? `Escrow funding for work unit ${workUnitId}`
                : 'Account funding via Checkout',
            },
          });
        }
        break;
      }

      // ── Identity Verification (KYC) ──
      case 'identity.verification_session.verified': {
        const vs = event.data.object;
        if (vs.metadata?.studentId) {
          await db.studentProfile.updateMany({
            where: { stripeIdentityId: vs.id },
            data: { kycStatus: 'verified' },
          });
          fastify.log.info(`KYC verified for student ${vs.metadata.studentId}`);
        }
        break;
      }

      case 'identity.verification_session.requires_input': {
        const vs = event.data.object;
        if (vs.metadata?.studentId) {
          await db.studentProfile.updateMany({
            where: { stripeIdentityId: vs.id },
            data: { kycStatus: 'action_required' },
          });
        }
        break;
      }

      default:
        fastify.log.info(`Unhandled Stripe event: ${event.type}`);
    }

    return reply.send({ received: true });
  });

  // ====================
  // ADMIN/INTERNAL ROUTES
  // ====================

  fastify.post('/process-payouts', async (request, reply) => {
    const pendingPayouts = await db.payout.findMany({
      where: { status: 'pending' },
      include: {
        student: { select: { id: true, name: true, stripeConnectId: true, stripeConnectStatus: true } },
        executions: { include: { workUnit: { select: { title: true } } } },
      },
    });

    const readyForPayout = pendingPayouts.filter(
      p => p.student.stripeConnectStatus === 'active' && p.student.stripeConnectId
    );

    return reply.send({
      totalPending: pendingPayouts.length,
      readyForPayout: readyForPayout.length,
      notReady: pendingPayouts.length - readyForPayout.length,
      totalAmountInCents: readyForPayout.reduce((sum, p) => sum + p.amountInCents, 0),
    });
  });

  fastify.post('/generate-invoices', async (request, reply) => {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const companies = await db.companyProfile.findMany({
      where: {
        workUnits: {
          some: {
            status: 'completed',
            updatedAt: { gte: lastMonth, lt: thisMonth },
          },
        },
      },
      include: {
        workUnits: {
          where: {
            status: 'completed',
            updatedAt: { gte: lastMonth, lt: thisMonth },
          },
          select: { id: true, title: true, priceInCents: true, platformFeePercent: true },
        },
      },
    });

    const invoicesCreated: string[] = [];

    for (const company of companies) {
      const existing = await db.invoice.findFirst({
        where: { companyId: company.id, periodStart: lastMonth },
      });

      if (existing) continue;

      const lineItems = company.workUnits.map(wu => ({
        workUnitId: wu.id,
        title: wu.title,
        amountInCents: wu.priceInCents,
        feeInCents: Math.round(wu.priceInCents * wu.platformFeePercent),
      }));

      const subtotal = lineItems.reduce((sum, li) => sum + li.amountInCents, 0);
      const fees = lineItems.reduce((sum, li) => sum + li.feeInCents, 0);
      const total = subtotal + fees;

      const invoice = await db.invoice.create({
        data: {
          companyId: company.id,
          periodStart: lastMonth,
          periodEnd: new Date(thisMonth.getTime() - 1),
          subtotalInCents: subtotal,
          platformFeesInCents: fees,
          totalInCents: total,
          lineItems: JSON.stringify(lineItems),
          status: 'draft',
        },
      });

      invoicesCreated.push(invoice.id);
    }

    return reply.send({
      companiesProcessed: companies.length,
      invoicesCreated: invoicesCreated.length,
      invoiceIds: invoicesCreated,
    });
  });
}
