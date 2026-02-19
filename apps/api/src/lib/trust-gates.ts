/**
 * Trust Gates - Progressive trust system for student contractors
 * 
 * Gates:
 * 1. novice_probation (0-5 tasks) - Heavy restrictions, low-value tasks only
 * 2. novice_established (5-20 tasks) - Moderate restrictions
 * 3. pro (20+ tasks, promoted) - Standard access
 * 4. elite (50+ tasks, high quality) - Full access, premium tasks
 */

import { db } from '@figwork/db';

export type TrustGate = 'novice_probation' | 'novice_established' | 'pro' | 'elite';

export interface GateRestrictions {
  maxPriceInCents: number;
  maxConcurrentTasks: number;
  maxDeadlineHours: number;
  requiresScreeningInterview: boolean;
  allowedCategories: string[] | 'all';
  powFrequencyMinutes: number; // How often POW is required
  autoApprovalEnabled: boolean;
  instantPayoutEnabled: boolean;
}

export interface TrustStatus {
  gate: TrustGate;
  tier: string;
  tasksCompleted: number;
  restrictions: GateRestrictions;
  nextGate: TrustGate | null;
  tasksToNextGate: number;
  qualifyingMetrics: {
    avgQualityScore: number;
    onTimeRate: number;
    revisionRate: number;
    recentFailures: number;
  };
}

// Gate configurations
const GATE_CONFIG: Record<TrustGate, GateRestrictions> = {
  novice_probation: {
    maxPriceInCents: 5000, // $50 max
    maxConcurrentTasks: 1,
    maxDeadlineHours: 24,
    requiresScreeningInterview: true,
    allowedCategories: ['data_entry', 'writing', 'research', 'admin'],
    powFrequencyMinutes: 30, // Every 30 mins
    autoApprovalEnabled: false,
    instantPayoutEnabled: false,
  },
  novice_established: {
    maxPriceInCents: 15000, // $150 max
    maxConcurrentTasks: 2,
    maxDeadlineHours: 72,
    requiresScreeningInterview: true,
    allowedCategories: 'all',
    powFrequencyMinutes: 60, // Every hour
    autoApprovalEnabled: false,
    instantPayoutEnabled: false,
  },
  pro: {
    maxPriceInCents: 50000, // $500 max
    maxConcurrentTasks: 5,
    maxDeadlineHours: 168, // 1 week
    requiresScreeningInterview: false,
    allowedCategories: 'all',
    powFrequencyMinutes: 90,
    autoApprovalEnabled: true,
    instantPayoutEnabled: true,
  },
  elite: {
    maxPriceInCents: 200000, // $2000 max
    maxConcurrentTasks: 10,
    maxDeadlineHours: 720, // 30 days
    requiresScreeningInterview: false,
    allowedCategories: 'all',
    powFrequencyMinutes: 120, // Every 2 hours
    autoApprovalEnabled: true,
    instantPayoutEnabled: true,
  },
};

// Thresholds for tier promotion
const PROMOTION_THRESHOLDS = {
  novice_to_pro: {
    tasksCompleted: 20,
    avgQualityScore: 0.8,
    onTimeRate: 0.85,
    revisionRate: 0.3, // Max 30% revision rate
    maxRecentFailures: 1,
  },
  pro_to_elite: {
    tasksCompleted: 50,
    avgQualityScore: 0.9,
    onTimeRate: 0.95,
    revisionRate: 0.15, // Max 15% revision rate
    maxRecentFailures: 0,
  },
};

/**
 * Determine current trust gate based on tier and task count
 */
export function getTrustGate(tier: string, tasksCompleted: number): TrustGate {
  if (tier === 'elite') {
    return 'elite';
  }
  if (tier === 'pro') {
    return 'pro';
  }
  // Novice
  if (tasksCompleted < 5) {
    return 'novice_probation';
  }
  return 'novice_established';
}

/**
 * Get restrictions for a trust gate
 */
export function getGateRestrictions(gate: TrustGate): GateRestrictions {
  return GATE_CONFIG[gate];
}

