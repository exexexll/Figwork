// Pricing & Fee Configuration

import { TierName, TIER_CONFIG } from './tiers';

export interface VolumeDiscount {
  minMonthlySpendCents: number;
  discount: number;
}

export const PRICING_CONFIG = {
  // Platform fees (based on student tier)
  platformFees: {
    novice: 0.20, // 20% - higher fee for less experienced
    pro: 0.15, // 15% - standard fee
    elite: 0.10, // 10% - reduced fee for top performers
  } as Record<TierName, number>,

  // Minimum task price
  minTaskPriceInCents: 500, // $5 minimum

  // Maximum task price by tier
  maxTaskPriceByTier: {
    novice: 2500, // $25
    pro: 10000, // $100
    elite: null, // unlimited
  } as Record<TierName, number | null>,

  // Escrow requirements
  escrow: {
    requiredBeforeActivation: true,
    holdPeriodHours: 24, // Hold after completion before release
  },

  // Invoice settings
  invoicing: {
    billingCycle: 'monthly' as const,
    netTermsDays: 30,
    lateFeePercent: 0.015, // 1.5% monthly
  },

  // Volume discounts (for companies)
  volumeDiscounts: [
    { minMonthlySpendCents: 0, discount: 0 },
    { minMonthlySpendCents: 100000, discount: 0.05 }, // $1000+: 5% off
    { minMonthlySpendCents: 500000, discount: 0.10 }, // $5000+: 10% off
    { minMonthlySpendCents: 1000000, discount: 0.15 }, // $10000+: 15% off
  ] as VolumeDiscount[],

  // Instant payout fee (for students)
  instantPayoutFeePercent: 0.015, // 1.5%

  // Stripe fees (approximate, for cost calculations)
  stripeFees: {
    cardPercent: 0.029, // 2.9%
    cardFixed: 30, // $0.30
    achPercent: 0.008, // 0.8%
    achCap: 500, // $5 max
    transferPercent: 0.0025, // 0.25%
    transferMin: 25, // $0.25 min
  },
};

export interface PlatformFeeResult {
  feeInCents: number;
  netAmountInCents: number;
  feeRate: number;
}

/**
 * Calculate platform fee for a task
 */
export function calculatePlatformFee(
  taskAmountCents: number,
  studentTier: TierName,
  companyMonthlySpend: number = 0
): PlatformFeeResult {
  // Base fee rate from tier
  let feeRate = TIER_CONFIG[studentTier]?.benefits.platformFeePercent ?? 0.15;

  // Apply volume discount
  const volumeDiscount = PRICING_CONFIG.volumeDiscounts
    .filter((d) => companyMonthlySpend >= d.minMonthlySpendCents)
    .sort((a, b) => b.minMonthlySpendCents - a.minMonthlySpendCents)[0];

  if (volumeDiscount && volumeDiscount.discount > 0) {
    feeRate *= 1 - volumeDiscount.discount;
  }

  const feeInCents = Math.round(taskAmountCents * feeRate);
  const netAmountInCents = taskAmountCents - feeInCents;

  return { feeInCents, netAmountInCents, feeRate };
}

/**
 * Calculate student payout after platform fee
 */
export function calculateStudentPayout(
  taskAmountCents: number,
  studentTier: TierName,
  instantPayout: boolean = false
): {
  grossAmount: number;
  platformFee: number;
  instantFee: number;
  netAmount: number;
} {
  const platformFeeRate = TIER_CONFIG[studentTier]?.benefits.platformFeePercent ?? 0.15;
  const platformFee = Math.round(taskAmountCents * platformFeeRate);
  const afterPlatformFee = taskAmountCents - platformFee;

  let instantFee = 0;
  if (instantPayout) {
    instantFee = Math.round(afterPlatformFee * PRICING_CONFIG.instantPayoutFeePercent);
  }

  const netAmount = afterPlatformFee - instantFee;

  return {
    grossAmount: taskAmountCents,
    platformFee,
    instantFee,
    netAmount,
  };
}

/**
 * Get current volume discount tier
 */
export function getVolumeDiscountTier(monthlySpendCents: number): VolumeDiscount {
  return PRICING_CONFIG.volumeDiscounts
    .filter((d) => monthlySpendCents >= d.minMonthlySpendCents)
    .sort((a, b) => b.minMonthlySpendCents - a.minMonthlySpendCents)[0];
}

/**
 * Format cents to dollar string
 */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Validate task price against tier limits
 */
export function validateTaskPrice(
  priceInCents: number,
  studentTier: TierName
): { valid: boolean; error?: string } {
  if (priceInCents < PRICING_CONFIG.minTaskPriceInCents) {
    return {
      valid: false,
      error: `Minimum task price is ${formatCents(PRICING_CONFIG.minTaskPriceInCents)}`,
    };
  }

  const maxPrice = PRICING_CONFIG.maxTaskPriceByTier[studentTier];
  if (maxPrice !== null && priceInCents > maxPrice) {
    return {
      valid: false,
      error: `Maximum task price for ${studentTier} tier is ${formatCents(maxPrice)}`,
    };
  }

  return { valid: true };
}
