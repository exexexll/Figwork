import type { FastifyInstance } from 'fastify';
import { Webhook } from 'svix';
import { db } from '@figwork/db';
import { requireAuth } from '../lib/clerk.js';
import { generateCsrfToken, refreshCsrfToken } from '../lib/csrf.js';

export async function registerAuthRoutes(fastify: FastifyInstance): Promise<void> {
  // Get CSRF token for authenticated user
  fastify.get('/api/auth/csrf', {
    preHandler: requireAuth,
  }, async (request) => {
    const token = await generateCsrfToken(request.user!.id);
    return { success: true, data: { csrfToken: token } };
  });

  // Refresh CSRF token
  fastify.post('/api/auth/csrf/refresh', {
    preHandler: requireAuth,
  }, async (request) => {
    const token = await refreshCsrfToken(request.user!.id);
    return { success: true, data: { csrfToken: token } };
  });

  // Clerk webhook for user sync
  fastify.post('/api/auth/webhook', {
    config: {
      rawBody: true,
    },
  }, async (request, reply) => {
    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
      fastify.log.error('CLERK_WEBHOOK_SECRET is not set');
      return reply.status(500).send({ error: 'Webhook not configured' });
    }

    const svix_id = request.headers['svix-id'] as string;
    const svix_timestamp = request.headers['svix-timestamp'] as string;
    const svix_signature = request.headers['svix-signature'] as string;

    if (!svix_id || !svix_timestamp || !svix_signature) {
      return reply.status(400).send({ error: 'Missing svix headers' });
    }

    const body = JSON.stringify(request.body);

    let evt: any;
    try {
      const wh = new Webhook(webhookSecret);
      evt = wh.verify(body, {
        'svix-id': svix_id,
        'svix-timestamp': svix_timestamp,
        'svix-signature': svix_signature,
      });
    } catch (err) {
      fastify.log.error(err, 'Webhook verification failed');
      return reply.status(400).send({ error: 'Invalid webhook signature' });
    }

    const eventType = evt.type;
    fastify.log.info(`Received Clerk webhook: ${eventType}`);

    try {
      switch (eventType) {
        case 'user.created':
        case 'user.updated': {
          const { id, email_addresses, first_name, last_name } = evt.data;
          const primaryEmail = email_addresses?.[0]?.email_address || '';
          const name = `${first_name || ''} ${last_name || ''}`.trim() || null;

          await db.user.upsert({
            where: { clerkId: id },
            create: {
              clerkId: id,
              email: primaryEmail,
              name,
            },
            update: {
              email: primaryEmail,
              name,
            },
          });

          fastify.log.info(`User ${id} synced`);
          break;
        }

        case 'user.deleted': {
          const { id } = evt.data;
          await db.user.delete({
            where: { clerkId: id },
          }).catch(() => {
            // User may not exist
          });

          fastify.log.info(`User ${id} deleted`);
          break;
        }

        default:
          fastify.log.info(`Unhandled webhook event: ${eventType}`);
      }

      return { received: true };
    } catch (error) {
      fastify.log.error(error, 'Webhook processing failed');
      return reply.status(500).send({ error: 'Webhook processing failed' });
    }
  });
}
