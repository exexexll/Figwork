import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { db } from '@figwork/db';
import { getRedis } from './lib/redis.js';
import { validateCriticalEnvironment, logServiceStatus } from './lib/env-config.js';

// Validate critical env vars before anything else
validateCriticalEnvironment();

// Import routes
import { registerAuthRoutes } from './routes/auth.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerQuestionRoutes } from './routes/questions.js';
import { registerLinkRoutes } from './routes/links.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerKnowledgeRoutes } from './routes/knowledge.js';
import { registerInterviewRoutes } from './routes/interview.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { studentRoutes } from './routes/students.js';
import { companyRoutes } from './routes/companies.js';
import { workUnitRoutes } from './routes/workunits.js';
import { executionRoutes } from './routes/executions.js';
import { powRoutes } from './routes/pow.js';
import { paymentRoutes } from './routes/payments.js';
import adminRoutes from './routes/admin.js';
import onboardingConfigRoutes from './routes/onboarding-config.js';
import agentRoutes from './routes/agent.js';
import { setupWebSocket } from './websocket/index.js';

// Import workers
import { startKnowledgeWorker } from './workers/knowledge.worker.js';
import { startCandidateFileWorker } from './workers/candidate-file.worker.js';
import { startPostProcessWorker } from './workers/post-process.worker.js';
import { startCleanupWorker } from './workers/cleanup.worker.js';
import { startPDFWorker } from './workers/pdf.worker.js';
import { startPOWWorker } from './workers/pow.worker.js';
import { startQAWorker } from './workers/qa.worker.js';
import { startPayoutWorker } from './workers/payout.worker.js';
import { startNotificationWorker } from './workers/notification.worker.js';
import { startInvoiceWorker } from './workers/invoice.worker.js';
import { startDefectAnalysisWorker } from './workers/defect-analysis.worker.js';

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport: process.env.NODE_ENV !== 'production' ? {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    } : undefined,
  },
});

// Register plugins
await fastify.register(sensible);

await fastify.register(cors, {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
});

// Rate limiting with Redis store
await fastify.register(rateLimit, {
  global: true,
  max: 100, // 100 requests per minute by default
  timeWindow: '1 minute',
  redis: getRedis(),
  keyGenerator: (request: { user?: { id: string }; ip: string }) => {
    // Use user ID if authenticated, otherwise IP
    return request.user?.id || request.ip;
  },
  skipOnError: true, // Don't fail if Redis is down
  allowList: ['/health'], // Skip rate limiting for health checks
});

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  
  // Handle validation errors
  if (error.validation) {
    return reply.status(400).send({
      success: false,
      error: 'Validation failed',
      details: error.validation,
    });
  }
  
  // Handle known errors
  if (error.statusCode) {
    return reply.status(error.statusCode).send({
      success: false,
      error: error.message,
    });
  }
  
  // Handle unknown errors
  return reply.status(500).send({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message,
  });
});

// Add security headers
fastify.addHook('onSend', async (request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'microphone=(self), camera=()');
});

// CSRF protection
// NOTE: Since we use Bearer token auth (not cookies), CSRF attacks
// are mitigated at the protocol level — browsers don't auto-attach
// Authorization headers on cross-origin requests. The CSRF token
// provides defense-in-depth for routes that also set cookies.
// Validation runs inside route-level preHandlers AFTER auth sets request.user.
import { validateCsrf } from './lib/csrf.js';

// Register CSRF validation as an onRequest hook that runs AFTER auth
// It checks for request.user which is set by route-level auth middleware
fastify.addHook('onSend', async (request, reply) => {
  // Inject CSRF token in response header for authenticated users  
  if ((request as any).user?.id && reply.statusCode < 400) {
    try {
      const { generateCsrfToken } = await import('./lib/csrf.js');
      const token = await generateCsrfToken((request as any).user.id);
      reply.header('x-csrf-token', token);
    } catch {
      // Non-critical — don't fail the request
    }
  }
});

// Request logging for debugging
fastify.addHook('onRequest', async (request) => {
  request.log.info({
    method: request.method,
    url: request.url,
    userId: request.user?.id,
  }, 'Incoming request');
});

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Cloudinary test endpoint (dev only)
if (process.env.NODE_ENV !== 'production') {
  fastify.get('/api/test/cloudinary', async () => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    
    return {
      configured: !!(cloudName && apiKey && apiSecret),
      cloudName: cloudName || 'NOT SET',
      apiKeySet: !!apiKey,
      apiSecretSet: !!apiSecret,
    };
  });
}

// 404 handler
fastify.setNotFoundHandler((request, reply) => {
  reply.status(404).send({
    success: false,
    error: 'Route not found',
    path: request.url,
  });
});

