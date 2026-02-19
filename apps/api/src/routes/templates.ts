import type { FastifyInstance } from 'fastify';
import { db } from '@figwork/db';
import { requireAuth } from '../lib/clerk.js';
import { DEFAULTS, TEMPLATE_MODE } from '@figwork/shared';
import { invalidateTemplateCache } from '../lib/template-cache.js';

// Available OpenAI voices
const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;

// Available template modes
const TEMPLATE_MODES = [TEMPLATE_MODE.APPLICATION, TEMPLATE_MODE.INQUIRY] as const;

// JSON Schema for validation
const createTemplateSchema = {
  body: {
    type: 'object',
    required: ['name', 'personaPrompt'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      mode: { type: 'string', enum: TEMPLATE_MODES },
      personaPrompt: { type: 'string', minLength: 1 },
      toneGuidance: { type: 'string' },
      // Inquiry mode settings
      inquiryWelcome: { type: 'string' },
      inquiryGoal: { type: 'string' },
      // Application mode settings
      globalFollowupLimit: { type: 'integer', minimum: 1, maximum: 10 },
      timeLimitMinutes: { type: 'integer', minimum: 5, maximum: 120 },
      // Voice settings
      enableVoiceOutput: { type: 'boolean' },
      voiceId: { type: 'string', enum: OPENAI_VOICES },
      voiceIntroMessage: { type: 'string' },
    },
  },
};

const updateTemplateSchema = {
  body: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      mode: { type: 'string', enum: TEMPLATE_MODES },
      personaPrompt: { type: 'string', minLength: 1 },
      toneGuidance: { type: 'string' },
      // Inquiry mode settings
      inquiryWelcome: { type: 'string' },
      inquiryGoal: { type: 'string' },
      // Application mode settings
      globalFollowupLimit: { type: 'integer', minimum: 1, maximum: 10 },
      timeLimitMinutes: { type: 'integer', minimum: 5, maximum: 120 },
      // Voice settings
      enableVoiceOutput: { type: 'boolean' },
      voiceId: { type: 'string', enum: OPENAI_VOICES },
      voiceIntroMessage: { type: 'string' },
    },
  },
};

