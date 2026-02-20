import { Worker, Job } from 'bullmq';
import { getBullMQRedis } from '../lib/redis.js';
import { db } from '@figwork/db';
import { QUEUE_NAMES, TIER_CONFIG } from '@figwork/shared';
import { getOpenAIClient } from '@figwork/ai';
import { sendPOWRequest, sendPOWReminder, sendPOWExpired } from '../lib/twilio-service.js';

interface POWRequestJobData {
  executionId: string;
  studentId: string;
}

interface POWAnalyzeJobData {
  powId: string;
}

async function processPOWJob(job: Job<POWRequestJobData | POWAnalyzeJobData>) {
  if (job.name === 'request_pow') {
    return await requestPOW(job.data as POWRequestJobData);
  } else if (job.name === 'analyze_pow') {
    return await analyzePOW(job.data as POWAnalyzeJobData);
  }
}

async function requestPOW(data: POWRequestJobData) {
  const { executionId, studentId } = data;
  
  console.log(`[POW] Requesting POW for execution ${executionId}`);

  // Check if execution is still active
  const execution = await db.execution.findUnique({
    where: { id: executionId },
    include: { student: true, workUnit: true },
  });

  if (!execution || execution.status !== 'clocked_in') {
    console.log(`[POW] Execution ${executionId} no longer active, skipping`);
    return { skipped: true, reason: 'execution_not_active' };
  }

  // Create POW request
  const pow = await db.proofOfWorkLog.create({
    data: {
      executionId,
      studentId,
      requestedAt: new Date(),
      status: 'pending',
    },
  });

  // Send SMS notification via Twilio
  if (execution.student.phone) {
    const powUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/student/pow?id=${pow.id}`;
    const smsResult = await sendPOWRequest(execution.student.phone, {
      studentName: execution.student.name,
      taskTitle: execution.workUnit.title,
      timeoutMinutes: 10,
      powUrl,
    });

    // Log SMS
    await db.sMSLog.create({
      data: {
        phone: execution.student.phone,
        message: `POW check required for "${execution.workUnit.title}". Submit within 10 minutes.`,
        type: 'pow_request',
        twilioMessageId: smsResult.messageId,
        status: smsResult.success ? 'sent' : 'failed',
        error: smsResult.error,
      },
    });
  }

  // Create notification
  await db.notification.create({
    data: {
      userId: execution.student.clerkId,
      userType: 'student',
      type: 'pow_request',
      title: 'POW Check Required',
      body: `Submit your proof of work for "${execution.workUnit.title}" within 10 minutes`,
      data: { powId: pow.id, executionId },
      channels: ['in_app', 'sms'],
    },
  });

  // Schedule next POW request
  const tierConfig = TIER_CONFIG[execution.student.tier as keyof typeof TIER_CONFIG];
  const nextPOWDelay = tierConfig.benefits.powFrequency * 60 * 1000;

  // Note: In production, this would re-queue another POW request
  // For now, we'll rely on the cron job to trigger POW requests

  // Schedule expiration check (10 minutes)
  // In production, queue a job to check if POW was submitted after 10 minutes

  console.log(`[POW] POW request ${pow.id} created for execution ${executionId}`);
  
  return { powId: pow.id, status: 'requested' };
}

async function analyzePOW(data: POWAnalyzeJobData) {
  const { powId } = data;
  
  console.log(`[POW] Analyzing POW ${powId}`);

  const pow = await db.proofOfWorkLog.findUnique({
    where: { id: powId },
    include: {
      execution: { include: { workUnit: true } },
      student: true,
    },
  });

  if (!pow || pow.status !== 'submitted') {
    console.log(`[POW] POW ${powId} not ready for analysis`);
    return { skipped: true, reason: 'not_submitted' };
  }

  if (!pow.workPhotoUrl || !pow.selfiePhotoUrl) {
    console.log(`[POW] POW ${powId} missing required photos`);
    await db.proofOfWorkLog.update({
      where: { id: powId },
      data: { status: 'failed', analysisError: 'Missing required photos' },
    });
    return { failed: true, reason: 'missing_photos' };
  }

  try {
    const openai = getOpenAIClient();
    
    // Analyze work photo relevance
    let workRelevanceScore = 0.5;
    let suspiciousFlags: string[] = [];
    
    try {
      const workAnalysis = await openai.chat.completions.create({
        model: 'gpt-5.2',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this work photo for a task: "${pow.execution.workUnit.title}".
                       Task description: "${pow.execution.workUnit.spec.slice(0, 500)}..."
                       
                       Is this photo showing relevant work in progress?
                       
                       Return JSON: {
                         "relevance": number (0-1, 1 being highly relevant),
                         "suspicious": string[] (any suspicious indicators like stock photos, wrong content, etc),
                         "description": string (what you see in the photo)
                       }`,
              },
              {
                type: 'image_url',
                image_url: { url: pow.workPhotoUrl },
              },
            ],
          },
        ],
        max_completion_tokens: 300,
        response_format: { type: 'json_object' },
      });

      const workResult = JSON.parse(workAnalysis.choices[0].message.content || '{}');
      workRelevanceScore = workResult.relevance || 0.5;
      suspiciousFlags = workResult.suspicious || [];
    } catch (e) {
      console.error('[POW] Work photo analysis failed:', e);
    }

    // Analyze selfie / face match
    let faceMatchScore = 0.5;
    let faceConfidence = 0.5;

    if (pow.student.kycSelfieUrl) {
      try {
        const faceAnalysis = await openai.chat.completions.create({
          model: 'gpt-5.2',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Compare these two photos. The first is a KYC verification selfie. The second is a current proof-of-work selfie.
                         
                         Are they likely the same person?
                         
                         Return JSON: {
                           "match": boolean,
                           "confidence": number (0-1),
                           "notes": string
                         }`,
                },
                {
                  type: 'image_url',
                  image_url: { url: pow.student.kycSelfieUrl },
                },
                {
                  type: 'image_url',
                  image_url: { url: pow.selfiePhotoUrl },
                },
              ],
            },
          ],
          max_completion_tokens: 200,
          response_format: { type: 'json_object' },
        });

        const faceResult = JSON.parse(faceAnalysis.choices[0].message.content || '{}');
        faceMatchScore = faceResult.match ? (faceResult.confidence || 0.9) : 0.2;
        faceConfidence = faceResult.confidence || 0.5;

        if (!faceResult.match) {
          suspiciousFlags.push('face_mismatch');
        }
      } catch (e) {
        console.error('[POW] Face analysis failed:', e);
      }
    }

    // Calculate progress score based on description
    let progressScore = 0.5;
    if (pow.progressDescription) {
      progressScore = pow.progressDescription.length > 100 ? 0.8 : 
                      pow.progressDescription.length > 50 ? 0.6 : 0.4;
    }

    // Calculate overall risk score
    const riskScore = 1 - (
      faceMatchScore * 0.4 +
      workRelevanceScore * 0.4 +
      progressScore * 0.2
    );

    // Time-based checks
    const responseTime = pow.respondedAt 
      ? pow.respondedAt.getTime() - pow.requestedAt.getTime()
      : Date.now() - pow.requestedAt.getTime();
    
    if (responseTime > 15 * 60 * 1000) { // More than 15 minutes
      suspiciousFlags.push('late_response');
    }

    // Determine verification result
    const verified = faceMatchScore > 0.6 && workRelevanceScore > 0.5 && riskScore < 0.5;

    // Update POW record
    await db.proofOfWorkLog.update({
      where: { id: powId },
      data: {
        status: verified ? 'verified' : 'failed',
        faceMatchScore,
        faceConfidence,
        workRelevanceScore,
        progressScore,
        suspiciousFlags,
        riskScore,
        analysisCompletedAt: new Date(),
      },
    });

    // Handle consequences
    if (!verified) {
      // Deduct EXP
      await db.studentProfile.update({
        where: { id: pow.studentId },
        data: { totalExp: { decrement: 25 } },
      });

      // Notify student
      await db.notification.create({
        data: {
          userId: pow.student.clerkId,
          userType: 'student',
          type: 'pow_failed',
          title: 'POW Verification Failed',
          body: suspiciousFlags.includes('face_mismatch')
            ? 'Face verification failed'
            : 'Work photo not relevant to assigned task',
          data: { powId, suspiciousFlags, riskScore },
          channels: ['in_app'],
        },
      });

      // Check for repeated failures
      const recentFailures = await db.proofOfWorkLog.count({
        where: {
          studentId: pow.studentId,
          status: 'failed',
          requestedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      });

      if (recentFailures >= 3) {
        // Escalate to admin
        await db.notification.create({
          data: {
            userId: 'admin',
            userType: 'admin',
            type: 'pow_escalation',
            title: 'POW Escalation Required',
            body: `Student ${pow.student.name} has ${recentFailures} POW failures in the last 7 days`,
            data: { studentId: pow.studentId, failures: recentFailures },
            channels: ['in_app', 'email'],
          },
        });
      }
    } else {
      // Grant EXP for successful POW
      await db.studentProfile.update({
        where: { id: pow.studentId },
        data: { totalExp: { increment: 5 } },
      });
    }

    console.log(`[POW] Analysis complete for ${powId}: ${verified ? 'verified' : 'failed'}`);
    
    return {
      verified,
      faceMatchScore,
      workRelevanceScore,
      riskScore,
      suspiciousFlags,
    };

  } catch (error) {
    console.error(`[POW] Analysis error for ${powId}:`, error);
    
    await db.proofOfWorkLog.update({
      where: { id: powId },
      data: {
        analysisError: error instanceof Error ? error.message : 'Analysis failed',
      },
    });

    throw error;
  }
}

export function startPOWWorker() {
  const worker = new Worker(
    QUEUE_NAMES.POW_ANALYSIS,
    processPOWJob,
    {
      connection: getBullMQRedis(),
      concurrency: 5,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[POW Worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[POW Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log('[POW Worker] Started');
  return worker;
}
