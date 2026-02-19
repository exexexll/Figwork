import type { FastifyInstance } from 'fastify';
import { db } from '@figwork/db';
import { requireAuth } from '../lib/clerk.js';
import { generateSecureToken, DEFAULTS, TEMPLATE_MODE } from '@figwork/shared';

// Available OpenAI voices
const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;

// Available modes
const TEMPLATE_MODES = [TEMPLATE_MODE.APPLICATION, TEMPLATE_MODE.INQUIRY] as const;

// JSON Schema for validation
const createLinkSchema = {
  body: {
    type: 'object',
    required: ['linkType'],
    properties: {
      linkType: { type: 'string', enum: ['one_time', 'permanent'] },
      expiresAt: { type: 'string', format: 'date-time' },
      maxUses: { type: 'integer', minimum: 1 },
      // Mode override (optional - inherits from template if not set)
      mode: { type: 'string', enum: TEMPLATE_MODES },
      allowFileUpload: { type: 'boolean' },
      maxFiles: { type: 'integer', minimum: 1, maximum: 20 },
      maxFileSizeMb: { type: 'number', minimum: 1, maximum: 500 },
      allowedFileTypes: {
        type: 'array',
        items: { type: 'string' },
      },
      enableVoiceOutput: { type: 'boolean' },
      voiceId: { type: 'string', enum: OPENAI_VOICES },
    },
  },
};

export async function registerLinkRoutes(fastify: FastifyInstance): Promise<void> {
  // Generate link for template
  fastify.post<{
    Params: { id: string };
    Body: {
      linkType: 'one_time' | 'permanent';
      expiresAt?: string;
      maxUses?: number;
      mode?: 'application' | 'inquiry';
      allowFileUpload?: boolean;
      maxFiles?: number;
      maxFileSizeMb?: number;
      allowedFileTypes?: string[];
      enableVoiceOutput?: boolean;
      voiceId?: string;
    };
  }>('/api/templates/:id/links', {
    schema: createLinkSchema,
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

    const {
      linkType,
      expiresAt,
      maxUses,
      mode,
      allowFileUpload,
      maxFiles,
      maxFileSizeMb,
      allowedFileTypes,
      enableVoiceOutput,
      voiceId,
    } = request.body;

    const link = await db.interviewLink.create({
      data: {
        templateId: request.params.id,
        token: generateSecureToken(),
        linkType,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        maxUses: maxUses || null,
        // Mode override: use link-specific if provided, otherwise null (inherit from template)
        mode: mode ?? null,
        allowFileUpload: allowFileUpload ?? false,
        maxFiles: maxFiles ?? DEFAULTS.MAX_FILES,
        maxFileSizeMb: maxFileSizeMb ?? DEFAULTS.MAX_FILE_SIZE_MB,
        allowedFileTypes: allowedFileTypes ?? [...DEFAULTS.ALLOWED_FILE_TYPES],
        // Voice settings: use link-specific if provided, otherwise null (inherit from template)
        enableVoiceOutput: enableVoiceOutput ?? null,
        voiceId: voiceId ?? null,
      },
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const fullUrl = `${frontendUrl}/interview/${link.token}`;

    return {
      success: true,
      data: {
        ...link,
        fullUrl,
      },
    };
  });

  // List links for template
  fastify.get<{
    Params: { id: string };
  }>('/api/templates/:id/links', {
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

    const links = await db.interviewLink.findMany({
      where: { templateId: request.params.id },
      include: {
        _count: {
          select: { sessions: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    return {
      success: true,
      data: links.map((link) => ({
        ...link,
        fullUrl: `${frontendUrl}/interview/${link.token}`,
        sessionCount: link._count.sessions,
      })),
    };
  });

  // Revoke/delete link
  fastify.delete<{
    Params: { id: string };
  }>('/api/links/:id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const link = await db.interviewLink.findFirst({
      where: { id: request.params.id },
      include: {
        template: true,
      },
    });

    if (!link || link.template.ownerId !== request.user!.id) {
      return reply.status(404).send({ success: false, error: 'Link not found' });
    }

    // Soft delete by deactivating
    await db.interviewLink.update({
      where: { id: request.params.id },
      data: { isActive: false },
    });

    return { success: true };
  });

  // Toggle link active status
  fastify.patch<{
    Params: { id: string };
    Body: { isActive: boolean };
  }>('/api/links/:id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const link = await db.interviewLink.findFirst({
      where: { id: request.params.id },
      include: {
        template: true,
      },
    });

    if (!link || link.template.ownerId !== request.user!.id) {
      return reply.status(404).send({ success: false, error: 'Link not found' });
    }

    const updated = await db.interviewLink.update({
      where: { id: request.params.id },
      data: { isActive: request.body.isActive },
    });

    return {
      success: true,
      data: updated,
    };
  });
}
