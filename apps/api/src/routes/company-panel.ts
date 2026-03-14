/**
 * Company Panel Routes — administrative endpoints for company dashboard.
 * Uses same auth as companies routes.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '@figwork/db';
import { verifyClerkAuth } from '../lib/clerk.js';
import { unauthorized, forbidden, badRequest, notFound } from '../lib/http-errors.js';
import * as panelService from '../lib/company-panel-service.js';

export async function companyPanelRoutes(fastify: FastifyInstance) {
  // Middleware: Attach company profile (same as companies.ts)
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await verifyClerkAuth(request, reply);
    if (!authResult) return;

    const user = await db.user.findUnique({
      where: { clerkId: authResult.userId },
      include: { companyProfile: true },
    });

    if (!user) {
      return unauthorized(reply, 'User not found');
    }

    if (!user.companyProfile) {
      return forbidden(reply, 'Company profile not found. Please register first.');
    }

    (request as any).user = user;
    (request as any).company = user.companyProfile;
  });

  // ====================
  // NOTIFICATIONS
  // ====================
  // Mark-read routes already exist in companies.ts at:
  //   POST /notifications/:id/read
  //   POST /notifications/read-all
  // We do NOT duplicate them here to avoid Fastify duplicate-route errors.
  // The agent tools call the DB directly; the UI uses the existing endpoints.

  // ====================
  // EXPORT
  // ====================

  // GET /panel/export/work-units
  fastify.get('/panel/export/work-units', async (request, reply) => {
    const company = (request as any).company;
    const json = await panelService.exportWorkUnitsJson(company.id);
    reply.type('application/json');
    reply.header('Content-Disposition', `attachment; filename="work-units-${company.id.slice(0, 8)}.json"`);
    return reply.send(json);
  });

  // GET /panel/export/executions
  fastify.get('/panel/export/executions', async (request, reply) => {
    const company = (request as any).company;
    const json = await panelService.exportExecutionsJson(company.id);
    reply.type('application/json');
    reply.header('Content-Disposition', `attachment; filename="executions-${company.id.slice(0, 8)}.json"`);
    return reply.send(json);
  });

  // ====================
  // BULK OPERATIONS
  // ====================

  // POST /panel/bulk/update-work-units
  fastify.post<{ Body: { ids: string[]; patch: any } }>(
    '/panel/bulk/update-work-units',
    async (request, reply) => {
      const company = (request as any).company;
      const { ids, patch } = request.body;

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return badRequest(reply, 'ids array is required');
      }

      const count = await panelService.bulkUpdateWorkUnits(company.id, ids, patch);
      return reply.send({ success: true, updated: count });
    }
  );

  // POST /panel/bulk/publish
  fastify.post<{ Body: { workUnitIds: string[] } }>('/panel/bulk/publish', async (request, reply) => {
    const company = (request as any).company;
    const { workUnitIds } = request.body;

    if (!workUnitIds || !Array.isArray(workUnitIds) || workUnitIds.length === 0) {
      return badRequest(reply, 'workUnitIds array is required');
    }

    const result = await panelService.bulkPublishWorkUnits(company.id, workUnitIds);
    return reply.send(result);
  });

  // POST /panel/bulk/assign
  fastify.post<{ Body: { workUnitIds: string[]; studentId: string } }>(
    '/panel/bulk/assign',
    async (request, reply) => {
      const company = (request as any).company;
      const { workUnitIds, studentId } = request.body;

      if (!workUnitIds || !Array.isArray(workUnitIds) || workUnitIds.length === 0) {
        return badRequest(reply, 'workUnitIds array is required');
      }
      if (!studentId) {
        return badRequest(reply, 'studentId is required');
      }

      const result = await panelService.bulkAssignContractor(company.id, workUnitIds, studentId);
      return reply.send(result);
    }
  );

  // ====================
  // ARCHIVE
  // ====================

  // POST /panel/work-units/:id/archive
  fastify.post<{ Params: { id: string } }>('/panel/work-units/:id/archive', async (request, reply) => {
    const company = (request as any).company;
    const { id } = request.params;

    const wu = await db.workUnit.findFirst({ where: { id, companyId: company.id } });
    if (!wu) {
      return notFound(reply, 'Work unit not found');
    }

    await panelService.archiveWorkUnit(company.id, id);
    await panelService.appendActivityLog(company.id, {
      userId: (request as any).user.clerkId,
      action: 'archive_work_unit',
      entityType: 'work_unit',
      entityId: id,
    });

    return reply.send({ success: true });
  });

  // POST /panel/work-units/:id/restore
  fastify.post<{ Params: { id: string } }>('/panel/work-units/:id/restore', async (request, reply) => {
    const company = (request as any).company;
    const { id } = request.params;

    const wu = await db.workUnit.findFirst({ where: { id, companyId: company.id } });
    if (!wu) {
      return notFound(reply, 'Work unit not found');
    }

    await panelService.restoreWorkUnit(company.id, id);
    await panelService.appendActivityLog(company.id, {
      userId: (request as any).user.clerkId,
      action: 'restore_work_unit',
      entityType: 'work_unit',
      entityId: id,
    });

    return reply.send({ success: true });
  });

  // GET /panel/work-units/archived
  fastify.get('/panel/work-units/archived', async (request, reply) => {
    const company = (request as any).company;
    const archived = await panelService.listArchivedWorkUnits(company.id);
    return reply.send({ workUnits: archived });
  });

  // ====================
  // TEMPLATES
  // ====================

  // POST /panel/templates
  fastify.post<{ Body: { name: string; workUnitId: string } }>(
    '/panel/templates',
    async (request, reply) => {
      const company = (request as any).company;
      const { name, workUnitId } = request.body;

      if (!name || !workUnitId) {
        return badRequest(reply, 'name and workUnitId are required');
      }

      try {
        const templateId = await panelService.createTemplateFromWorkUnit(company.id, name, workUnitId);
        await panelService.appendActivityLog(company.id, {
          userId: (request as any).user.clerkId,
          action: 'create_template',
          entityType: 'work_unit_template',
          entityId: templateId,
        });
        return reply.send({ id: templateId, name });
      } catch (err: any) {
        return badRequest(reply, err.message || 'Failed to create template');
      }
    }
  );

  // GET /panel/templates
  fastify.get('/panel/templates', async (request, reply) => {
    const company = (request as any).company;
    const templates = await panelService.listTemplates(company.id);
    return reply.send({ templates });
  });

  // POST /panel/templates/:id/create-work-unit
  fastify.post<{ Params: { id: string }; Body: { title?: string } }>(
    '/panel/templates/:id/create-work-unit',
    async (request, reply) => {
      const company = (request as any).company;
      const { id } = request.params;
      const { title } = request.body;

      try {
        const workUnitId = await panelService.createDraftFromTemplate(company.id, id, title);
        await panelService.appendActivityLog(company.id, {
          userId: (request as any).user.clerkId,
          action: 'create_work_unit_from_template',
          entityType: 'work_unit',
          entityId: workUnitId,
          metadata: { templateId: id },
        });
        return reply.send({ id: workUnitId });
      } catch (err: any) {
        return badRequest(reply, err.message || 'Failed to create work unit from template');
      }
    }
  );

  // ====================
  // CONTRACTOR PREFERENCES
  // ====================

  // POST /panel/contractors/preference
  fastify.post<{ Body: { studentId: string; type: 'blacklist' | 'whitelist'; reason?: string } }>(
    '/panel/contractors/preference',
    async (request, reply) => {
      const company = (request as any).company;
      const { studentId, type, reason } = request.body;

      if (!studentId || !type) {
        return badRequest(reply, 'studentId and type are required');
      }

      if (type !== 'blacklist' && type !== 'whitelist') {
        return badRequest(reply, 'type must be "blacklist" or "whitelist"');
      }

      await panelService.setContractorPreference(company.id, studentId, type, reason);
      await panelService.appendActivityLog(company.id, {
        userId: (request as any).user.clerkId,
        action: `set_contractor_${type}`,
        entityType: 'contractor_preference',
        metadata: { studentId, reason },
      });

      return reply.send({ success: true });
    }
  );

  // GET /panel/contractors/preferences
  fastify.get('/panel/contractors/preferences', async (request, reply) => {
    const company = (request as any).company;
    const preferences = await panelService.listContractorPreferences(company.id);
    return reply.send({ preferences });
  });

  // DELETE /panel/contractors/preference/:studentId
  fastify.delete<{ Params: { studentId: string } }>(
    '/panel/contractors/preference/:studentId',
    async (request, reply) => {
      const company = (request as any).company;
      const { studentId } = request.params;

      await panelService.deleteContractorPreference(company.id, studentId);
      await panelService.appendActivityLog(company.id, {
        userId: (request as any).user.clerkId,
        action: 'remove_contractor_preference',
        entityType: 'contractor_preference',
        metadata: { studentId },
      });

      return reply.send({ success: true });
    }
  );

  // GET /panel/contractors/:studentId/history
  fastify.get<{ Params: { studentId: string } }>(
    '/panel/contractors/:studentId/history',
    async (request, reply) => {
      const company = (request as any).company;
      const { studentId } = request.params;

      const history = await panelService.getContractorHistory(company.id, studentId);
      return reply.send({ executions: history });
    }
  );

  // ====================
  // ACTIVITY LOG
  // ====================

  // GET /panel/activity
  fastify.get<{ Querystring: { limit?: string } }>('/panel/activity', async (request, reply) => {
    const company = (request as any).company;
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
    const logs = await panelService.getActivityLog(company.id, limit);
    return reply.send({ logs });
  });

  // ====================
  // SETTINGS
  // ====================

  // GET /panel/settings
  fastify.get('/panel/settings', async (request, reply) => {
    const company = (request as any).company;
    const settings = await panelService.getCompanySettings(company.id);
    return reply.send({ settings });
  });

  // PUT /panel/settings
  fastify.put<{ Body: { settings: any } }>('/panel/settings', async (request, reply) => {
    const company = (request as any).company;
    const { settings } = request.body;

    await panelService.updateCompanySettings(company.id, settings);
    await panelService.appendActivityLog(company.id, {
      userId: (request as any).user.clerkId,
      action: 'update_settings',
      entityType: 'company_settings',
    });

    return reply.send({ success: true });
  });
}
