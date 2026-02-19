// EXP (Experience Points) System

import { TierName, TIER_CONFIG, TIER_ORDER, getNextTier } from '../constants/tiers';

export interface ExpEvent {
  type: string;
  baseExp: number;
  multipliers: Record<string, number>;
}

export const EXP_EVENTS: Record<string, ExpEvent> = {
  task_completed: {
    type: 'task_completed',
    baseExp: 50,
    multipliers: {
      complexity_1: 1.0,
      complexity_2: 1.5,
      complexity_3: 2.0,
      complexity_4: 3.0,
      complexity_5: 4.0,
      first_submission_accepted: 1.25, // +25% if no revisions
      on_time: 1.1, // +10% if before deadline
    },
  },

  task_failed: {
    type: 'task_failed',
    baseExp: -100, // Penalty
    multipliers: {},
  },

  streak_bonus: {
    type: 'streak_bonus',
    baseExp: 10, // Per day of streak
    multipliers: {
      week_streak: 2.0, // 7+ days
      month_streak: 3.0, // 30+ days
    },
  },

  quality_bonus: {
    type: 'quality_bonus',
    baseExp: 25,
    multipliers: {
      perfect_score: 2.0, // 100% quality
    },
  },

  pow_compliance: {
    type: 'pow_compliance',
    baseExp: 5, // Per successful POW
    multipliers: {},
  },

  pow_failure: {
    type: 'pow_failure',
    baseExp: -25, // Penalty per missed/failed POW
    multipliers: {},
  },
};

export interface TaskExpParams {
  complexityScore: number;
  revisionCount: number;
  wasLate: boolean;
  qualityScore?: number;
}

/**
 * Calculate EXP earned for completing a task
 */
export function calculateTaskExp(params: TaskExpParams): number {
  const event = EXP_EVENTS.task_completed;
  let exp = event.baseExp;

  // Complexity multiplier
  const complexityKey = `complexity_${params.complexityScore}`;
  exp *= event.multipliers[complexityKey] || 1;

  // First submission bonus (no revisions)
  if (params.revisionCount === 0) {
    exp *= event.multipliers.first_submission_accepted;
  }

  // On-time bonus
  if (!params.wasLate) {
    exp *= event.multipliers.on_time;
  }

  // Quality bonus
  if (params.qualityScore !== undefined && params.qualityScore >= 1.0) {
    exp += EXP_EVENTS.quality_bonus.baseExp * EXP_EVENTS.quality_bonus.multipliers.perfect_score;
  } else if (params.qualityScore !== undefined && params.qualityScore >= 0.9) {
    exp += EXP_EVENTS.quality_bonus.baseExp;
  }

  return Math.round(exp);
}

/**
 * Calculate streak bonus EXP
 */
export function calculateStreakBonus(streakDays: number): number {
  if (streakDays <= 0) return 0;

  const event = EXP_EVENTS.streak_bonus;
  let multiplier = 1;

  if (streakDays >= 30) {
    multiplier = event.multipliers.month_streak;
  } else if (streakDays >= 7) {
    multiplier = event.multipliers.week_streak;
  }

  return Math.round(event.baseExp * multiplier);
}

/**
 * Calculate EXP penalty for failed task
 */
export function calculateFailurePenalty(): number {
  return EXP_EVENTS.task_failed.baseExp;
}

/**
 * Calculate EXP for POW compliance
 */
export function calculatePowExp(passed: boolean): number {
  return passed ? EXP_EVENTS.pow_compliance.baseExp : EXP_EVENTS.pow_failure.baseExp;
}

export interface StudentStats {
  totalExp: number;
  tasksCompleted: number;
  avgQualityScore: number;
  onTimeRate: number;
  tier: TierName;
}

/**
 * Check if student qualifies for tier upgrade
 */
