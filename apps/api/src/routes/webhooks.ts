/**
 * Webhook routes for external service callbacks
 */

import type { FastifyInstance } from 'fastify';
import { db } from '@figwork/db';
import crypto from 'crypto';
import { verifyWebhookSignature as verifyDocuSignWebhook } from '../lib/docusign-service.js';

// Cloudinary notification signature verification
function verifyCloudinarySignature(
  body: string,
  timestamp: string,
  signature: string,
  apiSecret: string
): boolean {
  const expectedSignature = crypto
    .createHash('sha256')
    .update(`${body}${timestamp}${apiSecret}`)
    .digest('hex');
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

export async function registerWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Cloudinary upload notification webhook
   * Validates that uploaded files are legitimate and updates status
   */
  fastify.post('/api/webhooks/cloudinary', {
    config: {
      rawBody: true,
    },
  }, async (request, reply) => {
    const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET;
    
    if (!cloudinaryApiSecret) {
      fastify.log.error('CLOUDINARY_API_SECRET not configured');
      return reply.status(500).send({ error: 'Webhook not configured' });
    }

    // Verify signature if provided
    const signature = request.headers['x-cld-signature'] as string;
    const timestamp = request.headers['x-cld-timestamp'] as string;
    
    if (signature && timestamp) {
      const body = JSON.stringify(request.body);
      const isValid = verifyCloudinarySignature(body, timestamp, signature, cloudinaryApiSecret);
      
      if (!isValid) {
        fastify.log.warn('Invalid Cloudinary webhook signature');
        return reply.status(401).send({ error: 'Invalid signature' });
      }
    }

    const notification = request.body as any;
    
    // Handle different notification types
    switch (notification.notification_type) {
      case 'upload': {
        const { public_id, secure_url, format, bytes, resource_type, context } = notification;
        
        fastify.log.info(`Cloudinary upload confirmed: ${public_id}`);
        
        // Extract session/file context if available
        const sessionToken = context?.custom?.session_token;
        const fileType = context?.custom?.file_type;
        
        if (sessionToken && fileType === 'candidate_file') {
          // Update candidate file status
          await db.candidateFile.updateMany({
            where: {
              cloudinaryPublicId: public_id,
              status: 'pending',
            },
            data: {
              status: 'processing',
              cloudinaryUrl: secure_url,
              fileSizeBytes: bytes,
            },
          });
        } else if (fileType === 'knowledge_file') {
          // Update knowledge file status
          await db.knowledgeFile.updateMany({
            where: {
              cloudinaryPublicId: public_id,
              status: 'pending',
            },
            data: {
              status: 'processing',
              cloudinaryUrl: secure_url,
            },
          });
        }
        break;
      }

      case 'delete': {
        const { public_id } = notification;
        fastify.log.info(`Cloudinary delete confirmed: ${public_id}`);
        break;
      }

      case 'moderation': {
        // Handle moderation results (if using Cloudinary AI moderation)
        const { public_id, moderation_status, moderation_response } = notification;
        
        if (moderation_status === 'rejected') {
          fastify.log.warn(`File rejected by moderation: ${public_id}`);
          
          // Mark file as error
          await db.candidateFile.updateMany({
            where: { cloudinaryPublicId: public_id },
            data: { status: 'error' },
          });
          
          await db.knowledgeFile.updateMany({
            where: { cloudinaryPublicId: public_id },
            data: { status: 'error' },
          });
        }
        break;
      }

      default:
        fastify.log.info(`Unhandled Cloudinary notification type: ${notification.notification_type}`);
    }

    return { received: true };
  });

  /**
   * DocuSign Connect webhook
   * Receives envelope status updates (sent, delivered, completed, declined, voided)
   * Used to track contract signing status for student onboarding
   */
  fastify.post('/api/webhooks/docusign', {
    config: { rawBody: true },
  }, async (request, reply) => {
    // Verify HMAC signature if configured
    const signature = request.headers['x-docusign-signature-1'] as string;
    if (signature) {
      const rawBody = (request as any).rawBody || JSON.stringify(request.body);
      const isValid = verifyDocuSignWebhook(rawBody, signature);
      if (!isValid) {
        fastify.log.warn('Invalid DocuSign webhook signature');
        return reply.status(401).send({ error: 'Invalid signature' });
      }
    }

    const payload = request.body as any;

    // DocuSign Connect sends XML by default, but can be configured for JSON
    // We expect JSON configuration in DocuSign admin console
    const envelopeId = payload?.envelopeId || payload?.data?.envelopeId;
    const status = payload?.status || payload?.data?.envelopeSummary?.status;
    const recipients = payload?.data?.envelopeSummary?.recipients?.signers || [];

    if (!envelopeId) {
      fastify.log.warn('DocuSign webhook: missing envelopeId');
      return reply.status(400).send({ error: 'Missing envelopeId' });
    }

    fastify.log.info(`DocuSign webhook: envelope ${envelopeId} → ${status}`);

    switch (status?.toLowerCase()) {
      case 'completed': {
        // Contract fully signed — update student profile
        const student = await db.studentProfile.findFirst({
          where: { docusignEnvelopeId: envelopeId },
        });

        if (student) {
          await db.studentProfile.update({
            where: { id: student.id },
            data: {
              contractStatus: 'signed',
            },
          });
          fastify.log.info(`Contract signed for student ${student.id}`);

          // Record the signature in agreement_signatures if applicable
          const customFields = payload?.data?.envelopeSummary?.customFields?.textCustomFields || [];
          const agreementVersionField = customFields.find((f: any) => f.name === 'agreementVersion');
          
          if (agreementVersionField?.value) {
            // Find the matching legal agreement (use `any` cast for dynamic Prisma models)
            const agreement = await (db as any).legalAgreement.findFirst({
              where: { version: parseInt(agreementVersionField.value) || 1, status: 'active' },
            });

            if (agreement) {
              await (db as any).agreementSignature.upsert({
                where: {
                  agreementId_studentId: {
                    studentId: student.id,
                    agreementId: agreement.id,
                  },
                },
                create: {
                  studentId: student.id,
                  agreementId: agreement.id,
                  agreementVersion: agreement.version,
                  signedName: student.name || 'Unknown',
                  signedAt: new Date(),
                },
                update: {
                  signedAt: new Date(),
                },
              });
            }
          }
        }
        break;
      }

      case 'declined': {
        const declinedStudent = await db.studentProfile.findFirst({
          where: { docusignEnvelopeId: envelopeId },
        });

        if (declinedStudent) {
          await db.studentProfile.update({
            where: { id: declinedStudent.id },
            data: { contractStatus: 'declined' },
          });
          fastify.log.warn(`Contract declined by student ${declinedStudent.id}`);
        }
        break;
      }

      case 'voided': {
        const voidedStudent = await db.studentProfile.findFirst({
          where: { docusignEnvelopeId: envelopeId },
        });

        if (voidedStudent) {
          await db.studentProfile.update({
            where: { id: voidedStudent.id },
            data: { contractStatus: 'voided' },
          });
        }
        break;
      }

      case 'sent':
      case 'delivered':
        // Informational — envelope has been sent/delivered to signer
        fastify.log.info(`DocuSign envelope ${envelopeId} status: ${status}`);
        break;

      default:
        fastify.log.info(`DocuSign unhandled status: ${status} for envelope ${envelopeId}`);
    }

    return reply.send({ received: true });
  });

  /**
   * Twilio SMS Status Callback
   * Receives delivery status updates for outbound SMS messages
   */
  fastify.post('/api/webhooks/twilio/status', async (request, reply) => {
    const { MessageSid, MessageStatus, To, ErrorCode, ErrorMessage } = request.body as any;

    fastify.log.info(`Twilio SMS status: ${MessageSid} → ${MessageStatus} (to: ${To})`);

    // Log failures for monitoring
    if (MessageStatus === 'failed' || MessageStatus === 'undelivered') {
      fastify.log.error({
        messageSid: MessageSid,
        status: MessageStatus,
        errorCode: ErrorCode,
        errorMessage: ErrorMessage,
        to: To,
      }, 'Twilio SMS delivery failure');
    }

    // Could store delivery status in a notification_log table for debugging
    // For now, just acknowledge
    return reply.status(200).send('<Response></Response>');
  });

  /**
   * Health check for webhooks
   */
  fastify.get('/api/webhooks/health', async () => {
    const services = {
      stripe: !!process.env.STRIPE_WEBHOOK_SECRET,
      docusign: !!process.env.DOCUSIGN_WEBHOOK_SECRET,
      cloudinary: !!process.env.CLOUDINARY_API_SECRET,
      twilio: !!process.env.TWILIO_AUTH_TOKEN,
    };

    return {
      status: 'ok',
      webhooks: services,
      timestamp: new Date().toISOString(),
    };
  });
}
