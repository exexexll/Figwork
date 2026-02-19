import { Worker, Job } from 'bullmq';
import { getBullMQRedis } from '../lib/redis.js';
import { db } from '@figwork/db';
import { QUEUE_NAMES, PRICING_CONFIG } from '@figwork/shared';
import { createTransfer, createBatchTransfer } from '../lib/stripe-service.js';
import { sendPayoutCompleted } from '../lib/twilio-service.js';
import { sendPayoutCompletedEmail } from '../lib/email-service.js';

interface PayoutJobData {
  payoutId: string;
}

interface BatchPayoutJobData {
  studentId: string;
  payoutIds: string[];
}

async function processPayoutJob(job: Job<PayoutJobData | BatchPayoutJobData>) {
  if (job.name === 'process_single') {
    return await processSinglePayout(job.data as PayoutJobData);
  } else if (job.name === 'process_batch') {
    return await processBatchPayout(job.data as BatchPayoutJobData);
  } else if (job.name === 'daily_payout_run') {
    return await runDailyPayouts();
  }
}

async function processSinglePayout(data: PayoutJobData) {
  const { payoutId } = data;
  
  console.log(`[Payout] Processing payout ${payoutId}`);

  const payout = await db.payout.findUnique({
    where: { id: payoutId },
    include: {
      student: true,
      executions: { include: { workUnit: true } },
    },
  });

  if (!payout) {
    console.log(`[Payout] Payout ${payoutId} not found`);
    return { error: 'Payout not found' };
  }

  if (payout.status !== 'pending') {
    console.log(`[Payout] Payout ${payoutId} already processed`);
    return { skipped: true, reason: 'already_processed' };
  }

  // Verify student can receive payout
  if (payout.student.stripeConnectStatus !== 'active' || !payout.student.stripeConnectId) {
    console.log(`[Payout] Student ${payout.studentId} Stripe Connect not ready`);
    
    await db.notification.create({
      data: {
        userId: payout.student.clerkId,
        userType: 'student',
        type: 'payout_delayed',
        title: 'Payout Delayed',
        body: 'Please complete your Stripe Connect setup to receive payouts',
        data: { payoutId },
        channels: ['in_app', 'email'],
      },
    });

    return { delayed: true, reason: 'stripe_not_ready' };
  }

  try {
    // Mark as processing
    await db.payout.update({
      where: { id: payoutId },
      data: { status: 'processing' },
    });

    // Create Stripe transfer
    const transferResult = await createTransfer({
      amountInCents: payout.amountInCents,
      destinationAccountId: payout.student.stripeConnectId!,
      payoutId,
      description: `Figwork payout - ${payout.executions.length} task(s)`,
    });

    if (!transferResult.transferId || transferResult.status === 'failed') {
      throw new Error('Stripe transfer failed');
    }

    const stripeTransferId = transferResult.transferId;

    // Update payout with transfer ID
    await db.payout.update({
      where: { id: payoutId },
      data: {
        stripeTransferId,
        processedAt: new Date(),
        status: 'completed',
      },
    });

    // Send notifications
    if (payout.student.phone) {
      await sendPayoutCompleted(payout.student.phone, {
        amount: `$${(payout.amountInCents / 100).toFixed(2)}`,
      });
    }

    if (payout.student.email) {
      await sendPayoutCompletedEmail(payout.student.email, {
        studentName: payout.student.name,
        amountInCents: payout.amountInCents,
        taskCount: payout.executions.length,
        periodStart: new Date(payout.createdAt).toLocaleDateString(),
        periodEnd: new Date().toLocaleDateString(),
      });
    }

    // Update execution payout status
    const executionIds = payout.executions.map(e => e.id);
    await db.execution.updateMany({
      where: { id: { in: executionIds } },
      data: { payoutStatus: 'completed' },
    });

    // Create transaction record
    await db.paymentTransaction.create({
      data: {
        studentId: payout.studentId,
        type: 'payout',
        amountInCents: payout.amountInCents,
        feeInCents: 0,
        netAmountInCents: payout.amountInCents,
        direction: 'credit',
        status: 'completed',
        stripeTransferId,
        description: `Payout for ${payout.executions.length} completed task(s)`,
      },
    });

    // Notify student
    await db.notification.create({
      data: {
        userId: payout.student.clerkId,
        userType: 'student',
        type: 'payout_completed',
        title: 'Payout Sent!',
        body: `$${(payout.amountInCents / 100).toFixed(2)} has been sent to your account`,
        data: { payoutId, amountInCents: payout.amountInCents },
        channels: ['in_app', 'email'],
      },
    });

    console.log(`[Payout] Payout ${payoutId} completed: $${(payout.amountInCents / 100).toFixed(2)}`);

    return {
      payoutId,
      amountInCents: payout.amountInCents,
      transferId: stripeTransferId,
      status: 'completed',
    };

  } catch (error) {
    console.error(`[Payout] Failed to process payout ${payoutId}:`, error);

    await db.payout.update({
      where: { id: payoutId },
      data: {
        status: 'failed',
        failureReason: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    // Notify student
    await db.notification.create({
      data: {
        userId: payout.student.clerkId,
        userType: 'student',
        type: 'payout_failed',
        title: 'Payout Failed',
        body: 'There was an issue processing your payout. We\'ll retry automatically.',
        data: { payoutId },
        channels: ['in_app'],
      },
    });

    throw error;
  }
}

async function processBatchPayout(data: BatchPayoutJobData) {
  const { studentId, payoutIds } = data;
  
  console.log(`[Payout] Processing batch payout for student ${studentId}: ${payoutIds.length} payouts`);

  const student = await db.studentProfile.findUnique({
    where: { id: studentId },
  });

  if (!student) {
    return { error: 'Student not found' };
  }

  // Get all pending payouts
  const payouts = await db.payout.findMany({
    where: { id: { in: payoutIds }, status: 'pending' },
    include: { executions: true },
  });

  if (payouts.length === 0) {
    return { skipped: true, reason: 'no_pending_payouts' };
  }

  const totalAmount = payouts.reduce((sum, p) => sum + p.amountInCents, 0);

  // Process as single transfer
  try {
    // Mark all as processing
    await db.payout.updateMany({
      where: { id: { in: payoutIds } },
      data: { status: 'processing' },
    });

    // Create single Stripe transfer for batch
    const transferResult = await createTransfer({
      amountInCents: totalAmount,
      destinationAccountId: student.stripeConnectId!,
      payoutId: payoutIds[0], // Use first payout ID as reference
      description: `Figwork batch payout - ${payouts.length} tasks`,
    });

    if (!transferResult.transferId || transferResult.status === 'failed') {
      throw new Error('Stripe batch transfer failed');
    }

    const stripeTransferId = transferResult.transferId;

    // Update all payouts
    await db.payout.updateMany({
      where: { id: { in: payoutIds } },
      data: {
        stripeTransferId,
        processedAt: new Date(),
        status: 'completed',
      },
    });

    // Create single transaction record
    await db.paymentTransaction.create({
      data: {
        studentId,
        type: 'batch_payout',
        amountInCents: totalAmount,
        feeInCents: 0,
        netAmountInCents: totalAmount,
        direction: 'credit',
        status: 'completed',
        stripeTransferId,
        description: `Batch payout for ${payouts.length} completed task(s)`,
      },
    });

    // Send notifications
    if (student.phone) {
      await sendPayoutCompleted(student.phone, {
        amount: `$${(totalAmount / 100).toFixed(2)}`,
      });
    }

    if (student.email) {
      await sendPayoutCompletedEmail(student.email, {
        studentName: student.name,
        amountInCents: totalAmount,
        taskCount: payouts.length,
        periodStart: new Date(payouts[0].createdAt).toLocaleDateString(),
        periodEnd: new Date().toLocaleDateString(),
      });
    }

    // Notify student
    await db.notification.create({
      data: {
        userId: student.clerkId,
        userType: 'student',
        type: 'payout_completed',
        title: 'Payout Sent!',
        body: `$${(totalAmount / 100).toFixed(2)} for ${payouts.length} tasks has been sent`,
        data: { payoutIds, totalAmountInCents: totalAmount },
        channels: ['in_app', 'email'],
      },
    });

    console.log(`[Payout] Batch payout completed: $${(totalAmount / 100).toFixed(2)}`);

    return {
      studentId,
      payoutCount: payouts.length,
      totalAmountInCents: totalAmount,
      transferId: stripeTransferId,
      status: 'completed',
    };

  } catch (error) {
    console.error(`[Payout] Batch payout failed:`, error);

    await db.payout.updateMany({
      where: { id: { in: payoutIds } },
      data: {
        status: 'failed',
        failureReason: error instanceof Error ? error.message : 'Batch payout failed',
      },
    });

    throw error;
  }
}

async function runDailyPayouts() {
  console.log('[Payout] Running daily payout batch');

  // Get all students with pending payouts
  const studentsWithPayouts = await db.payout.groupBy({
    by: ['studentId'],
    where: { status: 'pending' },
    _sum: { amountInCents: true },
    _count: true,
  });

  const results = {
    studentsProcessed: 0,
    payoutsProcessed: 0,
    totalAmountInCents: 0,
    errors: [] as string[],
  };

  for (const studentGroup of studentsWithPayouts) {
    try {
      const student = await db.studentProfile.findUnique({
        where: { id: studentGroup.studentId },
      });

      if (!student || student.stripeConnectStatus !== 'active') {
        console.log(`[Payout] Skipping student ${studentGroup.studentId}: Stripe not ready`);
        continue;
      }

      // Get payout IDs for this student
      const payouts = await db.payout.findMany({
        where: { studentId: studentGroup.studentId, status: 'pending' },
        select: { id: true },
      });

      const payoutIds = payouts.map(p => p.id);

      // Process batch
      const result = await processBatchPayout({
        studentId: studentGroup.studentId,
        payoutIds,
      });

      if (!('error' in result) && !('skipped' in result)) {
        results.studentsProcessed++;
        results.payoutsProcessed += payoutIds.length;
        results.totalAmountInCents += studentGroup._sum.amountInCents || 0;
      }

    } catch (error) {
      console.error(`[Payout] Error processing student ${studentGroup.studentId}:`, error);
      results.errors.push(`Student ${studentGroup.studentId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  console.log(`[Payout] Daily batch complete: ${results.studentsProcessed} students, ${results.payoutsProcessed} payouts, $${(results.totalAmountInCents / 100).toFixed(2)}`);

  return results;
}

export function startPayoutWorker() {
  const worker = new Worker(
    QUEUE_NAMES.PAYOUT_PROCESS,
    processPayoutJob,
    {
      connection: getBullMQRedis(),
      concurrency: 5,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[Payout Worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Payout Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log('[Payout Worker] Started');
  return worker;
}