/**
 * Check if a student can accept a specific work unit
 */
export async function checkWorkUnitEligibility(
  studentId: string,
  workUnit: {
    priceInCents: number;
    deadlineHours: number;
    category: string;
    minTier: string;
  }
): Promise<{
  eligible: boolean;
  reason?: string;
  gate: TrustGate;
}> {
  const student = await db.studentProfile.findUnique({
    where: { id: studentId },
  });

  if (!student) {
    return { eligible: false, reason: 'Student profile not found', gate: 'novice_probation' };
  }

  const gate = getTrustGate(student.tier, student.tasksCompleted);
  const restrictions = GATE_CONFIG[gate];

  // Check tier requirement
  const tierLevels: Record<string, number> = { novice: 1, pro: 2, elite: 3 };
  const studentLevel = tierLevels[student.tier] || 1;
  const requiredLevel = tierLevels[workUnit.minTier] || 1;

  if (studentLevel < requiredLevel) {
    return {
      eligible: false,
      reason: `Requires ${workUnit.minTier} tier (you are ${student.tier})`,
      gate,
    };
  }

  // Check price limit
  if (workUnit.priceInCents > restrictions.maxPriceInCents) {
    return {
      eligible: false,
      reason: `Task value exceeds your limit ($${(restrictions.maxPriceInCents / 100).toFixed(0)} max at ${gate} gate)`,
      gate,
    };
  }

  // Check deadline limit
  if (workUnit.deadlineHours > restrictions.maxDeadlineHours) {
    return {
      eligible: false,
      reason: `Deadline too long (${restrictions.maxDeadlineHours}h max at ${gate} gate)`,
      gate,
    };
  }

  // Check category restrictions
  if (restrictions.allowedCategories !== 'all') {
    if (!restrictions.allowedCategories.includes(workUnit.category)) {
      return {
        eligible: false,
        reason: `Category not allowed during probation. Complete ${5 - student.tasksCompleted} more tasks.`,
        gate,
      };
    }
  }

  // Check concurrent task limit
  const activeCount = await db.execution.count({
    where: {
      studentId,
      status: { in: ['accepted', 'clocked_in', 'submitted', 'revision_needed'] },
    },
  });

  if (activeCount >= restrictions.maxConcurrentTasks) {
    return {
      eligible: false,
      reason: `Concurrent task limit reached (${restrictions.maxConcurrentTasks} max at ${gate} gate)`,
      gate,
    };
  }

  return { eligible: true, gate };
}

/**
 * Get full trust status for a student
 */
export async function getTrustStatus(studentId: string): Promise<TrustStatus | null> {
  const student = await db.studentProfile.findUnique({
    where: { id: studentId },
  });

  if (!student) return null;

  const gate = getTrustGate(student.tier, student.tasksCompleted);
  const restrictions = GATE_CONFIG[gate];

  // Get recent failures
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentFailures = await db.execution.count({
    where: {
      studentId,
      status: { in: ['failed', 'disputed'] },
      assignedAt: { gte: thirtyDaysAgo },
    },
  });

  // Calculate next gate and tasks needed
  let nextGate: TrustGate | null = null;
  let tasksToNextGate = 0;

  if (gate === 'novice_probation') {
    nextGate = 'novice_established';
    tasksToNextGate = Math.max(0, 5 - student.tasksCompleted);
  } else if (gate === 'novice_established') {
    nextGate = 'pro';
    tasksToNextGate = Math.max(0, 20 - student.tasksCompleted);
  } else if (gate === 'pro') {
    nextGate = 'elite';
    tasksToNextGate = Math.max(0, 50 - student.tasksCompleted);
  }

  return {
    gate,
    tier: student.tier,
    tasksCompleted: student.tasksCompleted,
    restrictions,
    nextGate,
    tasksToNextGate,
    qualifyingMetrics: {
      avgQualityScore: student.avgQualityScore,
      onTimeRate: student.onTimeRate,
      revisionRate: student.revisionRate,
      recentFailures,
    },
  };
}

