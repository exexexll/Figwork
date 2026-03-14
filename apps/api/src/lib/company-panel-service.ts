/**
 * Company Panel Service — shared business logic for company panel routes and agent tools.
 * All functions are DB-only; no duplicate business logic.
 */

import { db } from '@figwork/db';

// ============================================================
// Archive Operations
// ============================================================

export async function archiveWorkUnit(companyId: string, workUnitId: string): Promise<void> {
  await db.workUnit.updateMany({
    where: { id: workUnitId, companyId },
    data: { archivedAt: new Date() },
  });
}

export async function restoreWorkUnit(companyId: string, workUnitId: string): Promise<void> {
  await db.workUnit.updateMany({
    where: { id: workUnitId, companyId },
    data: { archivedAt: null },
  });
}

export async function listArchivedWorkUnits(companyId: string) {
  return await db.workUnit.findMany({
    where: { companyId, archivedAt: { not: null } },
    include: { escrow: true, executions: { take: 1, orderBy: { createdAt: 'desc' } } },
    orderBy: { archivedAt: 'desc' },
  });
}

// ============================================================
// Work Unit Templates
// ============================================================

export async function createTemplateFromWorkUnit(
  companyId: string,
  name: string,
  workUnitId: string
): Promise<string> {
  const wu = await db.workUnit.findFirst({
    where: { id: workUnitId, companyId },
    select: {
      title: true,
      spec: true,
      category: true,
      priceInCents: true,
      deadlineHours: true,
      requiredSkills: true,
      acceptanceCriteria: true,
      deliverableFormat: true,
      minTier: true,
      complexityScore: true,
      revisionLimit: true,
      deliverableCount: true,
      assignmentMode: true,
      exampleUrls: true,
    },
  });

  if (!wu) throw new Error('Work unit not found');

  const template = await db.workUnitTemplate.create({
    data: {
      companyId,
      name,
      snapshot: wu as any,
    },
  });

  return template.id;
}

