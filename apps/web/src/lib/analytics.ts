/**
 * Figwork Analytics Module
 *
 * Lightweight wrapper around analytics providers (PostHog, Mixpanel, etc.).
 * Currently logs to console in development. In production, wire up the
 * provider of your choice by implementing the `send()` function.
 *
 * Usage:
 *   import { track, identify, page } from '@/lib/analytics';
 *   track('task_accepted', { workUnitId: '...', category: 'data_entry' });
 *   identify(userId, { tier: 'pro', email: 'user@example.com' });
 */

// ─── Configuration ───────────────────────────────────────────────────
const IS_DEV = process.env.NODE_ENV === 'development';
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || '';

// ─── Core events ─────────────────────────────────────────────────────
export const EVENTS = {
  // Auth
  SIGN_UP: 'sign_up',
  SIGN_IN: 'sign_in',

  // Onboarding
  ONBOARDING_STARTED: 'onboarding_started',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',
  ONBOARDING_COMPLETED: 'onboarding_completed',

  // Tasks
  TASK_VIEWED: 'task_viewed',
  TASK_ACCEPTED: 'task_accepted',
  TASK_CLOCKED_IN: 'task_clocked_in',
  TASK_CLOCKED_OUT: 'task_clocked_out',
  TASK_SUBMITTED: 'task_submitted',
  TASK_APPROVED: 'task_approved',

  // Company
  WORK_UNIT_CREATED: 'work_unit_created',
  WORK_UNIT_PUBLISHED: 'work_unit_published',
  SUBMISSION_REVIEWED: 'submission_reviewed',

  // POW
  POW_SUBMITTED: 'pow_submitted',

  // Payouts
  PAYOUT_REQUESTED: 'payout_requested',

  // Marketplace
  MARKETPLACE_SEARCH: 'marketplace_search',
  MARKETPLACE_FILTER: 'marketplace_filter',

  // Disputes
  DISPUTE_FILED: 'dispute_filed',

  // Pages
  PAGE_VIEW: 'page_view',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

// ─── Internal transport ──────────────────────────────────────────────
function send(eventName: string, properties?: Record<string, unknown>) {
  if (IS_DEV) {
    // eslint-disable-next-line no-console
    console.debug('[Analytics]', eventName, properties);
    return;
  }

  // PostHog integration (uncomment when NEXT_PUBLIC_POSTHOG_KEY is set)
  // if (typeof window !== 'undefined' && (window as any).posthog) {
  //   (window as any).posthog.capture(eventName, properties);
  // }

  // Mixpanel integration (uncomment if using Mixpanel)
  // if (typeof window !== 'undefined' && (window as any).mixpanel) {
  //   (window as any).mixpanel.track(eventName, properties);
  // }
}

// ─── Public API ──────────────────────────────────────────────────────

/** Track a named event with optional properties */
export function track(event: EventName | string, properties?: Record<string, unknown>) {
  send(event, {
    ...properties,
    timestamp: new Date().toISOString(),
  });
}

/** Identify the current user for analytics */
export function identify(userId: string, traits?: Record<string, unknown>) {
  if (IS_DEV) {
    // eslint-disable-next-line no-console
    console.debug('[Analytics] identify', userId, traits);
    return;
  }

  // PostHog
  // if (typeof window !== 'undefined' && (window as any).posthog) {
  //   (window as any).posthog.identify(userId, traits);
  // }
}

/** Track a page view */
export function page(name?: string, properties?: Record<string, unknown>) {
  send(EVENTS.PAGE_VIEW, {
    page: name || (typeof window !== 'undefined' ? window.location.pathname : ''),
    ...properties,
  });
}

/** Reset analytics identity (on sign-out) */
export function reset() {
  if (IS_DEV) {
    // eslint-disable-next-line no-console
    console.debug('[Analytics] reset');
    return;
  }

  // PostHog
  // if (typeof window !== 'undefined' && (window as any).posthog) {
  //   (window as any).posthog.reset();
  // }
}
