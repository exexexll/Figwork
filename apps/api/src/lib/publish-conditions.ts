import { db } from '@figwork/db';

export type PublishConditionType = 'published' | 'completed' | 'failed';
export type PublishFailureAction = 'publish' | 'cancel' | 'notify';
export type ContextShareLevel = 'none' | 'summary' | 'full';
export type PublishLogic = 'AND' | 'OR';

export interface PublishDependency {
  workUnitId: string;
  condition: PublishConditionType;
  onFailure?: PublishFailureAction; // Only if condition = 'failed'
  shareContext: ContextShareLevel;
}

export interface PublishConditions {
  logic: PublishLogic;
  dependencies: PublishDependency[];
}

export interface DependencyStatus {
  workUnitId: string;
  workUnitTitle: string;
  condition: PublishConditionType;
  met: boolean;
  reason?: string;
  depStatus?: string; // Current status of the dependency work unit
  onFailureAction?: PublishFailureAction;
}

export interface SharedContext {
  workUnitId: string;
  workUnitTitle: string;
  shareLevel: ContextShareLevel;
  category?: string;
  status?: string;
  summary?: string;
  fullContext?: {
    spec: string;
    acceptanceCriteria: any[];
    deliverables?: string[];
    executionResults?: any;
  };
}

/**
 * Check if scheduled publish time has passed
 */
export function checkScheduledPublish(workUnit: { scheduledPublishAt?: Date | null }): boolean {
  if (!workUnit.scheduledPublishAt) return false;
  return new Date(workUnit.scheduledPublishAt) <= new Date();
}

/**
 * Safely parse publishConditions from DB (handles malformed JSON)
 */
