/**
 * Early Warning System - Proactive detection of at-risk executions
 * 
 * Detects:
 * 1. Deadline risk - approaching deadline with incomplete progress
 * 2. Inactivity - no clock-ins or POW submissions
 * 3. POW failure patterns - repeated POW issues
 * 4. Milestone misses - behind on milestone schedule
 * 5. Quality concerns - early indicators of quality issues
 */

import { db } from '@figwork/db';
import { notificationQueue } from './queues.js';

export type WarningType = 
  | 'deadline_risk'
  | 'inactivity'
  | 'pow_failure_pattern'
  | 'milestone_miss'
  | 'quality_concern';

export type WarningLevel = 'low' | 'medium' | 'high' | 'critical';

export interface Warning {
  type: WarningType;
  level: WarningLevel;
  executionId: string;
  studentId: string;
  companyId: string;
  message: string;
  details: Record<string, unknown>;
  suggestedAction: string;
  createdAt: Date;
}

export interface WarningCheckResult {
  hasWarnings: boolean;
  warnings: Warning[];
}

/**
 * Check 1: Deadline Risk
 * Approaching deadline with incomplete milestones
 */
async function checkDeadlineRisk(
  execution: {
    id: string;
    studentId: string;
    deadlineAt: Date;
    submittedAt: Date | null;
    completedAt: Date | null;
    companyId: string;
    milestones: Array<{ completedAt: Date | null }>;
  }
): Promise<Warning | null> {
  // Already submitted or completed
  if (execution.submittedAt || execution.completedAt) return null;

  const now = new Date();
  const deadline = new Date(execution.deadlineAt);
  const hoursRemaining = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
  
  if (hoursRemaining < 0) return null; // Already past deadline - that's a different check

  const totalMilestones = execution.milestones.length;
  const completedMilestones = execution.milestones.filter(
    (m: { completedAt: Date | null }) => m.completedAt !== null
  ).length;
  const progress = totalMilestones > 0 ? completedMilestones / totalMilestones : 0;

  let level: WarningLevel = 'low';
  let message = '';

  if (hoursRemaining < 2 && progress < 0.8) {
    level = 'critical';
    message = `Deadline in ${Math.round(hoursRemaining)}h with only ${Math.round(progress * 100)}% complete`;
  } else if (hoursRemaining < 6 && progress < 0.6) {
    level = 'high';
    message = `Deadline in ${Math.round(hoursRemaining)}h, progress at ${Math.round(progress * 100)}%`;
  } else if (hoursRemaining < 12 && progress < 0.3) {
    level = 'medium';
    message = `Deadline in ${Math.round(hoursRemaining)}h, only ${Math.round(progress * 100)}% done`;
  } else {
    return null;
  }

  return {
    type: 'deadline_risk',
    level,
    executionId: execution.id,
    studentId: execution.studentId,
    companyId: execution.companyId,
    message,
    details: {
      hoursRemaining,
      progress,
      completedMilestones,
      totalMilestones,
    },
    suggestedAction: level === 'critical'
      ? 'Contact student immediately or prepare for reassignment'
      : 'Send reminder to student about deadline',
    createdAt: new Date(),
  };
}

/**
 * Check 2: Inactivity
 * No clock-ins or submissions for extended period
 */
async function checkInactivity(
  execution: {
    id: string;
    studentId: string;
    status: string;
    clockedInAt: Date | null;
    assignedAt: Date;
    companyId: string;
  }
): Promise<Warning | null> {
  if (['submitted', 'approved', 'failed', 'cancelled'].includes(execution.status)) {
    return null; // Already submitted or terminal
  }

  const lastActivity = execution.clockedInAt || execution.assignedAt;
  const hoursSinceLastActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);

  // Check if never clocked in
  if (!execution.clockedInAt) {
    const hoursSinceAssignment = (Date.now() - execution.assignedAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceAssignment > 24) {
      return {
        type: 'inactivity',
        level: hoursSinceAssignment > 48 ? 'high' : 'medium',
        executionId: execution.id,
        studentId: execution.studentId,
        companyId: execution.companyId,
        message: `Task assigned ${Math.round(hoursSinceAssignment)}h ago but never started`,
        details: { hoursSinceAssignment, hasEverClockedIn: false },
        suggestedAction: 'Send start reminder to student',
        createdAt: new Date(),
      };
    }
    return null;
  }

  let level: WarningLevel | null = null;
  if (hoursSinceLastActivity > 48) {
    level = 'high';
  } else if (hoursSinceLastActivity > 24) {
    level = 'medium';
  } else if (hoursSinceLastActivity > 12) {
    level = 'low';
  }

  if (!level) return null;

  return {
    type: 'inactivity',
    level,
    executionId: execution.id,
    studentId: execution.studentId,
    companyId: execution.companyId,
    message: `No activity for ${Math.round(hoursSinceLastActivity)}h`,
    details: { hoursSinceLastActivity },
    suggestedAction: 'Check on student progress',
    createdAt: new Date(),
  };
}

