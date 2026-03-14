import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db, Prisma } from '@figwork/db';
import { verifyClerkAuth } from '../lib/clerk.js';
import { forbidden, notFound, badRequest } from '../lib/http-errors.js';

export async function workflowGroupRoutes(fastify: FastifyInstance) {
  // Auth middleware
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await verifyClerkAuth(request, reply);
    if (!auth) return;
    const user = await db.user.findUnique({
      where: { clerkId: auth.userId },
      include: { companyProfile: true },
    });
    if (!user?.companyProfile) return forbidden(reply, 'Company profile required');
    (request as any).company = user.companyProfile;
  });

  // GET / — List all workflow groups
  fastify.get('/', async (request, reply) => {
    const company = (request as any).company;
    const groups = await (db as any).workflowGroup.findMany({
      where: { companyId: company.id },
      include: {
        workUnits: {
          where: { archivedAt: null },
          include: {
            executions: {
              include: {
                student: { select: { name: true } },
                milestones: { include: { template: { select: { orderIndex: true, description: true } } } },
                powLogs: { orderBy: { requestedAt: 'desc' as const }, take: 3 },
              },
              where: { status: { notIn: ['cancelled'] } },
              orderBy: { assignedAt: 'desc' as const },
              take: 1,
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(groups);
  });

  // POST / — Create a workflow group
  fastify.post<{ Body: { name: string; description?: string; color?: string; workUnitIds?: string[] } }>(
    '/',
    async (request, reply) => {
      const company = (request as any).company;
      const { name, description, color, workUnitIds } = request.body;
      if (!name?.trim()) return badRequest(reply, 'Name is required');

      const group = await (db as any).workflowGroup.create({
        data: {
          companyId: company.id,
          name: name.trim(),
          description: description?.trim() || null,
          color: color || '#6366f1',
        },
      });

      // Assign work units to the group
      if (workUnitIds?.length) {
        await (db.workUnit as any).updateMany({
          where: { id: { in: workUnitIds }, companyId: company.id },
          data: { workflowGroupId: group.id },
        });
      }

      const full = await (db as any).workflowGroup.findUnique({
        where: { id: group.id },
        include: { workUnits: { select: { id: true, title: true, status: true } } },
      });
      return reply.status(201).send(full);
    }
  );

  // PUT /:id — Update a workflow group
  fastify.put<{ Params: { id: string }; Body: { name?: string; description?: string; color?: string; nodePositions?: any } }>(
    '/:id',
    async (request, reply) => {
      const company = (request as any).company;
      const { id } = request.params;
      const { name, description, color, nodePositions } = request.body;

      const group = await (db as any).workflowGroup.findFirst({ where: { id, companyId: company.id } });
      if (!group) return notFound(reply, 'Workflow group not found');

      const updated = await (db as any).workflowGroup.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(description !== undefined ? { description: description?.trim() || null } : {}),
          ...(color !== undefined ? { color } : {}),
          ...(nodePositions !== undefined ? { nodePositions: nodePositions as Prisma.InputJsonValue } : {}),
        },
        include: { workUnits: { select: { id: true, title: true, status: true } } },
      });
      return reply.send(updated);
    }
  );

  // GET /:id/health — Project health summary
  fastify.get<{ Params: { id: string } }>(
    '/:id/health',
    async (request, reply) => {
      const company = (request as any).company;
      const { id } = request.params;

      const group = await (db as any).workflowGroup.findFirst({ where: { id, companyId: company.id } });
      if (!group) return notFound(reply, 'Workflow group not found');

      const workUnits = await (db.workUnit as any).findMany({
        where: { workflowGroupId: id, archivedAt: null },
        include: {
          escrow: true,
          executions: {
            include: { student: { select: { name: true } } },
            orderBy: { assignedAt: 'desc' as const },
          },
        },
      });

      const now = new Date();
      let totalTasks = workUnits.length;
      let draft = 0, active = 0, completed = 0, cancelled = 0, paused = 0;
      let overdue = 0, blocked = 0, inProgress = 0, awaitingReview = 0;
      let totalBudgetCents = 0, totalSpentCents = 0;
      let bottlenecks: Array<{ title: string; hoursOverdue: number; blockedCount: number }> = [];

      for (const wu of workUnits) {
        // Status counts
        if (wu.status === 'draft') draft++;
        else if (wu.status === 'active') active++;
        else if (wu.status === 'completed') completed++;
        else if (wu.status === 'cancelled') cancelled++;
        else if (wu.status === 'paused') paused++;

        // Budget
        totalBudgetCents += wu.escrow?.amountInCents || wu.priceInCents || 0;
        if (wu.status === 'completed' || wu.escrow?.status === 'released') {
          totalSpentCents += wu.priceInCents || 0;
        }

        // Execution analysis
        const activeExec = wu.executions.find((e: any) => !['cancelled', 'failed', 'approved'].includes(e.status));
        if (activeExec) {
          if (['submitted', 'in_review'].includes(activeExec.status)) awaitingReview++;
          else if (['assigned', 'clocked_in'].includes(activeExec.status)) inProgress++;

          if (activeExec.deadlineAt && new Date(activeExec.deadlineAt) < now && ['assigned', 'clocked_in'].includes(activeExec.status)) {
            overdue++;
            const hoursOver = Math.round((now.getTime() - new Date(activeExec.deadlineAt).getTime()) / 3600000);
            // Check if this overdue task blocks others
            const dependents = workUnits.filter((other: any) => {
              const pc = other.publishConditions as any;
              return pc?.dependencies?.some((d: any) => d.workUnitId === wu.id);
            });
            if (dependents.length > 0) {
              bottlenecks.push({ title: wu.title, hoursOverdue: hoursOver, blockedCount: dependents.length });
            }
          }
        }

        // Check if this draft WU is blocked by unmet conditions
        if (wu.status === 'draft' && wu.publishConditions) {
          const conds = wu.publishConditions as any;
          if (conds?.dependencies?.length > 0) {
            const allMet = conds.dependencies.every((dep: any) => {
              const depWU = workUnits.find((w: any) => w.id === dep.workUnitId);
              if (!depWU) return false;
              if (dep.condition === 'completed') return depWU.status === 'completed' || depWU.executions.some((e: any) => e.status === 'approved');
              if (dep.condition === 'published') return depWU.status === 'active' || depWU.status === 'completed';
              return false;
            });
            if (!allMet) blocked++;
          }
        }
      }

      // Estimated completion
      const completionRate = totalTasks > 0 ? completed / totalTasks : 0;
      const activeTasks = totalTasks - completed - cancelled;
      let estimatedDaysRemaining: number | null = null;
      if (completionRate > 0 && activeTasks > 0) {
        // Simple projection based on current rate
        const avgHoursPerTask = workUnits
          .filter((w: any) => w.status === 'completed')
          .reduce((sum: number, w: any) => {
            const exec = w.executions.find((e: any) => e.status === 'approved');
            if (exec?.assignedAt && exec?.completedAt) {
              return sum + (new Date(exec.completedAt).getTime() - new Date(exec.assignedAt).getTime()) / 3600000;
            }
            return sum + w.deadlineHours;
          }, 0) / Math.max(completed, 1);
        estimatedDaysRemaining = Math.ceil((activeTasks * avgHoursPerTask) / 24);
      }

      return reply.send({
        groupName: group.name,
        totalTasks,
        status: { draft, active, completed, cancelled, paused },
        execution: { inProgress, awaitingReview, overdue, blocked },
        completionPercent: Math.round(completionRate * 100),
        estimatedDaysRemaining,
        budget: {
          totalCents: totalBudgetCents,
          spentCents: totalSpentCents,
          remainingCents: totalBudgetCents - totalSpentCents,
        },
        bottlenecks: bottlenecks.sort((a, b) => b.blockedCount - a.blockedCount).slice(0, 5),
        health: overdue > 2 || bottlenecks.length > 1 ? 'at_risk'
          : overdue > 0 || blocked > totalTasks * 0.5 ? 'needs_attention'
          : 'on_track',
      });
    }
  );

  // PUT /:id/assign — Assign/remove work units to/from a group
  fastify.put<{ Params: { id: string }; Body: { addWorkUnitIds?: string[]; removeWorkUnitIds?: string[] } }>(
    '/:id/assign',
    async (request, reply) => {
      const company = (request as any).company;
      const { id } = request.params;
      const { addWorkUnitIds, removeWorkUnitIds } = request.body;

      const group = await (db as any).workflowGroup.findFirst({ where: { id, companyId: company.id } });
      if (!group) return notFound(reply, 'Workflow group not found');

      if (addWorkUnitIds?.length) {
        await (db.workUnit as any).updateMany({
          where: { id: { in: addWorkUnitIds }, companyId: company.id },
          data: { workflowGroupId: id },
        });
      }
      if (removeWorkUnitIds?.length) {
        await (db.workUnit as any).updateMany({
          where: { id: { in: removeWorkUnitIds }, companyId: company.id, workflowGroupId: id },
          data: { workflowGroupId: null },
        });
      }

      const updated = await (db as any).workflowGroup.findUnique({
        where: { id },
        include: {
          workUnits: {
            select: { id: true, title: true, status: true, priceInCents: true, deadlineHours: true, complexityScore: true, publishConditions: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      return reply.send(updated);
    }
  );

  // DELETE /:id — Delete a workflow group (unassigns work units, doesn't delete them)
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    async (request, reply) => {
      const company = (request as any).company;
      const { id } = request.params;

      const group = await (db as any).workflowGroup.findFirst({ where: { id, companyId: company.id } });
      if (!group) return notFound(reply, 'Workflow group not found');

      // Get all WUs in this group
      const groupWUs = await (db.workUnit as any).findMany({
        where: { workflowGroupId: id },
        select: { id: true, publishConditions: true },
      });

      // Clear publish conditions (dependencies) for all WUs in this group
      // but keep scheduledPublishAt intact
      const groupWUIds = new Set(groupWUs.map((w: any) => w.id));
      for (const wu of groupWUs) {
        if (!wu.publishConditions) continue;
        const conds = wu.publishConditions as any;
        if (!conds?.dependencies?.length) continue;
        // Remove only intra-group dependencies, keep cross-group ones
        const remaining = conds.dependencies.filter((d: any) => !groupWUIds.has(d.workUnitId));
        await (db.workUnit as any).update({
          where: { id: wu.id },
          data: {
            workflowGroupId: null,
            publishConditions: remaining.length > 0 ? { ...conds, dependencies: remaining } : null,
          },
        });
      }
      // Unassign WUs that had no conditions
      await (db.workUnit as any).updateMany({
        where: { workflowGroupId: id },
        data: { workflowGroupId: null },
      });

      await (db as any).workflowGroup.delete({ where: { id } });
      return reply.status(204).send();
    }
  );
}
