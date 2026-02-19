import { FastifyReply } from 'fastify';

/**
 * HTTP Error response helpers
 * These provide a consistent interface for error responses
 */

export function unauthorized(reply: FastifyReply, message = 'Authentication required') {
  return reply.status(401).send({ success: false, error: message });
}

export function forbidden(reply: FastifyReply, message = 'Access denied') {
  return reply.status(403).send({ success: false, error: message });
}

export function notFound(reply: FastifyReply, message = 'Resource not found') {
  return reply.status(404).send({ success: false, error: message });
}

export function conflict(reply: FastifyReply, message = 'Resource already exists') {
  return reply.status(409).send({ success: false, error: message });
}

export function badRequest(reply: FastifyReply, messageOrDetails: string | object = 'Invalid request') {
  if (typeof messageOrDetails === 'string') {
    return reply.status(400).send({ success: false, error: messageOrDetails });
  }
  return reply.status(400).send({ success: false, ...messageOrDetails });
}

export function internalError(reply: FastifyReply, message = 'Internal server error') {
  return reply.status(500).send({ success: false, error: message });
}
