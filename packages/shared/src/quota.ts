import type { CompanionStatus } from './constants.js';
import { QUOTA_CONSUMING_STATUSES } from './constants.js';
import type { Entitlements } from './entitlements.js';

/**
 * Question quota is ledger-based. The plan allowance, purchased packs and
 * admin bonuses are three separate sources that are summed; consumption is a
 * count of successful AI answers. Nothing is ever overwritten — granting extra
 * questions appends an adjustment, it never edits the consumed counter.
 */
export interface QuotaSources {
  /** Questions granted by the plan for the current billing cycle. */
  planAllowance: number;
  /** Questions from purchased packs that are valid in this cycle. */
  purchased: number;
  /** Net of admin bonuses and deductions valid in this cycle. */
  adjustments: number;
  /** Successful answers already produced in this cycle. */
  consumed: number;
}

export interface QuotaState extends QuotaSources {
  /** planAllowance + purchased + adjustments. */
  effectiveAllowance: number;
  /** Never negative. */
  remaining: number;
  exhausted: boolean;
  /** 0..1, clamped. Used for the usage meter. */
  utilisation: number;
}

export function computeQuotaState(sources: QuotaSources): QuotaState {
  const effectiveAllowance = Math.max(
    sources.planAllowance + sources.purchased + sources.adjustments,
    0,
  );
  const remaining = Math.max(effectiveAllowance - sources.consumed, 0);
  return {
    ...sources,
    effectiveAllowance,
    remaining,
    exhausted: remaining <= 0,
    utilisation:
      effectiveAllowance === 0 ? 1 : Math.min(sources.consumed / effectiveAllowance, 1),
  };
}

export function canAskQuestion(state: QuotaState): boolean {
  return !state.exhausted;
}

/** Companion slots: archived and revoked Companions do not occupy a slot. */
export function consumesCompanionSlot(status: CompanionStatus): boolean {
  return QUOTA_CONSUMING_STATUSES.includes(status);
}

export interface CompanionSlotState {
  used: number;
  limit: number | null;
  remaining: number | null;
  exhausted: boolean;
}

export function computeCompanionSlots(used: number, entitlements: Entitlements): CompanionSlotState {
  const limit = entitlements.maxActiveCompanions;
  if (limit === null) {
    return { used, limit: null, remaining: null, exhausted: false };
  }
  const remaining = Math.max(limit - used, 0);
  return { used, limit, remaining, exhausted: remaining <= 0 };
}

/**
 * Billing cycle boundaries. When Stripe reports a period we use it verbatim;
 * otherwise free workspaces roll on the calendar month from their signup day.
 */
export interface BillingCycle {
  start: Date;
  end: Date;
}

export function calendarCycle(anchor: Date, now: Date = new Date()): BillingCycle {
  const anchorDay = anchor.getUTCDate();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(anchorDay, daysInUtcMonth(now))),
  );
  if (start.getTime() > now.getTime()) {
    start.setUTCMonth(start.getUTCMonth() - 1);
    start.setUTCDate(Math.min(anchorDay, daysInUtcMonth(start)));
  }
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(Math.min(anchorDay, daysInUtcMonth(end)));
  return { start, end };
}

function daysInUtcMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

export function isWithinCycle(date: Date, cycle: BillingCycle): boolean {
  return date.getTime() >= cycle.start.getTime() && date.getTime() < cycle.end.getTime();
}

/**
 * An adjustment counts toward the current cycle when it has not expired and
 * either recurs every cycle or was created during this cycle.
 */
export function adjustmentAppliesToCycle(
  adjustment: { createdAt: Date; expiresAt: Date | null; recurring: boolean },
  cycle: BillingCycle,
  now: Date = new Date(),
): boolean {
  if (adjustment.expiresAt !== null && adjustment.expiresAt.getTime() <= now.getTime()) {
    return false;
  }
  if (adjustment.recurring) return adjustment.createdAt.getTime() < cycle.end.getTime();
  return isWithinCycle(adjustment.createdAt, cycle);
}