/**
 * Check if student qualifies for tier promotion
 */
export async function checkPromotionEligibility(studentId: string): Promise<{
  eligible: boolean;
  targetTier: string | null;
  reason?: string;
  missingCriteria?: string[];
}> {
  const student = await db.studentProfile.findUnique({
    where: { id: studentId },
  });

  if (!student) {
    return { eligible: false, targetTier: null, reason: 'Student not found' };
  }

  // Get recent failures
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentFailures = await db.execution.count({
    where: {
      studentId,
      status: { in: ['failed', 'disputed'] },
      assignedAt: { gte: thirtyDaysAgo },
    },
  });

  // Check novice -> pro
  if (student.tier === 'novice') {
    const thresholds = PROMOTION_THRESHOLDS.novice_to_pro;
    const missing: string[] = [];

    if (student.tasksCompleted < thresholds.tasksCompleted) {
      missing.push(`Complete ${thresholds.tasksCompleted - student.tasksCompleted} more tasks`);
    }
    if (student.avgQualityScore < thresholds.avgQualityScore) {
      missing.push(`Quality score needs ${Math.round(thresholds.avgQualityScore * 100)}% (currently ${Math.round(student.avgQualityScore * 100)}%)`);
    }
    if (student.onTimeRate < thresholds.onTimeRate) {
      missing.push(`On-time rate needs ${Math.round(thresholds.onTimeRate * 100)}% (currently ${Math.round(student.onTimeRate * 100)}%)`);
    }
    if (student.revisionRate > thresholds.revisionRate) {
      missing.push(`Revision rate needs below ${Math.round(thresholds.revisionRate * 100)}% (currently ${Math.round(student.revisionRate * 100)}%)`);
    }
    if (recentFailures > thresholds.maxRecentFailures) {
      missing.push(`Too many recent failures (${recentFailures})`);
    }

    if (missing.length === 0) {
      return { eligible: true, targetTier: 'pro' };
    }
    return { eligible: false, targetTier: 'pro', missingCriteria: missing };
  }

  // Check pro -> elite
  if (student.tier === 'pro') {
    const thresholds = PROMOTION_THRESHOLDS.pro_to_elite;
    const missing: string[] = [];

    if (student.tasksCompleted < thresholds.tasksCompleted) {
      missing.push(`Complete ${thresholds.tasksCompleted - student.tasksCompleted} more tasks`);
    }
    if (student.avgQualityScore < thresholds.avgQualityScore) {
      missing.push(`Quality score needs ${Math.round(thresholds.avgQualityScore * 100)}%`);
    }
    if (student.onTimeRate < thresholds.onTimeRate) {
      missing.push(`On-time rate needs ${Math.round(thresholds.onTimeRate * 100)}%`);
    }
    if (student.revisionRate > thresholds.revisionRate) {
      missing.push(`Revision rate needs below ${Math.round(thresholds.revisionRate * 100)}%`);
    }
    if (recentFailures > thresholds.maxRecentFailures) {
      missing.push(`No recent failures allowed`);
    }

    if (missing.length === 0) {
      return { eligible: true, targetTier: 'elite' };
    }
    return { eligible: false, targetTier: 'elite', missingCriteria: missing };
  }

  // Already elite
  return { eligible: false, targetTier: null, reason: 'Already at highest tier' };
}

/**
 * Promote a student to the next tier if eligible
 */
export async function promoteStudent(studentId: string): Promise<{
  success: boolean;
  newTier?: string;
  reason?: string;
}> {
  const eligibility = await checkPromotionEligibility(studentId);

  if (!eligibility.eligible || !eligibility.targetTier) {
    return {
      success: false,
      reason: eligibility.reason || eligibility.missingCriteria?.join(', '),
    };
  }

  await db.studentProfile.update({
    where: { id: studentId },
    data: {
      tier: eligibility.targetTier,
    },
  });

  return { success: true, newTier: eligibility.targetTier };
}
