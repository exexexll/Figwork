// Tier System Configuration

export type TierName = 'novice' | 'pro' | 'elite';

export interface TierBenefits {
  dailyTaskLimit: number;
  maxComplexity: number;
  maxPayoutPerTask: number | null; // null = unlimited
  powFrequency: number; // minutes
  platformFeePercent: number;
}

export interface TierRequirements {
  tasksCompleted: number;
  minQualityScore: number;
  minOnTimeRate: number;
}

export interface TierConfig {
  name: string;
  minExp: number;
  maxExp: number;
  color: string;
  benefits: TierBenefits;
  requirements: TierRequirements;
}

export const TIER_CONFIG: Record<TierName, TierConfig> = {
  novice: {
    name: 'Novice',
    minExp: 0,
    maxExp: 499,
    color: '#6B7280', // gray
    benefits: {
      dailyTaskLimit: 3,
      maxComplexity: 2,
      maxPayoutPerTask: 2500, // $25
      powFrequency: 30, // minutes
      platformFeePercent: 0.20, // 20%
    },
    requirements: {
      tasksCompleted: 0,
      minQualityScore: 0,
      minOnTimeRate: 0,
    },
  },

  pro: {
    name: 'Pro',
    minExp: 500,
    maxExp: 1999,
    color: '#3B82F6', // blue
    benefits: {
      dailyTaskLimit: 7,
      maxComplexity: 4,
      maxPayoutPerTask: 10000, // $100
      powFrequency: 45,
      platformFeePercent: 0.15, // 15%
    },
    requirements: {
      tasksCompleted: 10,
      minQualityScore: 0.80,
      minOnTimeRate: 0.85,
    },
  },

  elite: {
    name: 'Elite',
    minExp: 2000,
    maxExp: Infinity,
    color: '#F59E0B', // gold
    benefits: {
      dailyTaskLimit: 15,
      maxComplexity: 5,
      maxPayoutPerTask: null, // unlimited
      powFrequency: 60, // or opt-out
      platformFeePercent: 0.10, // 10%
    },
    requirements: {
      tasksCompleted: 50,
      minQualityScore: 0.90,
      minOnTimeRate: 0.95,
    },
  },
};

export const TIER_ORDER: TierName[] = ['novice', 'pro', 'elite'];

export function getNextTier(currentTier: TierName): TierName | null {
  const currentIndex = TIER_ORDER.indexOf(currentTier);
  if (currentIndex < 0 || currentIndex >= TIER_ORDER.length - 1) {
    return null;
  }
  return TIER_ORDER[currentIndex + 1];
}

export function getPreviousTier(currentTier: TierName): TierName | null {
  const currentIndex = TIER_ORDER.indexOf(currentTier);
  if (currentIndex <= 0) {
    return null;
  }
  return TIER_ORDER[currentIndex - 1];
}