// Register routes
await registerAuthRoutes(fastify);
await registerTemplateRoutes(fastify);
await registerQuestionRoutes(fastify);
await registerLinkRoutes(fastify);
await registerSessionRoutes(fastify);
await registerKnowledgeRoutes(fastify);
await registerInterviewRoutes(fastify);
await registerWebhookRoutes(fastify);

// Marketplace routes
await fastify.register(studentRoutes, { prefix: '/api/students' });
await fastify.register(companyRoutes, { prefix: '/api/companies' });
await fastify.register(workUnitRoutes, { prefix: '/api/workunits' });
await fastify.register(executionRoutes, { prefix: '/api/executions' });
await fastify.register(powRoutes, { prefix: '/api/pow' });
await fastify.register(paymentRoutes, { prefix: '/api/payments' });
await fastify.register(adminRoutes, { prefix: '/api/admin' });
await fastify.register(agentRoutes, { prefix: '/api/agent' });
await fastify.register(onboardingConfigRoutes, { prefix: '/api/onboarding-config' });

// Public marketplace search (no auth required)
fastify.get('/api/marketplace/search', async (request, reply) => {
  const { q, category, minTier, minPrice, maxPrice, sort, limit: limitStr = '20', offset: offsetStr = '0' } = request.query as Record<string, string>;
  
  // Sanitize and validate numeric inputs
  const limit = Math.min(Math.max(1, parseInt(limitStr) || 20), 50);
  const offset = Math.max(0, parseInt(offsetStr) || 0);

  const where: any = {
    status: 'active',
  };

  // Full-text search on title and spec — sanitize input
  if (q && q.trim()) {
    // Strip special chars that could cause regex issues, limit length
    const sanitizedQuery = q.trim().substring(0, 200).replace(/[%_\\]/g, '');
    if (sanitizedQuery.length >= 2) {
      where.OR = [
        { title: { contains: sanitizedQuery, mode: 'insensitive' } },
        { spec: { contains: sanitizedQuery, mode: 'insensitive' } },
        { category: { contains: sanitizedQuery, mode: 'insensitive' } },
      ];
    }
  }

  if (category) {
    where.category = category;
  }

  if (minTier) {
    const tierOrder: Record<string, string[]> = {
      novice: ['novice', 'pro', 'elite'],
      pro: ['pro', 'elite'],
      elite: ['elite'],
    };
    where.minTier = { in: tierOrder[minTier] || ['novice', 'pro', 'elite'] };
  }

  if (minPrice || maxPrice) {
    where.priceInCents = {};
    if (minPrice) where.priceInCents.gte = parseInt(minPrice) * 100;
    if (maxPrice) where.priceInCents.lte = parseInt(maxPrice) * 100;
  }

  // Determine sort order
  let orderBy: any = { publishedAt: 'desc' };
  if (sort === 'price_asc') orderBy = { priceInCents: 'asc' };
  else if (sort === 'price_desc') orderBy = { priceInCents: 'desc' };
  else if (sort === 'deadline') orderBy = { deadlineHours: 'asc' };

  const [tasks, total] = await Promise.all([
    db.workUnit.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
      select: {
        id: true,
        title: true,
        spec: true,
        category: true,
        priceInCents: true,
        deadlineHours: true,
        requiredSkills: true,
        minTier: true,
        complexityScore: true,
        hasExamples: true,
        publishedAt: true,
        company: {
          select: { companyName: true },
        },
      },
    }),
    db.workUnit.count({ where }),
  ]);

  return reply.send({
    tasks: tasks.map(t => ({
      ...t,
      companyName: t.company.companyName,
      company: undefined,
    })),
    total,
    limit,
    offset,
  });
});

// Get unique categories for search filters
fastify.get('/api/marketplace/categories', async (request, reply) => {
  const categories = await db.workUnit.findMany({
    where: { status: 'active' },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });

  return reply.send({
    categories: categories.map(c => c.category),
  });
});

// Setup WebSocket
await setupWebSocket(fastify);

// Start workers
startKnowledgeWorker();
startCandidateFileWorker();
startPostProcessWorker();
startCleanupWorker();
startPDFWorker();
startPOWWorker();
startQAWorker();
startPayoutWorker();
startNotificationWorker();
startInvoiceWorker();
startDefectAnalysisWorker();

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3001', 10);
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });
    fastify.log.info(`Server listening on ${host}:${port}`);

    // Verify database connection
    await db.$connect();
    fastify.log.info('Database connected');

    // Log service configuration status
    logServiceStatus();
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  fastify.log.info('Shutting down gracefully...');
  await fastify.close();
  await db.$disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
