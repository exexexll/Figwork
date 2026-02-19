import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { db } from '@figwork/db';
import { SessionCache } from '../lib/session-cache.js';
import { startSessionTimer, clearSessionTimer, isSessionTimeExpired } from '../lib/timer-manager.js';
import { processOrchestrator, endInterviewSession } from '../orchestrator/index.js';
import { WS_CLIENT_EVENTS, WS_SERVER_EVENTS } from '@figwork/shared';
import { setupMarketplaceNamespace, setIOInstance } from './marketplace.js';

let io: Server | null = null;

export function getIO(): Server | null {
  return io;
}

export async function setupWebSocket(fastify: FastifyInstance): Promise<void> {
  io = new Server(fastify.server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true,
    },
    transports: ['websocket'], // Skip polling for lower latency
    pingTimeout: 30000, // 30 seconds before disconnecting
    pingInterval: 10000, // Ping every 10 seconds
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes for reconnection
      skipMiddlewares: true,
    },
  });

  io.on('connection', async (socket) => {
    const { sessionToken } = socket.handshake.auth;

    if (!sessionToken) {
      socket.emit(WS_SERVER_EVENTS.ERROR, { message: 'Missing session token' });
      socket.disconnect();
      return;
    }

    // Validate session from cache
    const session = await SessionCache.get(sessionToken);
    if (!session) {
      socket.emit(WS_SERVER_EVENTS.ERROR, { message: 'Invalid session' });
      socket.disconnect();
      return;
    }

    // Check token expiration from database
    const dbSession = await db.interviewSession.findUnique({
      where: { sessionToken },
      select: { tokenExpiresAt: true, status: true },
    });

    if (!dbSession || dbSession.tokenExpiresAt < new Date()) {
      socket.emit(WS_SERVER_EVENTS.ERROR, { message: 'Session expired' });
      socket.disconnect();
      return;
    }

    if (dbSession.status === 'completed' || dbSession.status === 'abandoned') {
      socket.emit(WS_SERVER_EVENTS.ERROR, { message: 'Session already ended' });
      socket.disconnect();
      return;
    }

    // Join session room for broadcasts
    socket.join(`session:${sessionToken}`);
    fastify.log.info(`Client connected to session: ${sessionToken}`);

    // Get template for time limit
    const template = await db.interviewTemplate.findUnique({
      where: { id: session.templateId },
      select: { timeLimitMinutes: true },
    });

    const timeLimitMinutes = template?.timeLimitMinutes || 30;

    // Start server-side timer enforcement
    await startSessionTimer(
      sessionToken,
      session.sessionId,
      timeLimitMinutes,
      // Time warning callback (5 minutes remaining)
      () => {
        socket.emit(WS_SERVER_EVENTS.TIME_WARNING, { remainingMs: 5 * 60 * 1000 });
      },
      // Time expired callback
      async () => {
        fastify.log.info(`Session time expired: ${sessionToken}`);
        socket.emit(WS_SERVER_EVENTS.TIME_EXPIRED);
        await endInterviewSession(socket, sessionToken);
      }
    );

    // Send session started event
    socket.emit(WS_SERVER_EVENTS.SESSION_STARTED, {
      sessionId: session.sessionId,
      currentQuestionIndex: session.currentQuestionIndex,
      totalQuestions: session.questions.length,
      timeLimitMinutes,
    });

    // Get full template for voice settings and mode
    const fullTemplate = await db.interviewTemplate.findUnique({
      where: { id: session.templateId },
      select: { 
        enableVoiceOutput: true, 
        voiceIntroMessage: true,
        timeLimitMinutes: true,
        name: true,
        mode: true,
        inquiryWelcome: true,
        inquiryGoal: true,
      },
    });

    const { MESSAGE_TYPE, TEMPLATE_MODE } = await import('@figwork/shared');
    const isInquiryMode = fullTemplate?.mode === TEMPLATE_MODE.INQUIRY;

    // INQUIRY MODE: Send welcome message only, no questions
    if (isInquiryMode) {
      // Default welcome for inquiry mode
      const DEFAULT_INQUIRY_WELCOME = `Hello! Welcome to ${fullTemplate?.name || 'our assistant'}. I'm here to help answer your questions and assist you with any information you need. How can I help you today?`;
      
      const welcomeText = fullTemplate?.inquiryWelcome || DEFAULT_INQUIRY_WELCOME;
      
      fastify.log.info(`INQUIRY MODE - Sending welcome: "${welcomeText.slice(0, 50)}..."`);
      
      // Signal streaming start
      socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_START);
      socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_TOKEN, welcomeText);
      socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_END, welcomeText);

      // Add to session cache
      await SessionCache.addMessage(sessionToken, 'ai', welcomeText);

      // Persist to database
      await db.transcriptMessage.create({
        data: {
          sessionId: session.sessionId,
          questionId: null, // No question for inquiry mode
          role: 'ai',
          content: welcomeText,
          messageType: MESSAGE_TYPE.META,
          timestampMs: BigInt(Date.now()),
        },
      });

      fastify.log.info(`Inquiry session started: ${sessionToken}`);
    }
    // APPLICATION MODE: Send intro (if voice enabled), then first question
    else if (session.questions.length > 0) {
      const firstQuestion = session.questions[0];
      
      // If voice mode is enabled, send intro and WAIT for user response before first question
      if (fullTemplate?.enableVoiceOutput) {
        // DEFAULT intro message for voice mode - invites user to ask questions first
        const DEFAULT_VOICE_INTRO = `Hello! Welcome to your ${fullTemplate?.name || 'application'}. I'm here to learn more about you through a conversation. Before we begin, do you have any questions about the process? If not, just let me know you're ready and we'll get started.`;
        
        const introText = fullTemplate.voiceIntroMessage || DEFAULT_VOICE_INTRO;
        
        fastify.log.info(`SENDING VOICE INTRO MESSAGE (waiting for user response): "${introText.slice(0, 50)}..."`);
        
        // Signal streaming start
        socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_START);
        socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_TOKEN, introText);
        socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_END, introText);

        // Add to session cache (as system/intro message, not as question)
        await SessionCache.addMessage(sessionToken, 'ai', introText);

        // Persist to database
        await db.transcriptMessage.create({
          data: {
            sessionId: session.sessionId,
            questionId: firstQuestion.id,
            role: 'ai',
            content: introText,
            messageType: MESSAGE_TYPE.META,
            timestampMs: BigInt(Date.now()),
          },
        });

        // Mark session as waiting for intro response
        await SessionCache.update(sessionToken, { awaitingIntroResponse: true });

        fastify.log.info(`Voice intro sent, waiting for user response before first question: ${sessionToken}`);
        // DON'T send first question yet - wait for user to respond
      } else {
        // Text mode - send the question immediately
        const questionText = firstQuestion.text;
        
        // LOG: Verify exact text being sent
        fastify.log.info(`SENDING FIRST QUESTION DIRECTLY (no LLM): "${questionText}"`);
        
        // Signal streaming start
        socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_START);
        
        // Send the exact question text directly
        socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_TOKEN, questionText);
        
        // Signal streaming end
        socket.emit(WS_SERVER_EVENTS.AI_MESSAGE_END, questionText);

        // Add to session cache
        await SessionCache.addMessage(sessionToken, 'ai', questionText);

        // Persist to database
        await db.transcriptMessage.create({
          data: {
            sessionId: session.sessionId,
            questionId: firstQuestion.id,
            role: 'ai',
            content: questionText,
            messageType: MESSAGE_TYPE.FIXED_QUESTION,
            timestampMs: BigInt(Date.now()),
          },
        });

        fastify.log.info(`First question asked for session: ${sessionToken}`);
      }
    }

    // Handle normal transcript completion
    socket.on(WS_CLIENT_EVENTS.CANDIDATE_TRANSCRIPT_FINAL, async (data) => {
      const { transcript, timestamp, isAddition } = data;
      fastify.log.debug(`Received final transcript (isAddition=${isAddition}): ${transcript.slice(0, 100)}...`);

      await handleCandidateInput(socket, sessionToken, transcript, false, isAddition);
    });

    // Handle interrupt (user clicked X to finish early)
    socket.on(WS_CLIENT_EVENTS.CANDIDATE_INTERRUPT, async (data) => {
      const { transcript, timestamp, wasInterrupted } = data;
      fastify.log.debug(`Received interrupt with transcript: ${transcript.slice(0, 100)}...`);

      // Treat partial transcript as complete input
      await handleCandidateInput(socket, sessionToken, transcript, wasInterrupted);
    });

    // Handle partial transcripts (for state tracking, not processing)
    socket.on(WS_CLIENT_EVENTS.CANDIDATE_TRANSCRIPT_PARTIAL, async (data) => {
      const { partial } = data;
      // Store for potential interrupt
      await SessionCache.update(sessionToken, { pendingPartial: partial });
    });

    // Handle end interview
    socket.on(WS_CLIENT_EVENTS.END_INTERVIEW, async () => {
      fastify.log.info(`Interview ended by user: ${sessionToken}`);
      await clearSessionTimer(sessionToken);
      await endInterviewSession(socket, sessionToken);
    });

    // Handle mic muted
    socket.on(WS_CLIENT_EVENTS.MIC_MUTED, async (data) => {
      const { muted } = data;
      fastify.log.debug(`Mic muted: ${muted}`);
    });

    // Handle client ping for heartbeat
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // Handle disconnect
    socket.on('disconnect', async (reason) => {
      fastify.log.info(`Client disconnected from session ${sessionToken}: ${reason}`);

      // Mark session as potentially abandoned if not completed
      const currentSession = await SessionCache.get(sessionToken);
      if (currentSession?.status === 'in_progress') {
        await db.interviewSession.update({
          where: { sessionToken },
          data: {
            status: 'abandoned',
            lastActivityAt: new Date(),
          },
        });
        await SessionCache.updateStatus(sessionToken, 'abandoned');
        await clearSessionTimer(sessionToken);
      }
    });
  });

  // Setup marketplace namespace for gig marketplace events
  setupMarketplaceNamespace(io);
  setIOInstance(io);

  fastify.log.info('WebSocket server initialized');
}

