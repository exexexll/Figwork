import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '@figwork/db';
import { getOpenAIClient } from '@figwork/ai';
import { TIER_CONFIG } from '@figwork/shared';
import { verifyClerkAuth } from '../lib/clerk.js';
import { forbidden, notFound, badRequest } from '../lib/http-errors.js';

interface SubmitPOWBody {
  workPhotoUrl: string;
  selfiePhotoUrl: string;
  progressDescription?: string;
}

export async function powRoutes(fastify: FastifyInstance) {
  // Middleware: Require authenticated student
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const student = await db.studentProfile.findUnique({
      where: { clerkId: authResult.userId },
    });

    if (!student) {
      return forbidden(reply, 'Student profile required');
    }

    (request as any).student = student;
  });

  // GET /pending - List pending POW requests
  fastify.get('/pending', async (request, reply) => {
    const student = (request as any).student;

    const pendingPOWs = await db.proofOfWorkLog.findMany({
      where: {
        studentId: student.id,
        status: 'pending',
        requestedAt: { lte: new Date() },
      },
      include: {
        execution: {
          include: {
            workUnit: { select: { title: true } },
          },
        },
      },
      orderBy: { requestedAt: 'asc' },
    });

    return reply.send(pendingPOWs);
  });

  // GET /:powId - Get POW details
  fastify.get<{ Params: { powId: string } }>(
    '/:powId',
    async (request, reply) => {
      const student = (request as any).student;
      const { powId } = request.params;

      const pow = await db.proofOfWorkLog.findFirst({
        where: { id: powId, studentId: student.id },
        include: {
          execution: {
            include: {
              workUnit: { select: { title: true, spec: true } },
            },
          },
        },
      });

      if (!pow) {
        return notFound(reply, 'POW request not found');
      }

      return reply.send(pow);
    }
  );

  // POST /:powId/submit - Submit POW photos
  fastify.post<{ Params: { powId: string }; Body: SubmitPOWBody }>(
    '/:powId/submit',
    {
      schema: {
        body: {
          type: 'object',
          required: ['workPhotoUrl', 'selfiePhotoUrl'],
          properties: {
            workPhotoUrl: { type: 'string', format: 'uri', maxLength: 2048 },
            selfiePhotoUrl: { type: 'string', format: 'uri', maxLength: 2048 },
            progressDescription: { type: 'string', maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
      const student = (request as any).student;
      const { powId } = request.params;
      const { workPhotoUrl, selfiePhotoUrl, progressDescription } = request.body;

      // Validate URLs are from trusted sources (Cloudinary)
      const trustedDomains = ['res.cloudinary.com', 'cloudinary.com'];
      for (const url of [workPhotoUrl, selfiePhotoUrl]) {
        try {
          const parsed = new URL(url);
          if (!trustedDomains.some(d => parsed.hostname.endsWith(d))) {
            return badRequest(reply, 'Photos must be uploaded through the platform');
          }
        } catch {
          return badRequest(reply, 'Invalid photo URL');
        }
      }

      const pow = await db.proofOfWorkLog.findFirst({
        where: { id: powId, studentId: student.id, status: 'pending' },
        include: {
          execution: {
            include: { workUnit: true },
          },
        },
      });

      if (!pow) {
        return notFound(reply, 'POW request not found or already submitted');
      }

      const maxResponseTime = 10 * 60 * 1000;
      const now = new Date();
      const timeSinceRequest = now.getTime() - pow.requestedAt.getTime();
      const isLate = timeSinceRequest > maxResponseTime;

      const updated = await db.proofOfWorkLog.update({
        where: { id: powId },
        data: {
          workPhotoUrl,
          selfiePhotoUrl,
          progressDescription,
          respondedAt: now,
          status: 'submitted',
        },
      });

      try {
        const analysisResult = await analyzePOW(student, pow, {
          workPhotoUrl,
          selfiePhotoUrl,
          progressDescription,
        });

        await db.proofOfWorkLog.update({
          where: { id: powId },
          data: {
            status: analysisResult.verified ? 'verified' : 'failed',
            faceMatchScore: analysisResult.faceMatchScore,
            faceConfidence: analysisResult.faceConfidence,
            workRelevanceScore: analysisResult.workRelevanceScore,
            progressScore: analysisResult.progressScore,
            suspiciousFlags: analysisResult.suspiciousFlags,
            riskScore: analysisResult.riskScore,
            analysisCompletedAt: new Date(),
          },
        });

        if (!analysisResult.verified) {
          await db.studentProfile.update({
            where: { id: student.id },
            data: { totalExp: { decrement: 25 } },
          });

          await db.notification.create({
            data: {
              userId: student.clerkId,
              userType: 'student',
              type: 'pow_failed',
              title: 'POW Verification Failed',
              body: analysisResult.failureReason || 'Your proof of work could not be verified',
              data: { powId, reasons: analysisResult.suspiciousFlags },
              channels: ['in_app'],
            },
          });

          const recentFailures = await db.proofOfWorkLog.count({
            where: {
              studentId: student.id,
              status: 'failed',
              requestedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            },
          });

          if (recentFailures >= 3) {
            await db.notification.create({
              data: {
                userId: 'admin',
                userType: 'admin',
                type: 'pow_escalation',
                title: 'POW Escalation',
                body: `Student ${student.name} has ${recentFailures} POW failures in the last 7 days`,
                data: { studentId: student.id },
                channels: ['in_app', 'email'],
              },
            });
          }
        }

        return reply.send({
          ...updated,
          analysis: analysisResult,
          isLate,
        });
      } catch (error) {
        console.error('[POW] Analysis failed:', error);
        
        await db.proofOfWorkLog.update({
          where: { id: powId },
          data: {
            analysisError: error instanceof Error ? error.message : 'Analysis failed',
          },
        });

        return reply.send({
          ...updated,
          analysis: { pending: true, message: 'Analysis queued for manual review' },
          isLate,
        });
      }
    }
  );

  // GET /history - Get POW history
  fastify.get('/history', async (request, reply) => {
    const student = (request as any).student;
    const { limit = '20', offset = '0' } = request.query as { limit?: string; offset?: string };

    const powLogs = await db.proofOfWorkLog.findMany({
      where: { studentId: student.id },
      include: {
        execution: {
          include: {
            workUnit: { select: { title: true } },
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
    });

    const stats = await db.proofOfWorkLog.groupBy({
      by: ['status'],
      where: { studentId: student.id },
      _count: true,
    });

    return reply.send({
      logs: powLogs,
      stats: Object.fromEntries(stats.map(s => [s.status, s._count])),
    });
  });

  // POST /:powId/request-extension
  fastify.post<{ Params: { powId: string }; Body: { reason: string } }>(
    '/:powId/request-extension',
    async (request, reply) => {
      const student = (request as any).student;
      const { powId } = request.params;
      const { reason } = request.body;

      if (!reason || reason.length < 10) {
        return badRequest(reply, 'Please provide a valid reason for the extension');
      }

      const pow = await db.proofOfWorkLog.findFirst({
        where: { id: powId, studentId: student.id, status: 'pending' },
      });

      if (!pow) {
        return notFound(reply, 'POW request not found');
      }

      const recentExtensions = await db.notification.count({
        where: {
          userId: student.clerkId,
          type: 'pow_extension_granted',
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      });

      if (recentExtensions >= 2) {
        return badRequest(reply, 'Maximum extensions reached for today');
      }

      await db.notification.create({
        data: {
          userId: student.clerkId,
          userType: 'student',
          type: 'pow_extension_granted',
          title: 'POW Extension Granted',
          body: 'You have 10 more minutes to submit your proof of work',
          data: { powId, reason, extensionMinutes: 10 },
          channels: ['in_app'],
        },
      });

      return reply.send({
        extended: true,
        newDeadline: new Date(Date.now() + 10 * 60 * 1000),
        message: 'Extension granted. Please submit within 10 minutes.',
      });
    }
  );
}

// POW Analysis function
async function analyzePOW(
  student: any,
  pow: any,
  submission: { workPhotoUrl: string; selfiePhotoUrl: string; progressDescription?: string }
): Promise<{
  verified: boolean;
  faceMatchScore: number;
  faceConfidence: number;
  workRelevanceScore: number;
  progressScore: number;
  suspiciousFlags: string[];
  riskScore: number;
  failureReason?: string;
}> {
  const suspiciousFlags: string[] = [];
  let faceMatchScore = 0.9;
  let faceConfidence = 0.95;
  let workRelevanceScore = 0.8;
  let progressScore = 0.7;

  try {
    const openai = getOpenAIClient();
    
    const workAnalysis = await openai.chat.completions.create({
      model: 'gpt-5.2',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this work photo for a task: "${pow.execution.workUnit.title}". 
                     Is this photo showing relevant work in progress? 
                     Rate relevance 0-1 and list any suspicious indicators.
                     Return JSON: { "relevance": number, "suspicious": string[], "description": string }`,
            },
            {
              type: 'image_url',
              image_url: { url: submission.workPhotoUrl },
            },
          ],
        },
      ],
      max_completion_tokens: 200,
      response_format: { type: 'json_object' },
    });

    const workResult = JSON.parse(workAnalysis.choices[0].message.content || '{}');
    workRelevanceScore = workResult.relevance || 0.5;
    
    if (workResult.suspicious && workResult.suspicious.length > 0) {
      suspiciousFlags.push(...workResult.suspicious);
    }

    if (student.kycSelfieUrl) {
      const faceAnalysis = await openai.chat.completions.create({
        model: 'gpt-5.2',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Compare these two photos. Are they likely the same person?
                       Return JSON: { "match": boolean, "confidence": number, "notes": string }`,
              },
              {
                type: 'image_url',
                image_url: { url: student.kycSelfieUrl },
              },
              {
                type: 'image_url',
                image_url: { url: submission.selfiePhotoUrl },
              },
            ],
          },
        ],
        max_completion_tokens: 150,
        response_format: { type: 'json_object' },
      });

      const faceResult = JSON.parse(faceAnalysis.choices[0].message.content || '{}');
      faceMatchScore = faceResult.match ? (faceResult.confidence || 0.9) : 0.2;
      faceConfidence = faceResult.confidence || 0.5;

      if (!faceResult.match) {
        suspiciousFlags.push('face_mismatch');
      }
    }

    if (submission.progressDescription) {
      progressScore = submission.progressDescription.length > 50 ? 0.8 : 0.5;
    }

  } catch (error) {
    console.error('AI analysis failed:', error);
  }

  const riskScore = 1 - (
    faceMatchScore * 0.4 +
    workRelevanceScore * 0.4 +
    progressScore * 0.2
  );

  const responseTime = Date.now() - pow.requestedAt.getTime();
  if (responseTime > 15 * 60 * 1000) {
    suspiciousFlags.push('late_response');
  }

  const verified = faceMatchScore > 0.6 && workRelevanceScore > 0.5 && riskScore < 0.5;

  return {
    verified,
    faceMatchScore,
    faceConfidence,
    workRelevanceScore,
    progressScore,
    suspiciousFlags,
    riskScore,
    failureReason: !verified 
      ? suspiciousFlags.includes('face_mismatch')
        ? 'Face verification failed'
        : 'Work photo not relevant to assigned task'
      : undefined,
  };
}