export async function listTemplates(companyId: string) {
  return await db.workUnitTemplate.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createDraftFromTemplate(
  companyId: string,
  templateId: string,
  titleOverride?: string
): Promise<string> {
  const template = await db.workUnitTemplate.findFirst({
    where: { id: templateId, companyId },
  });

  if (!template) throw new Error('Template not found');

  const snapshot = template.snapshot as any;

  const wu = await db.workUnit.create({
    data: {
      companyId,
      title: titleOverride || snapshot.title,
      spec: snapshot.spec || '',
      category: snapshot.category || 'general',
      priceInCents: snapshot.priceInCents || 1000,
      deadlineHours: snapshot.deadlineHours || 24,
      requiredSkills: snapshot.requiredSkills || [],
      acceptanceCriteria: snapshot.acceptanceCriteria || [{ criterion: 'Meets specification', required: true }],
      deliverableFormat: snapshot.deliverableFormat || [],
      requiredDocuments: [],
      minTier: snapshot.minTier || 'novice',
      complexityScore: snapshot.complexityScore || 1,
      revisionLimit: snapshot.revisionLimit || 2,
      deliverableCount: snapshot.deliverableCount || 1,
      status: 'draft',
      assignmentMode: snapshot.assignmentMode || 'auto',
      hasExamples: !!(snapshot.exampleUrls?.length),
      exampleUrls: snapshot.exampleUrls || [],
      preferredHistory: 0,
      maxRevisionTendency: 0.3,
    },
  });

  // Create escrow
  const feePercent = 0.15; // PRICING_CONFIG.platformFees.novice
  const feeAmount = Math.round(wu.priceInCents * feePercent);
  await db.escrow.create({
    data: {
      workUnitId: wu.id,
      companyId,
      amountInCents: wu.priceInCents,
      platformFeeInCents: feeAmount,
      netAmountInCents: wu.priceInCents - feeAmount,
      status: 'pending',
    },
  });

  return wu.id;
}

// ============================================================
// Contractor Preferences
// ============================================================

export async function setContractorPreference(
  companyId: string,
  studentId: string,
  type: 'blacklist' | 'whitelist',
  reason?: string
): Promise<void> {
  await db.companyContractorPreference.upsert({
    where: {
      companyId_studentId: { companyId, studentId },
    },
    create: {
      companyId,
      studentId,
      type,
      reason: reason || null,
    },
    update: {
      type,
      reason: reason || null,
    },
  });
}

export async function listContractorPreferences(companyId: string) {
  return await db.companyContractorPreference.findMany({
    where: { companyId },
    include: { student: { select: { id: true, name: true, email: true, tier: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function deleteContractorPreference(companyId: string, studentId: string): Promise<void> {
  await db.companyContractorPreference.deleteMany({
    where: { companyId, studentId },
  });
}

// ============================================================
// Activity Log
// ============================================================

export async function appendActivityLog(
  companyId: string,
  data: {
    userId?: string;
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: any;
  }
): Promise<void> {
  await db.companyActivityLog.create({
    data: {
      companyId,
      userId: data.userId || null,
      action: data.action,
      entityType: data.entityType || null,
      entityId: data.entityId || null,
      metadata: data.metadata || null,
    },
  });
}

export async function getActivityLog(companyId: string, limit: number = 50) {
  return await db.companyActivityLog.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

// ============================================================
// Export Operations
// ============================================================

export async function exportWorkUnitsJson(companyId: string) {
  const workUnits = await db.workUnit.findMany({
    where: { companyId },
    include: {
      escrow: true,
      executions: {
        include: {
          student: { select: { id: true, name: true, email: true, tier: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return JSON.stringify(workUnits, null, 2);
}

export async function exportExecutionsJson(companyId: string) {
  const executions = await db.execution.findMany({
    where: { workUnit: { companyId } },
    include: {
      workUnit: { select: { id: true, title: true, category: true, priceInCents: true } },
      student: { select: { id: true, name: true, email: true, tier: true } },
      qaCheck: true,
      payout: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return JSON.stringify(executions, null, 2);
}

// ============================================================
// Bulk Operations
// ============================================================

export async function bulkUpdateWorkUnits(
  companyId: string,
  workUnitIds: string[],
  patch: {
    status?: string;
    deadlineHours?: number;
    priceInCents?: number;
    [key: string]: any;
  }
): Promise<number> {
  const result = await db.workUnit.updateMany({
    where: { id: { in: workUnitIds }, companyId },
    data: patch,
  });
  return result.count;
}

export async function bulkPublishWorkUnits(
  companyId: string,
  workUnitIds: string[]
): Promise<{ success: string[]; failed: Array<{ id: string; error: string }> }> {
  const success: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of workUnitIds) {
    try {
      const wu = await db.workUnit.findFirst({
        where: { id, companyId },
        include: { escrow: true },
      });

      if (!wu) {
        failed.push({ id, error: 'Work unit not found' });
        continue;
      }

      if (wu.status === 'active') {
        success.push(id);
        continue;
      }

      // Fund escrow if not funded
      if (wu.escrow && wu.escrow.status !== 'funded') {
        await db.escrow.update({
          where: { id: wu.escrow.id },
          data: { status: 'funded', fundedAt: new Date() },
        });
      }

      // Set to active
      await db.workUnit.update({
        where: { id: wu.id },
        data: { status: 'active', publishedAt: new Date() },
      });

      success.push(id);
    } catch (err: any) {
      failed.push({ id, error: err.message || 'Unknown error' });
    }
  }

  return { success, failed };
}

export async function bulkAssignContractor(
  companyId: string,
  workUnitIds: string[],
  studentId: string
): Promise<{ success: string[]; failed: Array<{ id: string; error: string }> }> {
  const success: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  const student = await db.studentProfile.findUnique({ where: { id: studentId } });
  if (!student) {
    // All fail with same error
    return {
      success: [],
      failed: workUnitIds.map(id => ({ id, error: 'Student not found' })),
    };
  }

  for (const workUnitId of workUnitIds) {
    try {
      const wu = await db.workUnit.findFirst({
        where: { id: workUnitId, companyId, status: 'active' },
        include: { milestoneTemplates: { orderBy: { orderIndex: 'asc' } } },
      });

      if (!wu) {
        failed.push({ id: workUnitId, error: 'Work unit not found or not active' });
        continue;
      }

      // Check no existing active execution
      const existing = await db.execution.findFirst({
        where: {
          workUnitId,
          status: { notIn: ['approved', 'failed', 'cancelled'] },
        },
      });
      if (existing) {
        failed.push({ id: workUnitId, error: 'Already has active assignment' });
        continue;
      }

      const deadline = new Date(Date.now() + wu.deadlineHours * 60 * 60 * 1000);

      await db.execution.create({
        data: {
          workUnitId: wu.id,
          studentId: student.id,
          status: 'assigned',
          deadlineAt: deadline,
          milestones: { create: wu.milestoneTemplates.map(mt => ({ templateId: mt.id })) },
        },
      });

      await db.workUnit.update({ where: { id: wu.id }, data: { status: 'in_progress' } });

      success.push(workUnitId);
    } catch (err: any) {
      failed.push({ id: workUnitId, error: err.message || 'Unknown error' });
    }
  }

  return { success, failed };
}

// ============================================================
// Settings
// ============================================================

export async function getCompanySettings(companyId: string) {
  const company = await db.companyProfile.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  return company?.settings || null;
}

export async function updateCompanySettings(companyId: string, settings: any): Promise<void> {
  await db.companyProfile.update({
    where: { id: companyId },
    data: { settings },
  });
}

// ============================================================
// Contractor History
// ============================================================

export async function getContractorHistory(companyId: string, studentId: string) {
  return await db.execution.findMany({
    where: {
      workUnit: { companyId },
      studentId,
    },
    include: {
      workUnit: { select: { id: true, title: true, category: true, priceInCents: true } },
      qaCheck: true,
      payout: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}