function parsePublishConditions(raw: unknown): PublishConditions | null {
  if (!raw) return null;
  try {
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as PublishConditions;
    if (!parsed.logic || !Array.isArray(parsed.dependencies)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Evaluate if all/any publish conditions are met.
 * Uses batched queries to reduce N+1 DB calls.
 */
export async function evaluatePublishConditions(
  workUnitId: string
): Promise<{ met: boolean; details: DependencyStatus[]; actionRequired?: string }> {
  const workUnit = await db.workUnit.findUnique({
    where: { id: workUnitId },
  }) as any;

  if (!workUnit) {
    return { met: false, details: [] };
  }

  const conditions = parsePublishConditions(workUnit.publishConditions);
  if (!conditions || conditions.dependencies.length === 0) {
    return { met: false, details: [] };
  }

  // Batch fetch all dependency work units at once to avoid N+1
  const depIds = conditions.dependencies.map(d => d.workUnitId);
  const depWorkUnits = await db.workUnit.findMany({
    where: { id: { in: depIds } },
    include: {
      executions: {
        select: { id: true, status: true },
      },
    },
  });
  const depMap = new Map(depWorkUnits.map(wu => [wu.id, wu]));

  const details: DependencyStatus[] = [];
  const actionsRequired: string[] = []; // Can have multiple actions

  for (const dep of conditions.dependencies) {
    const depWorkUnit = depMap.get(dep.workUnitId);

    if (!depWorkUnit) {
      // EC1: Deleted dependency — treat as unmet for AND, skip for OR
      details.push({
        workUnitId: dep.workUnitId,
        workUnitTitle: '[Deleted]',
        condition: dep.condition,
        met: false,
        reason: 'Dependency work unit was deleted — clear this condition or it will never be met',
        depStatus: 'missing',
      });
      continue;
    }

    let met = false;
    let reason = '';

    switch (dep.condition) {
      case 'published':
        // EC6: 'paused' is NOT considered published — only active or completed
        met = depWorkUnit.status === 'active' || depWorkUnit.status === 'completed';
        reason = met
          ? `Task is ${depWorkUnit.status}`
          : `Task status is "${depWorkUnit.status}" — needs to be active or completed`;
        break;

      case 'completed': {
        // EC5: Check for approved execution even if WU status isn't 'completed' yet
        const hasApproved = depWorkUnit.executions.some(e => e.status === 'approved');
        met = depWorkUnit.status === 'completed' || hasApproved;
        if (met) {
          reason = hasApproved ? 'Has approved execution (verified output)' : 'Task marked completed';
        } else {
          const activeExecs = depWorkUnit.executions.filter(e =>
            !['failed', 'cancelled'].includes(e.status)
          );
          const failedExecs = depWorkUnit.executions.filter(e => e.status === 'failed');
          if (activeExecs.length > 0) {
            reason = `${activeExecs.length} execution(s) in progress — awaiting approval`;
          } else if (failedExecs.length > 0) {
            reason = `${failedExecs.length} execution(s) failed, none approved — task may need reassignment`;
          } else {
            reason = 'No executions started — task needs to be completed first';
          }
        }
        break;
      }

      case 'failed': {
        const executions = depWorkUnit.executions;
        const allFailed = executions.length > 0 && executions.every(e =>
          ['failed', 'cancelled'].includes(e.status)
        );
        const isCancelled = depWorkUnit.status === 'cancelled';
        const taskFailed = allFailed || isCancelled;

        if (taskFailed) {
          reason = isCancelled ? 'Task was cancelled' : `All ${executions.length} execution(s) failed`;

          // onFailure action determines whether this counts as "met"
          if (dep.onFailure === 'publish') {
            met = true;
            reason += ' → will publish this task';
          } else if (dep.onFailure === 'cancel') {
            met = false;
            reason += ' → this task will be cancelled';
            // EC3: Only add action once per work unit
            if (!actionsRequired.includes(`cancel:${workUnitId}`)) {
              actionsRequired.push(`cancel:${workUnitId}`);
            }
          } else if (dep.onFailure === 'notify') {
            met = false;
            reason += ' → awaiting your decision';
            if (!actionsRequired.includes(`notify:${workUnitId}`)) {
              actionsRequired.push(`notify:${workUnitId}`);
            }
          }
        } else {
          const hasActive = executions.some(e =>
            !['failed', 'cancelled'].includes(e.status)
          );
          reason = hasActive
            ? 'Task still has active execution(s) — not failed yet'
            : executions.length > 0
              ? `${executions.length} execution(s) exist but not all failed`
              : 'Task has not failed';
        }
        break;
      }
    }

    details.push({
      workUnitId: dep.workUnitId,
      workUnitTitle: depWorkUnit.title,
      condition: dep.condition,
      met,
      reason,
      depStatus: depWorkUnit.status,
      onFailureAction: dep.condition === 'failed' ? dep.onFailure : undefined,
    });
  }

  // EC7: For OR logic, ignore deleted/missing deps if at least one valid dep exists
  const validDetails = details.filter(d => d.depStatus !== 'missing');
  
  // Apply AND/OR logic
  let met = false;
  if (conditions.logic === 'AND') {
    // AND: all must be met (including deleted ones — they'll block forever)
    met = details.length > 0 && details.every(d => d.met);
  } else {
    // OR: any valid met dep is enough; ignore deleted deps if others exist
    met = validDetails.length > 0
      ? validDetails.some(d => d.met)
      : details.some(d => d.met); // Fallback if all deleted
  }

  // EC3: Return first action required (cancel takes priority over notify)
  const actionRequired = actionsRequired.find(a => a.startsWith('cancel:'))
    || actionsRequired.find(a => a.startsWith('notify:'))
    || undefined;

  return { met, details, actionRequired };
}

/**
 * Get shared context from dependencies based on shareContext settings.
 * Uses batched queries for efficiency.
 */
export async function getSharedContext(
  workUnitId: string,
  studentId?: string
): Promise<SharedContext[]> {
  const workUnit = await db.workUnit.findUnique({
    where: { id: workUnitId },
  }) as any;

  if (!workUnit) return [];

  const conditions = parsePublishConditions(workUnit.publishConditions);
  if (!conditions) return [];

  // Filter to only deps that share context
  const sharingDeps = conditions.dependencies.filter(d => d.shareContext !== 'none');
  if (sharingDeps.length === 0) return [];

  // Batch fetch all dep work units
  const depIds = sharingDeps.map(d => d.workUnitId);
  const depWorkUnits = await db.workUnit.findMany({
    where: { id: { in: depIds } },
    include: {
      executions: {
        where: { status: 'approved' },
        orderBy: { completedAt: 'desc' },
        take: 1,
      },
    },
  });
  const depMap = new Map(depWorkUnits.map(wu => [wu.id, wu]));

  const shared: SharedContext[] = [];

  for (const dep of sharingDeps) {
    const depWorkUnit = depMap.get(dep.workUnitId);
    if (!depWorkUnit) continue;

    const context: SharedContext = {
      workUnitId: dep.workUnitId,
      workUnitTitle: depWorkUnit.title,
      shareLevel: dep.shareContext,
      category: depWorkUnit.category,
      status: depWorkUnit.status,
    };

    if (dep.shareContext === 'summary') {
      const statusLabel = depWorkUnit.status === 'completed' ? 'Completed'
        : depWorkUnit.status === 'active' ? 'In Progress'
        : depWorkUnit.status;
      context.summary = `${depWorkUnit.title} (${depWorkUnit.category}) — ${statusLabel}`;
    } else if (dep.shareContext === 'full') {
      const approvedExecution = depWorkUnit.executions[0]; // already filtered to approved
      context.fullContext = {
        spec: depWorkUnit.spec,
        acceptanceCriteria: (depWorkUnit.acceptanceCriteria as any) || [],
        deliverables: approvedExecution?.deliverableUrls || [],
        executionResults: approvedExecution
          ? {
              status: approvedExecution.status,
              submittedAt: approvedExecution.submittedAt,
              qualityScore: approvedExecution.qualityScore,
            }
          : undefined,
      };
      const hasDeliverables = (approvedExecution?.deliverableUrls?.length || 0) > 0;
      context.summary = `${depWorkUnit.title} (${depWorkUnit.category}) — ${depWorkUnit.status}${hasDeliverables ? '' : ' (no deliverables yet)'}`;
    }

    shared.push(context);
  }

  return shared;
}

/**
 * Detect circular dependencies using DFS traversal
 */
export async function detectCircularDependencies(
  workUnitId: string,
  targetWorkUnitId: string,
  companyId: string,
  visited: Set<string> = new Set()
): Promise<boolean> {
  if (workUnitId === targetWorkUnitId) return true;
  if (visited.has(workUnitId)) return false;

  visited.add(workUnitId);

  const workUnit = await db.workUnit.findUnique({
    where: { id: workUnitId, companyId },
  }) as any;

  if (!workUnit || !workUnit.publishConditions) return false;

  const conditions = parsePublishConditions(workUnit.publishConditions);
  if (!conditions) return false;

  for (const dep of conditions.dependencies) {
    if (await detectCircularDependencies(dep.workUnitId, targetWorkUnitId, companyId, visited)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate publish conditions with comprehensive checks
 */
export async function validatePublishConditions(
  conditions: PublishConditions,
  companyId: string,
  currentWorkUnitId?: string
): Promise<{ valid: boolean; error?: string }> {
  if (!conditions.dependencies || conditions.dependencies.length === 0) {
    return { valid: false, error: 'At least one dependency is required' };
  }

  if (conditions.logic !== 'AND' && conditions.logic !== 'OR') {
    return { valid: false, error: 'Logic must be AND or OR' };
  }

  if (conditions.dependencies.length > 20) {
    return { valid: false, error: 'Maximum 20 dependencies allowed' };
  }

  // Check for duplicate dependencies
  const depIds = conditions.dependencies.map(d => d.workUnitId);
  const uniqueIds = new Set(depIds);
  if (uniqueIds.size !== depIds.length) {
    return { valid: false, error: 'Duplicate dependencies are not allowed' };
  }

  // Self-reference check
  if (currentWorkUnitId && depIds.includes(currentWorkUnitId)) {
    return { valid: false, error: 'A work unit cannot depend on itself' };
  }

  // Batch-fetch all dependency work units at once
  const depWorkUnits = await db.workUnit.findMany({
    where: { id: { in: depIds } },
    select: { id: true, companyId: true, title: true },
  });
  const depMap = new Map(depWorkUnits.map(wu => [wu.id, wu]));

  for (const dep of conditions.dependencies) {
    const depWorkUnit = depMap.get(dep.workUnitId);

    if (!depWorkUnit) {
      return { valid: false, error: `Dependency work unit "${dep.workUnitId}" not found` };
    }

    if (depWorkUnit.companyId !== companyId) {
      return { valid: false, error: `"${depWorkUnit.title}" belongs to a different company — dependencies must be within the same company` };
    }

    // Circular dependency check
    if (currentWorkUnitId) {
      const hasCycle = await detectCircularDependencies(dep.workUnitId, currentWorkUnitId, companyId);
      if (hasCycle) {
        return { valid: false, error: `Circular dependency detected: "${depWorkUnit.title}" eventually depends back on this task` };
      }
    }
  }

  // Validate condition types & shareContext
  for (const dep of conditions.dependencies) {
    if (!['published', 'completed', 'failed'].includes(dep.condition)) {
      return { valid: false, error: `Invalid condition type: "${dep.condition}" — must be published, completed, or failed` };
    }

    if (dep.condition === 'failed' && !dep.onFailure) {
      return { valid: false, error: 'onFailure action is required when condition is "failed" — choose publish, cancel, or notify' };
    }

    if (dep.condition === 'failed' && dep.onFailure && !['publish', 'cancel', 'notify'].includes(dep.onFailure)) {
      return { valid: false, error: `Invalid onFailure action: "${dep.onFailure}" — must be publish, cancel, or notify` };
    }

    if (dep.condition !== 'failed' && dep.onFailure) {
      return { valid: false, error: 'onFailure can only be set when condition is "failed"' };
    }

    if (!['none', 'summary', 'full'].includes(dep.shareContext)) {
      return { valid: false, error: `Invalid context sharing level: "${dep.shareContext}" — must be none, summary, or full` };
    }
  }

  return { valid: true };
}

/**
 * Get all work units that depend on this one
 */
export async function getDependentWorkUnits(workUnitId: string): Promise<Array<{ id: string; title: string; status: string }>> {
  // Use raw JSON path query for Postgres JSONB for efficiency
  const workUnits = await (db.workUnit as any).findMany({
    where: {
      publishConditions: { not: null },
    },
    select: { id: true, title: true, status: true, publishConditions: true },
  });

  const dependents: Array<{ id: string; title: string; status: string }> = [];

  for (const wu of workUnits) {
    const conditions = parsePublishConditions(wu.publishConditions);
    if (!conditions) continue;
    const hasDependency = conditions.dependencies.some(dep => dep.workUnitId === workUnitId);
    if (hasDependency) {
      dependents.push({ id: wu.id, title: wu.title, status: wu.status });
    }
  }

  return dependents;
}

/**
 * Handle onFailure actions when a dependency fails.
 * Called by the scheduler or execution status change hooks.
 * 
 * EC2: Cascade cancel propagates through chain (A→B→C, A fails with cancel→B→cancel→C)
 * EC4: Returns the action taken so callers can track and avoid re-processing
 * EC9: Recursively cascades to downstream dependents
 * EC10: Guard against being called for non-failed conditions
 */
export async function handleDependencyFailure(
  workUnitId: string,
  failedDepWorkUnitId: string,
  _processedSet?: Set<string>, // EC9: prevent infinite recursion in cascade
): Promise<{ action: string; message: string } | null> {
  // EC9: Guard against re-processing in cascades
  const processedSet = _processedSet || new Set<string>();
  if (processedSet.has(workUnitId)) return null;
  processedSet.add(workUnitId);

  const workUnit = await db.workUnit.findUnique({ where: { id: workUnitId } }) as any;
  if (!workUnit) return null;
  
  // EC4: Don't act on work units that are already cancelled/active/completed
  if (workUnit.status !== 'draft') return null;

  const conditions = parsePublishConditions(workUnit.publishConditions);
  if (!conditions) return null;

  // EC10: Only handle deps with 'failed' condition
  const dep = conditions.dependencies.find(d => d.workUnitId === failedDepWorkUnitId && d.condition === 'failed');
  if (!dep) return null;

  switch (dep.onFailure) {
    case 'cancel': {
      await db.workUnit.update({
        where: { id: workUnitId },
        data: { status: 'cancelled' },
      });
      // Refund escrow
      await db.escrow.updateMany({
        where: { workUnitId, status: { in: ['pending', 'funded'] } },
        data: { status: 'refunded', releasedAt: new Date() },
      });

      // EC2/EC9: Cascade cancel to downstream dependents
      const downstreamDependents = await getDependentWorkUnits(workUnitId);
      for (const downstream of downstreamDependents) {
        if (downstream.status === 'draft') {
          await handleDependencyFailure(downstream.id, workUnitId, processedSet);
        }
      }

      return { action: 'cancelled', message: `"${workUnit.title}" was cancelled because dependency failed (cascade)` };
    }

    case 'notify': {
      // Check if we already sent a notification for this exact failure (EC4: avoid duplicates)
      try {
        const existingNotif = await (db.notification as any).findFirst({
          where: {
            type: 'dependency_failed',
            data: { path: ['workUnitId'], equals: workUnitId },
          },
          orderBy: { createdAt: 'desc' },
        });
        // If already notified within the last hour, skip
        if (existingNotif && Date.now() - new Date(existingNotif.createdAt).getTime() < 3600000) {
          return { action: 'already_notified', message: `Already notified about "${workUnit.title}" — skipping` };
        }
      } catch {
        // Notification query failed — proceed to send anyway
      }

      try {
        const company = await db.companyProfile.findUnique({
          where: { id: workUnit.companyId },
          include: { user: { select: { clerkId: true } } },
        });
        if (company?.user?.clerkId) {
          await db.notification.create({
            data: {
              userId: company.user.clerkId,
              userType: 'company',
              type: 'dependency_failed',
              title: 'Dependency Failed — Action Required',
              body: `A dependency for "${workUnit.title}" has failed. Please decide whether to publish, cancel, or wait.`,
              data: { workUnitId, failedDepWorkUnitId },
              channels: ['in_app'],
            },
          });
        }
      } catch (err) {
        console.error('[PublishConditions] Failed to send notification:', err);
      }
      return { action: 'notified', message: `Company notified about dependency failure for "${workUnit.title}"` };
    }

    case 'publish':
      // evaluatePublishConditions already handles this by setting met=true
      return { action: 'publish', message: `"${workUnit.title}" will publish despite dependency failure` };

    default:
      return null;
  }
}
