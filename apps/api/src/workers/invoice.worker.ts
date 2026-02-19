/**
 * Invoice Generation Worker
 * 
 * Generates monthly invoices for companies including:
 * - Task payouts
 * - Platform fees
 * - Escrow movements
 */

import { Worker, Job } from 'bullmq';
import { db } from '@figwork/db';
import { notificationQueue } from '../lib/queues.js';
import { getBullMQRedis } from '../lib/redis.js';
import { QUEUE_NAMES, PRICING_CONFIG, calculatePlatformFee } from '@figwork/shared';

interface InvoiceGenerationJob {
  companyId: string;
  month: number;
  year: number;
}

/**
 * Generate invoice for a company for a specific month/year
 */
async function generateInvoice(
  companyId: string,
  month: number,
  year: number
): Promise<string> {
  const periodStart = new Date(year, month - 1, 1); // First day of month
  const periodEnd = new Date(year, month, 0, 23, 59, 59); // Last day of month

  const company = await db.companyProfile.findUnique({
    where: { id: companyId },
  });

  if (!company) {
    throw new Error(`Company ${companyId} not found`);
  }

  // Get all completed executions in period
  const executions = await db.execution.findMany({
    where: {
      workUnit: { companyId },
      completedAt: {
        gte: periodStart,
        lte: periodEnd,
      },
      status: 'approved',
    },
    include: {
      workUnit: { select: { title: true, priceInCents: true } },
      student: { select: { name: true, tier: true } },
    },
  });

  // Calculate totals using proper fee calculation per execution
  let taskPayoutsTotal = 0;
  let platformFeesTotal = 0;

  for (const exec of executions) {
    const feeResult = calculatePlatformFee(
      exec.workUnit.priceInCents,
      exec.student.tier as any,
    );
    taskPayoutsTotal += exec.workUnit.priceInCents;
    platformFeesTotal += feeResult.feeInCents;
  }

  const totalAmount = taskPayoutsTotal + platformFeesTotal;

  // Get escrow summary
  const escrowAccounts = await db.escrow.findMany({
    where: {
      workUnit: { companyId },
    },
  });

  const escrowFunded = escrowAccounts.reduce(
    (sum: number, e) => sum + (e.status === 'funded' ? e.amountInCents : 0),
    0
  );

  // Create invoice
  const invoice = await db.invoice.create({
    data: {
      companyId,
      periodStart,
      periodEnd,
      subtotalInCents: taskPayoutsTotal,
      platformFeesInCents: platformFeesTotal,
      totalInCents: totalAmount,
      status: totalAmount > 0 ? 'pending' : 'paid', // Zero invoices auto-marked paid
      lineItems: {
        taskPayouts: {
          description: 'Task Payouts',
          amountInCents: taskPayoutsTotal,
          count: executions.length,
        },
        platformFees: {
          description: 'Platform Fee',
          amountInCents: platformFeesTotal,
        },
        escrowSummary: {
          funded: escrowFunded,
        },
        executions: executions.map((e) => ({
          id: e.id,
          task: e.workUnit.title,
          student: e.student.name,
          amount: e.workUnit.priceInCents,
          completedAt: e.completedAt,
        })),
      },
    },
  });

  // Update budget period spending
  const budgetPeriod = await db.budgetPeriod.findFirst({
    where: {
      companyId,
      month,
      year,
    },
  });

  if (budgetPeriod) {
    await db.budgetPeriod.update({
      where: { id: budgetPeriod.id },
      data: {
        totalSpentInCents: {
          increment: totalAmount,
        },
      },
    });
  }

  // Send notification
  await notificationQueue.add('send', {
    userId: companyId,
    userType: 'company',
    type: 'invoice_generated',
    title: '📄 New Invoice Generated',
    body: `Invoice for $${(totalAmount / 100).toFixed(2)} for ${month}/${year} is ready.`,
    channels: ['in_app', 'email'],
    data: {
      invoiceId: invoice.id,
      amount: totalAmount,
    },
  });

  return invoice.id;
}

/**
 * Process invoice generation job
 */
async function processInvoiceGeneration(job: Job<InvoiceGenerationJob>) {
  const { companyId, month, year } = job.data;
  
  console.log(`[Invoice] Generating invoice for company ${companyId}, period ${month}/${year}`);

  try {
    const invoiceId = await generateInvoice(companyId, month, year);
    console.log(`[Invoice] Generated invoice: ${invoiceId}`);
    return { success: true, invoiceId };
  } catch (error) {
    console.error(`[Invoice] Failed to generate invoice:`, error);
    throw error;
  }
}

/**
 * Generate monthly invoices for all active companies
 */
export async function generateMonthlyInvoices(): Promise<{
  companiesProcessed: number;
  invoicesGenerated: number;
  errors: string[];
}> {
  const now = new Date();
  // Generate for previous month
  const targetMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // getMonth() is 0-based
  const targetYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  // Get all companies with billing set up
  const companies = await db.companyProfile.findMany({
    where: {
      stripeCustomerId: { not: null },
    },
    select: { id: true },
  });

  const errors: string[] = [];
  let invoicesGenerated = 0;

  for (const company of companies) {
    try {
      // Check if invoice already exists
      const periodStart = new Date(targetYear, targetMonth - 1, 1);
      const periodEnd = new Date(targetYear, targetMonth, 0, 23, 59, 59);

      const existing = await db.invoice.findFirst({
        where: {
          companyId: company.id,
          periodStart: { gte: periodStart },
          periodEnd: { lte: periodEnd },
        },
      });

      if (existing) {
        console.log(`[Invoice] Invoice already exists for company ${company.id}`);
        continue;
      }

      await generateInvoice(company.id, targetMonth, targetYear);
      invoicesGenerated++;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Company ${company.id}: ${message}`);
    }
  }

  return {
    companiesProcessed: companies.length,
    invoicesGenerated,
    errors,
  };
}

// Create and start the worker
const worker = new Worker<InvoiceGenerationJob>(
  QUEUE_NAMES.INVOICE_GENERATION,
  processInvoiceGeneration,
  {
    connection: getBullMQRedis(),
    concurrency: 5,
  }
);

worker.on('completed', (job) => {
  console.log(`[Invoice Worker] Job ${job.id} completed`);
});

worker.on('failed', (job, error) => {
  console.error(`[Invoice Worker] Job ${job?.id} failed:`, error);
});

export function startInvoiceWorker() {
  console.log('[Invoice Worker] Started');
}

export { worker as invoiceWorker };
