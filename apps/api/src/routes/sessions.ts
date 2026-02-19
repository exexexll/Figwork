import type { FastifyInstance } from 'fastify';
import { db } from '@figwork/db';
import { requireAuth } from '../lib/clerk.js';
import { generateSignedUrl, generateAudioUrl } from '../lib/cloudinary.js';
import { pdfQueue, postProcessQueue } from '../lib/queues.js';
import { getRedis } from '../lib/redis.js';
import crypto from 'crypto';

export async function registerSessionRoutes(fastify: FastifyInstance): Promise<void> {
  // List sessions for authenticated user's templates
  fastify.get<{
    Querystring: {
      templateId?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/sessions', {
    preHandler: requireAuth,
  }, async (request) => {
    const { templateId, status, limit, offset } = request.query;

    // Get all templates owned by user
    const userTemplates = await db.interviewTemplate.findMany({
      where: { ownerId: request.user!.id },
      select: { id: true },
    });

    const templateIds = userTemplates.map((t) => t.id);

    const sessions = await db.interviewSession.findMany({
      where: {
        templateId: templateId ? { equals: templateId } : { in: templateIds },
        ...(status && { status }),
      },
      include: {
        template: {
          select: {
            id: true,
            name: true,
            mode: true,
          },
        },
        link: {
          select: {
            mode: true,
          },
        },
        summary: {
          select: {
            id: true,
          },
        },
        _count: {
          select: { transcriptMessages: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit ? parseInt(limit, 10) : 50,
      skip: offset ? parseInt(offset, 10) : 0,
    });

    return {
      success: true,
      data: sessions.map((s) => ({
        id: s.id,
        templateId: s.templateId,
        templateName: s.template.name,
        // Mode comes from link (if set) or template
        mode: s.link?.mode ?? s.template.mode,
        status: s.status,
        messageCount: s._count.transcriptMessages,
        hasSummary: !!s.summary,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        createdAt: s.createdAt,
      })),
    };
  });

  // Get single session details
  fastify.get<{
    Params: { id: string };
  }>('/api/sessions/:id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const session = await db.interviewSession.findFirst({
      where: { id: request.params.id },
      include: {
        template: true,
        link: true,
        summary: true,
        candidateFiles: true,
        _count: {
          select: { transcriptMessages: true },
        },
      },
    });

    if (!session || session.template.ownerId !== request.user!.id) {
      return reply.status(404).send({ success: false, error: 'Session not found' });
    }

    return {
      success: true,
      data: {
        ...session,
        // Add mode at top level for easy frontend access
        mode: session.link?.mode ?? session.template.mode,
      },
    };
  });

  // Get session transcript
  fastify.get<{
    Params: { id: string };
  }>('/api/sessions/:id/transcript', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const session = await db.interviewSession.findFirst({
      where: { id: request.params.id },
      include: {
        template: true,
      },
    });

    if (!session || session.template.ownerId !== request.user!.id) {
      return reply.status(404).send({ success: false, error: 'Session not found' });
    }

    const messages = await db.transcriptMessage.findMany({
      where: { sessionId: request.params.id },
      include: {
        question: {
          select: {
            id: true,
            questionText: true,
            orderIndex: true,
          },
        },
      },
      orderBy: { timestampMs: 'asc' },
    });

    // Convert BigInt to string for JSON serialization
    return {
      success: true,
      data: messages.map((m) => ({
        ...m,
        timestampMs: m.timestampMs.toString(),
      })),
    };
  });

  // Get signed audio URL
  fastify.get<{
    Params: { id: string };
  }>('/api/sessions/:id/audio', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const session = await db.interviewSession.findFirst({
      where: { id: request.params.id },
      include: {
        template: true,
      },
    });

    if (!session || session.template.ownerId !== request.user!.id) {
      return reply.status(404).send({ success: false, error: 'Session not found' });
    }

    if (!session.audioPublicId) {
      return reply.status(404).send({ success: false, error: 'No audio available' });
    }

    // Use the direct audio URL or the stored audioUrl
    // Audio is uploaded with resource_type: 'video' in Cloudinary
    const audioUrl = session.audioUrl || generateAudioUrl(session.audioPublicId);

    return {
      success: true,
      data: { url: audioUrl },
    };
  });

  // Regenerate summary for a session
  fastify.post<{
    Params: { id: string };
  }>('/api/sessions/:id/regenerate-summary', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const session = await db.interviewSession.findFirst({
      where: { id: request.params.id },
      include: {
        template: true,
      },
    });

    if (!session || session.template.ownerId !== request.user!.id) {
      return reply.status(404).send({ success: false, error: 'Session not found' });
    }

    // Delete existing summary
    await db.interviewSummary.deleteMany({
      where: { sessionId: request.params.id },
    });

    // Queue for regeneration
    await postProcessQueue.add('generate-summary', {
      sessionId: request.params.id,
    });

    return {
      success: true,
      message: 'Summary regeneration queued',
    };
  });

  // Export session
  fastify.get<{
    Params: { id: string; format: 'txt' | 'json' | 'pdf' };
  }>('/api/sessions/:id/export/:format', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const session = await db.interviewSession.findFirst({
      where: { id: request.params.id },
      include: {
        template: true,
        summary: true,
        candidateFiles: true,
      },
    });

    if (!session || session.template.ownerId !== request.user!.id) {
      return reply.status(404).send({ success: false, error: 'Session not found' });
    }

    const messages = await db.transcriptMessage.findMany({
      where: { sessionId: request.params.id },
      include: {
        question: true,
      },
      orderBy: { timestampMs: 'asc' },
    });

    const { format } = request.params;

    if (format === 'json') {
      return {
        success: true,
        data: {
          session: {
            id: session.id,
            status: session.status,
            startedAt: session.startedAt,
            completedAt: session.completedAt,
          },
          template: {
            id: session.template.id,
            name: session.template.name,
          },
          transcript: messages.map((m) => ({
            role: m.role,
            content: m.content,
            messageType: m.messageType,
            timestamp: new Date(Number(m.timestampMs)).toISOString(),
            questionText: m.question?.questionText,
          })),
          summary: session.summary,
          candidateFiles: session.candidateFiles.map((f) => ({
            filename: f.filename,
            fileType: f.fileType,
          })),
        },
      };
    }

    if (format === 'txt') {
      let content = `Interview Transcript\n`;
      content += `${'='.repeat(50)}\n\n`;
      content += `Template: ${session.template.name}\n`;
      content += `Status: ${session.status}\n`;
      content += `Date: ${session.startedAt?.toISOString() || 'N/A'}\n\n`;
      content += `${'='.repeat(50)}\n\n`;

      let currentQuestion = '';
      for (const msg of messages) {
        if (msg.question?.questionText && msg.question.questionText !== currentQuestion) {
          currentQuestion = msg.question.questionText;
          content += `\n--- Question: ${currentQuestion} ---\n\n`;
        }
        content += `[${msg.role.toUpperCase()}]: ${msg.content}\n\n`;
      }

      if (session.summary) {
        content += `\n${'='.repeat(50)}\n`;
        content += `SUMMARY\n`;
        content += `${'='.repeat(50)}\n\n`;
        content += session.summary.rawSummary || '';
      }

      reply.header('Content-Type', 'text/plain');
      reply.header('Content-Disposition', `attachment; filename="interview-${session.id}.txt"`);
      return reply.send(content);
    }

    // Generate PDF
    const { generateInterviewPDF } = await import('../lib/pdf-generator.js');
    
    const pdfBuffer = await generateInterviewPDF({
      sessionId: session.id,
      templateName: session.template.name,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        messageType: m.messageType,
        question: m.question ? {
          questionText: m.question.questionText,
          orderIndex: m.question.orderIndex,
        } : null,
      })),
      summary: session.summary ? {
        strengths: session.summary.strengths as string[] | null,
        gaps: session.summary.gaps as string[] | null,
        rubricCoverage: session.summary.rubricCoverage as Record<string, unknown> | null,
        supportingQuotes: session.summary.supportingQuotes as string[] | null,
        rawSummary: session.summary.rawSummary,
      } : null,
      candidateFiles: session.candidateFiles.map((f) => ({
        filename: f.filename,
        fileType: f.fileType,
      })),
    });

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="interview-${session.id}.pdf"`);
    return reply.send(pdfBuffer);
  });

  // Queue PDF generation (async - for large sessions)
  fastify.post<{
    Params: { id: string };
  }>('/api/sessions/:id/export/pdf/async', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const session = await db.interviewSession.findFirst({
      where: { id: request.params.id },
      include: {
        template: {
          select: { ownerId: true },
        },
      },
    });

    if (!session || session.template.ownerId !== request.user!.id) {
      return reply.status(404).send({ success: false, error: 'Session not found' });
    }

    // Generate unique job ID
    const jobId = crypto.randomBytes(16).toString('hex');

    // Queue PDF generation
    await pdfQueue.add('generate-pdf', {
      sessionId: request.params.id,
      requesterId: request.user!.id,
      jobId,
    });

    return {
      success: true,
      data: {
        jobId,
        statusUrl: `/api/sessions/${request.params.id}/export/pdf/status/${jobId}`,
      },
    };
  });

  // Check PDF generation status
  fastify.get<{
    Params: { id: string; jobId: string };
  }>('/api/sessions/:id/export/pdf/status/:jobId', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const redis = getRedis();
    const statusKey = `pdf:status:${request.params.jobId}`;
    const statusData = await redis.get(statusKey);

    if (!statusData) {
      return reply.status(404).send({ success: false, error: 'Job not found or expired' });
    }

    const status = JSON.parse(statusData);

    return {
      success: true,
      data: status,
    };
  });

  // Download generated PDF
  fastify.get<{
    Params: { id: string; jobId: string };
  }>('/api/sessions/:id/export/pdf/download/:jobId', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const redis = getRedis();
    const statusKey = `pdf:status:${request.params.jobId}`;
    const statusData = await redis.get(statusKey);

    if (!statusData) {
      return reply.status(404).send({ success: false, error: 'Job not found or expired' });
    }

    const status = JSON.parse(statusData);

    if (status.status !== 'complete') {
      return reply.status(400).send({ success: false, error: 'PDF not ready yet' });
    }

    const pdfData = await redis.get(status.pdfKey);

    if (!pdfData) {
      return reply.status(404).send({ success: false, error: 'PDF data expired' });
    }

    const pdfBuffer = Buffer.from(pdfData, 'base64');

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${status.filename}"`);
    return reply.send(pdfBuffer);
  });
}