/**
 * Check 3: POW Failure Pattern
 * Multiple POW issues in a short period
 */
async function checkPOWFailurePattern(
  execution: {
    id: string;
    studentId: string;
    companyId: string;
  }
): Promise<Warning | null> {
  const recentPOWs = await db.proofOfWorkLog.findMany({
    where: {
      executionId: execution.id,
      requestedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24h
    },
    orderBy: { requestedAt: 'desc' },
  });

  const failedPOWs = recentPOWs.filter((p: typeof recentPOWs[number]) => p.status === 'rejected');
  const missedPOWs = recentPOWs.filter((p: typeof recentPOWs[number]) => p.status === 'missed');
  const totalIssues = failedPOWs.length + missedPOWs.length;

  if (totalIssues < 2) return null;

  let level: WarningLevel;
  if (totalIssues >= 4 || missedPOWs.length >= 2) {
    level = 'high';
  } else if (totalIssues >= 3) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return {
    type: 'pow_failure_pattern',
    level,
    executionId: execution.id,
    studentId: execution.studentId,
    companyId: execution.companyId,
    message: `${totalIssues} POW issues in last 24h (${failedPOWs.length} failed, ${missedPOWs.length} missed)`,
    details: {
      failedCount: failedPOWs.length,
      missedCount: missedPOWs.length,
      recentPOWIds: recentPOWs.map((p: typeof recentPOWs[number]) => p.id),
    },
    suggestedAction: 'Review POW submissions for potential fraud',
    createdAt: new Date(),
  };
}

/**
 * Check 4: Milestone Miss
 * Behind on milestone schedule based on MilestoneTemplate.expectedCompletion
 */
async function checkMilestoneMiss(
  execution: {
    id: string;
    studentId: string;
    deadlineAt: Date;
    assignedAt: Date;
    companyId: string;
    milestones: Array<{ completedAt: Date | null; templateId: string }>;
  }
): Promise<Warning | null> {
  if (execution.milestones.length === 0) return null;

  const now = Date.now();
  const start = execution.assignedAt.getTime();
  const end = new Date(execution.deadlineAt).getTime();
  const totalDuration = end - start;
  const elapsed = now - start;
  const progressRatio = Math.min(1, elapsed / totalDuration);

  // Expected milestones completed by now (proportional to time)
  const expectedMilestone = Math.floor(progressRatio * execution.milestones.length);
  const completedMilestones = execution.milestones.filter(
    (m: { completedAt: Date | null }) => m.completedAt !== null
  ).length;
  const behind = expectedMilestone - completedMilestones;

  if (behind <= 0) return null;

  let level: WarningLevel;
  if (behind >= 3) {
    level = 'high';
  } else if (behind >= 2) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return {
    type: 'milestone_miss',
    level,
    executionId: execution.id,
    studentId: execution.studentId,
    companyId: execution.companyId,
    message: `${behind} milestone(s) behind schedule`,
    details: {
      expectedMilestone,
      completedMilestones,
      totalMilestones: execution.milestones.length,
      progressRatio,
    },
    suggestedAction: 'Check milestone progress and offer assistance',
    createdAt: new Date(),
  };
}

/**
 * Check all warnings for a single execution
 */
