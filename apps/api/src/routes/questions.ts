import type { FastifyInstance } from 'fastify';
import { db } from '@figwork/db';
import { requireAuth } from '../lib/clerk.js';
import { DEFAULTS } from '@figwork/shared';
import { invalidateTemplateCache } from '../lib/template-cache.js';

// JSON Schema for validation
const addQuestionSchema = {
  body: {
    type: 'object',
    required: ['questionText'],
    properties: {
      questionText: { type: 'string', minLength: 1 },
      rubric: { type: 'string' },
      maxFollowups: { type: 'integer', minimum: 0, maximum: 10 },
      askVerbatim: { type: 'boolean' },
    },
  },
};

const updateQuestionSchema = {
  body: {
    type: 'object',
    properties: {
      questionText: { type: 'string', minLength: 1 },
      rubric: { type: 'string' },
      maxFollowups: { type: 'integer', minimum: 0, maximum: 10 },
      askVerbatim: { type: 'boolean' },
    },
  },
};

const reorderQuestionsSchema = {
  body: {
    type: 'object',
    required: ['questionIds'],
    properties: {
      questionIds: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        minItems: 1,
      },
    },
  },
};

export async function registerQuestionRoutes(fastify: FastifyInstance): Promise<void> {
  // Add question to template
  fastify.post<{
    Params: { id: string };
    Body: {
      questionText: string;
      rubric?: string;
      maxFollowups?: number;
      askVerbatim?: boolean;
    };
  }>('/api/templates/:id/questions', {
    schema: addQuestionSchema,
    preHandler: requireAuth,
  }, async (request, reply) => {
    const template = await db.interviewTemplate.findFirst({
      where: {
        id: request.params.id,
        ownerId: request.user!.id,
      },
      include: {
        questions: {
          orderBy: { orderIndex: 'desc' },
          take: 1,
        },
      },
    });

    if (!template) {
      return reply.status(404).send({ success: false, error: 'Template not found' });
    }

    const nextIndex = (template.questions[0]?.orderIndex ?? -1) + 1;

    const question = await db.question.create({
      data: {
        templateId: request.params.id,
        questionText: request.body.questionText,
        rubric: request.body.rubric || null,
        maxFollowups: request.body.maxFollowups ?? DEFAULTS.MAX_FOLLOWUPS_PER_QUESTION,
        askVerbatim: request.body.askVerbatim ?? true,
        orderIndex: nextIndex,
      },
    });

    // Invalidate template cache since questions changed
    await invalidateTemplateCache(request.params.id);

    return {
      success: true,
      data: question,
    };
  });

  // Update question
  fastify.put<{
    Params: { id: string };
    Body: {
      questionText?: string;
      rubric?: string;
      maxFollowups?: number;
      askVerbatim?: boolean;
    };
  }>('/api/questions/:id', {
    schema: updateQuestionSchema,
    preHandler: requireAuth,
  }, async (request, reply) => {
    const question = await db.question.findFirst({
      where: { id: request.params.id },
      include: {
        template: true,
      },
    });

    if (!question || question.template.ownerId !== request.user!.id) {
      return reply.status(404).send({ success: false, error: 'Question not found' });
    }

    const updated = await db.question.update({
      where: { id: request.params.id },
      data: {
        questionText: request.body.questionText,
        rubric: request.body.rubric,
        maxFollowups: request.body.maxFollowups,
        askVerbatim: request.body.askVerbatim,
      },
    });

    // Invalidate template cache since questions changed
    await invalidateTemplateCache(question.templateId);

    return {
      success: true,
      data: updated,
    };
  });

  // Delete question
  fastify.delete<{
    Params: { id: string };
  }>('/api/questions/:id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const question = await db.question.findFirst({
      where: { id: request.params.id },
      include: {
        template: true,
      },
    });

    if (!question || question.template.ownerId !== request.user!.id) {
      return reply.status(404).send({ success: false, error: 'Question not found' });
    }

    await db.question.delete({
      where: { id: request.params.id },
    });

    // Invalidate template cache since questions changed
    await invalidateTemplateCache(question.templateId);

    return { success: true };
  });

  // Reorder questions
  fastify.post<{
    Params: { id: string };
    Body: {
      questionIds: string[];
    };
  }>('/api/templates/:id/questions/reorder', {
    schema: reorderQuestionsSchema,
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

    const { questionIds } = request.body;

    // Update order index for each question
    await Promise.all(
      questionIds.map((questionId, index) =>
        db.question.update({
          where: { id: questionId },
          data: { orderIndex: index },
        })
      )
    );

    const questions = await db.question.findMany({
      where: { templateId: request.params.id },
      orderBy: { orderIndex: 'asc' },
    });

    // Invalidate template cache since question order changed
    await invalidateTemplateCache(request.params.id);

    return {
      success: true,
      data: questions,
    };
  });
}