export function checkTierUpgrade(student: StudentStats): TierName | null {
  const currentIndex = TIER_ORDER.indexOf(student.tier);
  if (currentIndex < 0 || currentIndex >= TIER_ORDER.length - 1) {
    return null; // Invalid tier or already max
  }

  const nextTier = getNextTier(student.tier);
  if (!nextTier) return null;

  const nextConfig = TIER_CONFIG[nextTier];

  // Check all requirements
  if (
    student.totalExp >= nextConfig.minExp &&
    student.tasksCompleted >= nextConfig.requirements.tasksCompleted &&
    student.avgQualityScore >= nextConfig.requirements.minQualityScore &&
    student.onTimeRate >= nextConfig.requirements.minOnTimeRate
  ) {
    return nextTier;
  }

  return null;
}

/**
 * Check if student should be demoted (for sustained poor performance)
 */
export function checkTierDowngrade(
  student: StudentStats,
  recentMetrics: {
    last30DaysQualityScore: number;
    last30DaysOnTimeRate: number;
    last30DaysFailures: number;
  }
): TierName | null {
  // Can't downgrade from novice
  if (student.tier === 'novice') return null;

  const currentConfig = TIER_CONFIG[student.tier];

  // Downgrade if recent performance is significantly below tier requirements
  const qualityThreshold = currentConfig.requirements.minQualityScore * 0.8;
  const onTimeThreshold = currentConfig.requirements.minOnTimeRate * 0.8;

  if (
    recentMetrics.last30DaysQualityScore < qualityThreshold ||
    recentMetrics.last30DaysOnTimeRate < onTimeThreshold ||
    recentMetrics.last30DaysFailures >= 3
  ) {
    const prevTierIndex = TIER_ORDER.indexOf(student.tier) - 1;
    if (prevTierIndex >= 0) {
      return TIER_ORDER[prevTierIndex];
    }
  }

  return null;
}

/**
 * Calculate progress to next tier as percentage
 */
export function calculateTierProgress(student: StudentStats): {
  expProgress: number;
  tasksProgress: number;
  qualityProgress: number;
  onTimeProgress: number;
  overallProgress: number;
} | null {
  const nextTier = getNextTier(student.tier);
  if (!nextTier) return null;

  const nextConfig = TIER_CONFIG[nextTier];
  const currentConfig = TIER_CONFIG[student.tier];

  const expRange = nextConfig.minExp - currentConfig.minExp;
  const expProgress = Math.min(1, (student.totalExp - currentConfig.minExp) / expRange);

  const tasksProgress =
    nextConfig.requirements.tasksCompleted > 0
      ? Math.min(1, student.tasksCompleted / nextConfig.requirements.tasksCompleted)
      : 1;

  const qualityProgress =
    nextConfig.requirements.minQualityScore > 0
      ? Math.min(1, student.avgQualityScore / nextConfig.requirements.minQualityScore)
      : 1;

  const onTimeProgress =
    nextConfig.requirements.minOnTimeRate > 0
      ? Math.min(1, student.onTimeRate / nextConfig.requirements.minOnTimeRate)
      : 1;

  // Overall is the minimum of all requirements
  const overallProgress = Math.min(expProgress, tasksProgress, qualityProgress, onTimeProgress);

  return {
    expProgress,
    tasksProgress,
    qualityProgress,
    onTimeProgress,
    overallProgress,
  };
}

/**
 * Get human-readable description of tier benefits
 */
export function describeTierBenefits(tier: TierName): string[] {
  const config = TIER_CONFIG[tier];
  const benefits: string[] = [];

  benefits.push(`Up to ${config.benefits.dailyTaskLimit} tasks per day`);
  benefits.push(`Task complexity up to level ${config.benefits.maxComplexity}`);

  if (config.benefits.maxPayoutPerTask) {
    benefits.push(`Tasks up to $${(config.benefits.maxPayoutPerTask / 100).toFixed(0)}`);
  } else {
    benefits.push('Unlimited task value');
  }

  benefits.push(`${(config.benefits.platformFeePercent * 100).toFixed(0)}% platform fee`);
  benefits.push(`POW check every ${config.benefits.powFrequency} minutes`);

  return benefits;
}
