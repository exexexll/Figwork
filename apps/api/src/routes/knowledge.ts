import type { FastifyInstance } from 'fastify';
import { db } from '@figwork/db';
import { requireAuth } from '../lib/clerk.js';
import { deleteFile } from '../lib/cloudinary.js';
import { knowledgeQueue } from '../lib/queues.js';
import { CLOUDINARY_CONFIG } from '@figwork/shared';
import { v4 as uuidv4 } from 'uuid';

export async function registerKnowledgeRoutes(fastify: FastifyInstance): Promise<void> {
  // Upload knowledge file
  fastify.post<{
    Params: { id: string };
    Body: {
      filename: string;
      fileType: string;
    };
  }>('/api/templates/:id/knowledge', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['filename', 'fileType'],
        properties: {
          filename: { type: 'string', minLength: 1 },
          fileType: { type: 'string', enum: ['pdf', 'docx', 'txt', 'md'] },
        },
      },
    },
  }, async (request, reply) => {
    // Check if Cloudinary is configured
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    if (!cloudName) {
      return reply.status(500).send({ success: false, error: 'File upload not configured' });
    }

    const template = await db.interviewTemplate.findFirst({
      where: {
        id: request.params.id,
        ownerId: request.user!.id,
      },
    });

    if (!template) {
      return reply.status(404).send({ success: false, error: 'Template not found' });
    }

    const { filename, fileType } = request.body;
    const fileId = uuidv4();

    // Create file record
    const knowledgeFile = await db.knowledgeFile.create({
      data: {
        id: fileId,
        ownerId: request.user!.id,
        templateId: request.params.id,
        filename,
        fileType,
        status: 'pending',
      },
    });

    // Generate unsigned upload params (uses preset configured in Cloudinary dashboard)
    const fullPublicId = `${CLOUDINARY_CONFIG.KNOWLEDGE_FOLDER}/${fileId}`;
    
    // Use 'auto' resource type which handles all file types
    const uploadParams = {
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
      publicId: fullPublicId,
      uploadPreset: 'Figwork_interviews', // Must be configured in Cloudinary dashboard
      cloudName: cloudName!,
      folder: CLOUDINARY_CONFIG.KNOWLEDGE_FOLDER,
      resourceType: 'auto',
    };

    fastify.log.info({ uploadParams }, 'Generated upload params for knowledge file');

    return {
      success: true,
      data: {
        file: knowledgeFile,
        upload: uploadParams,
      },
    };
  });

  // Confirm upload and start processing
  fastify.post<{
    Params: { id: string };
    Body: {
      cloudinaryUrl: string;
      cloudinaryPublicId: string;
    };
  }>('/api/knowledge/:id/confirm', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['cloudinaryUrl', 'cloudinaryPublicId'],
        properties: {
          cloudinaryUrl: { type: 'string', format: 'uri' },
          cloudinaryPublicId: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const file = await db.knowledgeFile.findFirst({
      where: {
        id: request.params.id,
        ownerId: request.user!.id,
      },
    });

    if (!file) {
      return reply.status(404).send({ success: false, error: 'File not found' });
    }

    // Update file with Cloudinary info
    await db.knowledgeFile.update({
      where: { id: file.id },
      data: {
        cloudinaryUrl: request.body.cloudinaryUrl,
        cloudinaryPublicId: request.body.cloudinaryPublicId,
        status: 'processing',
      },
    });

    // Queue for processing
    await knowledgeQueue.add('process-knowledge', {
      fileId: file.id,
      cloudinaryUrl: request.body.cloudinaryUrl,
      fileType: file.fileType,
      ownerId: file.ownerId,
      templateId: file.templateId,
    });

    return {
      success: true,
      data: { fileId: file.id, status: 'processing' },
    };
  });

  // List knowledge files for template
  fastify.get<{
    Params: { id: string };
  }>('/api/templates/:id/knowledge', {
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

    const files = await db.knowledgeFile.findMany({
      where: { templateId: request.params.id },
      include: {
        _count: {
          select: { chunks: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: files.map((f) => ({
        ...f,
        chunkCount: f._count.chunks,
      })),
    };
  });

  // Delete knowledge file
  fastify.delete<{
    Params: { id: string };
  }>('/api/knowledge/:id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const file = await db.knowledgeFile.findFirst({
      where: {
        id: request.params.id,
        ownerId: request.user!.id,
      },
    });

    if (!file) {
      return reply.status(404).send({ success: false, error: 'File not found' });
    }

    // Delete from Cloudinary
    if (file.cloudinaryPublicId) {
      await deleteFile(file.cloudinaryPublicId).catch((err) => {
        fastify.log.warn(err, 'Failed to delete file from Cloudinary');
      });
    }

    // Delete from database (cascades to chunks)
    await db.knowledgeFile.delete({
      where: { id: file.id },
    });

    return { success: true };
  });
}