export async function registerTemplateRoutes(fastify: FastifyInstance): Promise<void> {
  // List templates for authenticated user
  fastify.get('/api/templates', {
    preHandler: requireAuth,
  }, async (request) => {
    const templates = await db.interviewTemplate.findMany({
      where: { ownerId: request.user!.id },
      include: {
        _count: {
          select: {
            questions: true,
            sessions: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: templates.map((t) => ({
        id: t.id,
        name: t.name,
        mode: t.mode,
        personaPrompt: t.personaPrompt,
        toneGuidance: t.toneGuidance,
        inquiryWelcome: t.inquiryWelcome,
        inquiryGoal: t.inquiryGoal,
        globalFollowupLimit: t.globalFollowupLimit,
        timeLimitMinutes: t.timeLimitMinutes,
        enableVoiceOutput: t.enableVoiceOutput,
        voiceId: t.voiceId,
        voiceIntroMessage: t.voiceIntroMessage,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        // Include _count for compatibility with frontend
        _count: {
          questions: t._count.questions,
          sessions: t._count.sessions,
        },
      })),
    };
  });

  // Get single template
  fastify.get<{
    Params: { id: string };
  }>('/api/templates/:id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const template = await db.interviewTemplate.findFirst({
      where: {
        id: request.params.id,
        ownerId: request.user!.id,
      },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' },
        },
        links: {
          orderBy: { createdAt: 'desc' },
        },
        knowledgeFiles: {
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { sessions: true },
        },
      },
    });

    if (!template) {
      return reply.status(404).send({ success: false, error: 'Template not found' });
    }

    // Add fullUrl to links
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const linksWithUrl = template.links.map((link) => ({
      ...link,
      fullUrl: `${frontendUrl}/interview/${link.token}`,
    }));

    return {
      success: true,
      data: {
        ...template,
        links: linksWithUrl,
      },
    };
  });

  // Create template
  fastify.post<{
    Body: {
      name: string;
      mode?: string;
      personaPrompt: string;
      toneGuidance?: string;
      inquiryWelcome?: string;
      inquiryGoal?: string;
      globalFollowupLimit?: number;
      timeLimitMinutes?: number;
      enableVoiceOutput?: boolean;
      voiceId?: string;
      voiceIntroMessage?: string;
    };
  }>('/api/templates', {
    schema: createTemplateSchema,
    preHandler: requireAuth,
  }, async (request) => {
    const { 
      name, 
      mode,
      personaPrompt, 
      toneGuidance, 
      inquiryWelcome,
      inquiryGoal,
      globalFollowupLimit, 
      timeLimitMinutes, 
      enableVoiceOutput, 
      voiceId,
      voiceIntroMessage,
    } = request.body;

    const template = await db.interviewTemplate.create({
      data: {
        ownerId: request.user!.id,
        name,
        mode: mode ?? TEMPLATE_MODE.APPLICATION,
        personaPrompt,
        toneGuidance: toneGuidance || null,
        inquiryWelcome: inquiryWelcome || null,
        inquiryGoal: inquiryGoal || null,
        globalFollowupLimit: globalFollowupLimit ?? DEFAULTS.GLOBAL_FOLLOWUP_LIMIT,
        timeLimitMinutes: timeLimitMinutes ?? DEFAULTS.TIME_LIMIT_MINUTES,
        enableVoiceOutput: enableVoiceOutput ?? false,
        voiceId: voiceId ?? 'nova',
        voiceIntroMessage: voiceIntroMessage || null,
      },
    });

    return {
      success: true,
      data: template,
    };
  });

  // Update template
  fastify.put<{
    Params: { id: string };
    Body: {
      name?: string;
      mode?: string;
      personaPrompt?: string;
      toneGuidance?: string;
      inquiryWelcome?: string;
      inquiryGoal?: string;
      globalFollowupLimit?: number;
      timeLimitMinutes?: number;
      enableVoiceOutput?: boolean;
      voiceId?: string;
      voiceIntroMessage?: string;
    };
  }>('/api/templates/:id', {
    schema: updateTemplateSchema,
    preHandler: requireAuth,
  }, async (request, reply) => {
    const template = await db.interviewTemplate.findFirst({
      where: {
        id: request.params.id,
        ownerId: request.user!.id,
      },
    });

    if (!template) {
      return reply.status(404).send({ success: false, error: 'Template not found' });
    }

    const updated = await db.interviewTemplate.update({
      where: { id: request.params.id },
      data: {
        name: request.body.name,
        mode: request.body.mode,
        personaPrompt: request.body.personaPrompt,
        toneGuidance: request.body.toneGuidance,
        inquiryWelcome: request.body.inquiryWelcome,
        inquiryGoal: request.body.inquiryGoal,
        globalFollowupLimit: request.body.globalFollowupLimit,
        timeLimitMinutes: request.body.timeLimitMinutes,
        enableVoiceOutput: request.body.enableVoiceOutput,
        voiceId: request.body.voiceId,
        voiceIntroMessage: request.body.voiceIntroMessage,
      },
    });

    // Invalidate template cache
    await invalidateTemplateCache(request.params.id);

    return {
      success: true,
      data: updated,
    };
  });

  // Delete template
  fastify.delete<{
    Params: { id: string };
  }>('/api/templates/:id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const template = await db.interviewTemplate.findFirst({
      where: {
        id: request.params.id,
        ownerId: request.user!.id,
      },
      include: {
        _count: {
          select: { sessions: true },
        },
      },
    });

    if (!template) {
      return reply.status(404).send({ success: false, error: 'Template not found' });
    }

    // **TRANSACTION: Delete template and all related data atomically**
    await db.$transaction(async (tx) => {
      // Delete in correct order to respect foreign keys
      // (Prisma cascade should handle this, but being explicit for safety)
      
      // Delete knowledge chunks first
      await tx.knowledgeChunk.deleteMany({
        where: { templateId: request.params.id },
      });

      // Delete knowledge files
      await tx.knowledgeFile.deleteMany({
        where: { templateId: request.params.id },
      });

      // Delete the template (cascades to questions, links, sessions)
      await tx.interviewTemplate.delete({
        where: { id: request.params.id },
      });
    });

    // Invalidate template cache
    await invalidateTemplateCache(request.params.id);

    return { success: true };
  });
}