export async function checkExecutionWarnings(executionId: string): Promise<WarningCheckResult> {
  const execution = await db.execution.findUnique({
    where: { id: executionId },
    include: {
      workUnit: { select: { companyId: true } },
      milestones: { select: { completedAt: true, templateId: true } },
    },
  });

  if (!execution) {
    return { hasWarnings: false, warnings: [] };
  }

  const warnings: Warning[] = [];
  const companyId = execution.workUnit.companyId;

  // Run all checks
  const deadlineWarning = await checkDeadlineRisk({
    id: execution.id,
    studentId: execution.studentId,
    deadlineAt: execution.deadlineAt,
    submittedAt: execution.submittedAt,
    completedAt: execution.completedAt,
    companyId,
    milestones: execution.milestones,
  });
  if (deadlineWarning) warnings.push(deadlineWarning);

  const inactivityWarning = await checkInactivity({
    id: execution.id,
    studentId: execution.studentId,
    status: execution.status,
    clockedInAt: execution.clockedInAt,
    assignedAt: execution.assignedAt,
    companyId,
  });
  if (inactivityWarning) warnings.push(inactivityWarning);

  const powWarning = await checkPOWFailurePattern({
    id: execution.id,
    studentId: execution.studentId,
    companyId,
  });
  if (powWarning) warnings.push(powWarning);

  const milestoneWarning = await checkMilestoneMiss({
    id: execution.id,
    studentId: execution.studentId,
    deadlineAt: execution.deadlineAt,
    assignedAt: execution.assignedAt,
    companyId,
    milestones: execution.milestones,
  });
  if (milestoneWarning) warnings.push(milestoneWarning);

  return {
    hasWarnings: warnings.length > 0,
    warnings,
  };
}

/**
 * Check all active executions and send notifications for high/critical warnings
 */
export async function runEarlyWarningCheck(): Promise<{
  executionsChecked: number;
  warningsFound: number;
  notificationsSent: number;
}> {
  const activeExecutions = await db.execution.findMany({
    where: {
      status: { in: ['accepted', 'clocked_in', 'revision_needed'] },
    },
    select: { id: true },
  });

  let warningsFound = 0;
  let notificationsSent = 0;

  for (const exec of activeExecutions) {
    const result = await checkExecutionWarnings(exec.id);
    warningsFound += result.warnings.length;

    // Send notifications for high/critical warnings
    const urgentWarnings = result.warnings.filter(w => 
      w.level === 'high' || w.level === 'critical'
    );

    for (const warning of urgentWarnings) {
      // Notify student
      await notificationQueue.add('send', {
        userId: warning.studentId,
        userType: 'student',
        type: 'early_warning',
        title: `⚠️ ${warning.type.replace(/_/g, ' ').toUpperCase()}`,
        body: warning.message,
        channels: ['in_app'],
        data: {
          executionId: warning.executionId,
          warningType: warning.type,
          level: warning.level,
        },
      });
      notificationsSent++;

      // Notify company for critical warnings
      if (warning.level === 'critical') {
        await notificationQueue.add('send', {
          userId: warning.companyId,
          userType: 'company',
          type: 'early_warning',
          title: `🚨 Critical: ${warning.type.replace(/_/g, ' ')}`,
          body: `${warning.message}. ${warning.suggestedAction}`,
          channels: ['in_app', 'email'],
          data: {
            executionId: warning.executionId,
            studentId: warning.studentId,
            warningType: warning.type,
            level: warning.level,
          },
        });
        notificationsSent++;
      }
    }
  }

  return {
    executionsChecked: activeExecutions.length,
    warningsFound,
    notificationsSent,
  };
}

/**
 * Get active warnings for a student
 */
export async function getStudentWarnings(studentId: string): Promise<Warning[]> {
  const executions = await db.execution.findMany({
    where: {
      studentId,
      status: { in: ['accepted', 'clocked_in', 'revision_needed'] },
    },
    select: { id: true },
  });

  const allWarnings: Warning[] = [];

  for (const exec of executions) {
    const result = await checkExecutionWarnings(exec.id);
    allWarnings.push(...result.warnings);
  }

  // Sort by level (critical first)
  const levelOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  allWarnings.sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);

  return allWarnings;
}

/**
 * Get active warnings for a company's work units
 */
export async function getCompanyWarnings(companyId: string): Promise<Warning[]> {
  const executions = await db.execution.findMany({
    where: {
      workUnit: { companyId },
      status: { in: ['accepted', 'clocked_in', 'revision_needed', 'submitted'] },
    },
    select: { id: true },
  });

  const allWarnings: Warning[] = [];

  for (const exec of executions) {
    const result = await checkExecutionWarnings(exec.id);
    allWarnings.push(...result.warnings);
  }

  // Sort by level (critical first)
  const levelOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  allWarnings.sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);

  return allWarnings;
}
