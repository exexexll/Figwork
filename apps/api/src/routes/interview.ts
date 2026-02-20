import type { FastifyInstance } from 'fastify';
import { db } from '@figwork/db';
import { generateSecureToken, CLOUDINARY_CONFIG, DEFAULTS } from '@figwork/shared';
// Cloudinary upload now uses unsigned uploads with preset
import { candidateFileQueue } from '../lib/queues.js';
import { initializeSessionCache } from '../lib/session-cache.js';
import { withLock } from '../lib/distributed-lock.js';
import { v4 as uuidv4 } from 'uuid';

// Helper to resolve and validate a link
async function resolveLink(token: string) {
  const link = await db.interviewLink.findUnique({
    where: { token, isActive: true },
    include: {
      template: {
        include: {
          questions: {
            orderBy: { orderIndex: 'asc' },
          },
        },
      },
    },
  });

  if (!link) return null;
  if (link.expiresAt && link.expiresAt < new Date()) return { expired: true };
  if (link.linkType === 'one_time' && link.useCount >= 1) return { used: true };
  if (link.maxUses && link.useCount >= link.maxUses) return { used: true };

  return link;
}

export async function registerInterviewRoutes(fastify: FastifyInstance): Promise<void> {
  // Resolve interview link (public)
  fastify.get<{
    Params: { token: string };
  }>('/api/interview/resolve/:token', async (request, reply) => {
    const result = await resolveLink(request.params.token);

    if (!result) {
      return reply.status(404).send({
        success: false,
        valid: false,
        error: 'Invalid interview link',
      });
    }

    if ('expired' in result) {
      return {
        success: true,
        valid: false,
        expired: true,
      };
    }

    if ('used' in result) {
      return {
        success: true,
        valid: false,
        used: true,
      };
    }

    // Determine settings: link-specific overrides template defaults
    const enableVoiceOutput = result.enableVoiceOutput ?? result.template.enableVoiceOutput;
    const voiceId = result.voiceId ?? result.template.voiceId;
    const mode = result.mode ?? result.template.mode;

    return {
      success: true,
      valid: true,
      templateName: result.template.name,
      // Mode determines application vs inquiry experience
      mode,
      questionCount: result.template.questions.length,
      // Inquiry mode settings
      inquiryWelcome: result.template.inquiryWelcome,
      inquiryGoal: result.template.inquiryGoal,
      // File upload settings
      allowFileUpload: result.allowFileUpload,
      maxFiles: result.maxFiles,
      maxFileSizeMb: result.maxFileSizeMb,
      allowedFileTypes: result.allowedFileTypes,
      // Voice-to-voice settings
      enableVoiceOutput,
      voiceId,
      voiceIntroMessage: result.template.voiceIntroMessage,
      // Time limit (may be optional in inquiry mode)
      timeLimitMinutes: result.template.timeLimitMinutes,
    };
  });

  // Start interview session (public)
  fastify.post<{
    Params: { token: string };
  }>('/api/interview/start/:token', async (request, reply) => {
    const linkToken = request.params.token;

    // Re-check link validity (will be checked again inside lock)
    const initialResult = await resolveLink(linkToken);
    if (!initialResult || 'expired' in initialResult || 'used' in initialResult) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid or expired link',
      });
    }

    const link = initialResult;
    const sessionToken = generateSecureToken();
    
    // Calculate token expiration
    const tokenExpiresAt = new Date(Date.now() + DEFAULTS.SESSION_TOKEN_TTL_HOURS * 60 * 60 * 1000);

    // **DISTRIBUTED LOCK: Prevent race condition on one-time links**
    const lockResult = await withLock(
      `link:${linkToken}`,
      async () => {
        // Double-check link validity inside lock
        const recheckResult = await resolveLink(linkToken);
        if (!recheckResult || 'expired' in recheckResult || 'used' in recheckResult) {
          return { error: 'Invalid or expired link' as const };
        }

        // **TRANSACTION: Create session and increment use count atomically**
        const session = await db.$transaction(async (tx) => {
          // Create session
          const newSession = await tx.interviewSession.create({
            data: {
              linkId: link.id,
              templateId: link.templateId,
              sessionToken,
              status: 'in_progress',
              startedAt: new Date(),
              lastActivityAt: new Date(),
              // tokenExpiresAt has a default in DB schema
            },
            include: {
              template: {
                include: {
                  questions: {
                    orderBy: { orderIndex: 'asc' },
                  },
                },
              },
            },
          });

          // Increment use count atomically
          await tx.interviewLink.update({
            where: { id: link.id },
            data: { useCount: { increment: 1 } },
          });

          return newSession;
        });

        return { session };
      },
      { ttlMs: 10000, retryCount: 3, retryDelayMs: 200 }
    );

    if (!lockResult.success) {
      return reply.status(429).send({
        success: false,
        error: 'Link is being used. Please try again in a moment.',
      });
    }

    if ('error' in lockResult.result) {
      return reply.status(400).send({
        success: false,
        error: lockResult.result.error,
      });
    }

    const { session } = lockResult.result;

    // Initialize Redis cache
    await initializeSessionCache(sessionToken, session);

    // Generate ephemeral token for OpenAI Realtime
    // PRODUCTION: Replace with a short-lived ephemeral token from the
    // OpenAI Realtime API (POST /v1/realtime/sessions) instead of leaking the
    // full API key to the client. See: https://platform.openai.com/docs/guides/realtime
    const ephemeralToken = process.env.OPENAI_API_KEY || '';

    const firstQuestion = session.template.questions[0];
    
    // Determine settings: link-specific overrides template defaults
    const enableVoiceOutput = link.enableVoiceOutput ?? session.template.enableVoiceOutput;
    const voiceId = link.voiceId ?? session.template.voiceId;
    const mode = link.mode ?? session.template.mode;
    
    // For inquiry mode, use welcome message instead of first question
    const isInquiryMode = mode === 'inquiry';
    const initialMessage = isInquiryMode
      ? session.template.inquiryWelcome || 'Hello! How can I help you today?'
      : firstQuestion?.questionText || 'Hello! Let\'s begin the application.';

    return {
      success: true,
      data: {
        sessionToken,
        ephemeralToken,
        // Mode determines UI and flow
        mode,
        // Questions (only relevant for application mode)
        questions: session.template.questions.map((q: { id: string; questionText: string; orderIndex: number }) => ({
          id: q.id,
          text: q.questionText,
          orderIndex: q.orderIndex,
        })),
        firstQuestion: initialMessage,
        // Inquiry mode specific
        inquiryWelcome: session.template.inquiryWelcome,
        inquiryGoal: session.template.inquiryGoal,
        // Time limit (may be ignored in inquiry mode)
        timeLimitMinutes: session.template.timeLimitMinutes,
        // File upload settings
        allowFileUpload: link.allowFileUpload,
        maxFiles: link.maxFiles,
        maxFileSizeMb: link.maxFileSizeMb,
        allowedFileTypes: link.allowedFileTypes,
        // Voice-to-voice settings
        enableVoiceOutput,
        voiceId,
        voiceIntroMessage: session.template.voiceIntroMessage,
      },
    };
  });

  // Get signed upload URL for candidate file (public)
  fastify.post<{
    Params: { sessionToken: string };
  }>('/api/interview/:sessionToken/upload-url', async (request, reply) => {
    // Check if Cloudinary is configured
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    if (!cloudName) {
      return reply.status(500).send({ success: false, error: 'File upload not configured' });
    }

    const session = await db.interviewSession.findUnique({
      where: { sessionToken: request.params.sessionToken },
      include: {
        link: true,
        candidateFiles: true,
      },
    });

    if (!session) {
      return reply.status(404).send({ success: false, error: 'Session not found' });
    }

    if (!session.link.allowFileUpload) {
      return reply.status(403).send({ success: false, error: 'File upload not enabled' });
    }

    if (session.candidateFiles.length >= session.link.maxFiles) {
      return reply.status(400).send({ success: false, error: 'Maximum files reached' });
    }

    const fileId = uuidv4();
    const fullPublicId = `${CLOUDINARY_CONFIG.CANDIDATE_FILES_FOLDER}/${session.id}/${fileId}`;
    
    // Use 'auto' resource type which handles all file types
    const uploadParams = {
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
      publicId: fullPublicId,
      uploadPreset: 'Figwork_interviews', // Must be configured in Cloudinary dashboard
      cloudName: cloudName!,
      folder: CLOUDINARY_CONFIG.CANDIDATE_FILES_FOLDER,
      resourceType: 'auto',
    };

    fastify.log.info({ uploadParams }, 'Generated upload params for candidate file');

    return {
      success: true,
      data: uploadParams,
    };
  });

  // Register uploaded candidate file (public)
  fastify.post<{
    Params: { sessionToken: string };
    Body: {
      filename: string;
      fileType: string;
      fileSizeBytes?: number;
      cloudinaryPublicId: string;
      cloudinaryUrl: string;
    };
  }>('/api/interview/:sessionToken/files', {
    schema: {
      body: {
        type: 'object',
        required: ['filename', 'fileType', 'cloudinaryPublicId', 'cloudinaryUrl'],
        properties: {
          filename: { type: 'string', minLength: 1 },
          fileType: { type: 'string', minLength: 1 },
          fileSizeBytes: { type: 'number', minimum: 0 },
          cloudinaryPublicId: { type: 'string', minLength: 1 },
          cloudinaryUrl: { type: 'string', format: 'uri' },
        },
      },
    },
  }, async (request, reply) => {
    const session = await db.interviewSession.findUnique({
      where: { sessionToken: request.params.sessionToken },
      include: {
        link: true,
        candidateFiles: true,
      },
    });

    if (!session) {
      return reply.status(404).send({ success: false, error: 'Session not found' });
    }

    if (!session.link.allowFileUpload) {
      return reply.status(403).send({ success: false, error: 'File upload not enabled' });
    }

    const { filename, fileType, fileSizeBytes = 0, cloudinaryPublicId, cloudinaryUrl } = request.body;

    // Validate file type
    if (!session.link.allowedFileTypes.includes(fileType)) {
      return reply.status(400).send({ success: false, error: 'Invalid file type' });
    }

    // Validate file size (only if size is known)
    if (fileSizeBytes > 0 && fileSizeBytes > session.link.maxFileSizeMb * 1024 * 1024) {
      return reply.status(400).send({ success: false, error: 'File too large' });
    }

    // Create file record
    const file = await db.candidateFile.create({
      data: {
        sessionId: session.id,
        filename,
        fileType,
        fileSizeBytes: BigInt(fileSizeBytes || 0),
        cloudinaryPublicId,
        cloudinaryUrl,
        status: 'uploaded',
      },
    });

    // Queue for text extraction
    await candidateFileQueue.add('extract-text', {
      fileId: file.id,
      sessionToken: request.params.sessionToken,
      cloudinaryUrl,
      fileType,
    });

    return {
      success: true,
      data: {
        id: file.id,
        filename: file.filename,
        fileType: file.fileType,
        fileSizeBytes: Number(file.fileSizeBytes),
        cloudinaryPublicId: file.cloudinaryPublicId,
        cloudinaryUrl: file.cloudinaryUrl,
        status: file.status,
      },
    };
  });

  // Save audio recording (public endpoint)
  fastify.post<{
    Params: { sessionToken: string };
    Body: {
      audioUrl: string;
      audioPublicId: string;
    };
  }>('/api/interview/:sessionToken/audio', async (request, reply) => {
    const session = await db.interviewSession.findUnique({
      where: { sessionToken: request.params.sessionToken },
    });

    if (!session) {
      return reply.status(404).send({ success: false, error: 'Session not found' });
    }

    // Only allow updating if session is completed or in_progress
    if (!['completed', 'in_progress'].includes(session.status)) {
      return reply.status(400).send({ success: false, error: 'Cannot update audio for this session' });
    }

    await db.interviewSession.update({
      where: { sessionToken: request.params.sessionToken },
      data: {
        audioUrl: request.body.audioUrl,
        audioPublicId: request.body.audioPublicId,
      },
    });

    return { success: true };
  });
}