async function handleCandidateInput(
  socket: any,
  sessionToken: string,
  transcript: string,
  wasInterrupted: boolean,
  isAddition: boolean = false
): Promise<void> {
  const session = await SessionCache.get(sessionToken);
  if (!session) return;

  // **SECURITY: Check if session time has expired**
  const timeExpired = await isSessionTimeExpired(sessionToken);
  if (timeExpired) {
    socket.emit(WS_SERVER_EVENTS.TIME_EXPIRED);
    await endInterviewSession(socket, sessionToken);
    return;
  }

  // Update last activity
  await db.interviewSession.update({
    where: { sessionToken },
    data: { lastActivityAt: new Date() },
  });

  // Clean up the transcript - remove the [Addition to previous response] prefix if present
  let cleanTranscript = transcript;
  const additionPrefix = '[Addition to previous response]';
  if (transcript.startsWith(additionPrefix)) {
    cleanTranscript = transcript.slice(additionPrefix.length).trim();
    isAddition = true;
  }

  const currentQuestion = session.questions[session.currentQuestionIndex];

  if (isAddition) {
    // Find the most recent candidate message for this question and append to it
    const lastCandidateMessage = await db.transcriptMessage.findFirst({
      where: {
        sessionId: session.sessionId,
        questionId: currentQuestion?.id,
        role: 'candidate',
      },
      orderBy: { timestampMs: 'desc' },
    });

    if (lastCandidateMessage) {
      // Update the existing message by appending
      const updatedContent = `${lastCandidateMessage.content} ${cleanTranscript}`;
      await db.transcriptMessage.update({
        where: { id: lastCandidateMessage.id },
        data: { content: updatedContent },
      });

      // Update session cache as well
      await SessionCache.updateLastMessage(sessionToken, 'candidate', updatedContent);
      
      console.log(`Appended addition to previous message. New content length: ${updatedContent.length}`);
    } else {
      // No previous message found, create new one
      await db.transcriptMessage.create({
        data: {
          sessionId: session.sessionId,
          questionId: currentQuestion?.id || null,
          role: 'candidate',
          content: cleanTranscript,
          messageType: 'answer',
          timestampMs: BigInt(Date.now()),
        },
      });
      await SessionCache.addMessage(sessionToken, 'candidate', cleanTranscript);
    }

    // Don't process through orchestrator for additions - just acknowledge
    socket.emit(WS_SERVER_EVENTS.MESSAGE_RECEIVED, { 
      message: 'Addition recorded',
      isAddition: true,
    });
    return;
  }

  // Normal message handling
  await SessionCache.addMessage(sessionToken, 'candidate', cleanTranscript);

  await db.transcriptMessage.create({
    data: {
      sessionId: session.sessionId,
      questionId: currentQuestion?.id || null,
      role: 'candidate',
      content: cleanTranscript,
      messageType: 'answer',
      timestampMs: BigInt(Date.now()),
    },
  });

  // Process through orchestrator
  await processOrchestrator(socket, sessionToken);
}

// Broadcast to all clients in a session
export function broadcastToSession(sessionToken: string, event: string, data: any): void {
  if (io) {
    io.to(`session:${sessionToken}`).emit(event, data);
  }
}
