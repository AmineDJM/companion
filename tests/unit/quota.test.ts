import { describe, expect, it } from 'vitest';
import {
  PLAN_DEFINITIONS,
  adjustmentAppliesToCycle,
  analyticsAtLeast,
  calendarCycle,
  computeCompanionSlots,
  computeQuotaState,
  consumesCompanionSlot,
  isWithinCycle,
  mergeEntitlements,
  type Entitlements,
} from '@companion/shared';

describe('question quota', () => {
  it('sums plan allowance, purchases and admin grants', () => {
    const state = computeQuotaState({
      planAllowance: 5_000,
      purchased: 2_500,
      adjustments: 1_000,
      consumed: 1_200,
    });
    expect(state.effectiveAllowance).toBe(8_500);
    expect(state.remaining).toBe(7_300);
    expect(state.exhausted).toBe(false);
  });

  it('reproduces the documented support scenario', () => {
    // 5,000 plan allowance plus a 2,500 support grant is 7,500 effective.
    const state = computeQuotaState({
      planAllowance: 5_000,
      purchased: 0,
      adjustments: 2_500,
      consumed: 0,
    });
    expect(state.effectiveAllowance).toBe(7_500);
  });

  it('never reports negative remaining when usage overshoots', () => {
    const state = computeQuotaState({
      planAllowance: 50,
      purchased: 0,
      adjustments: 0,
      consumed: 80,
    });
    expect(state.remaining).toBe(0);
    expect(state.exhausted).toBe(true);
    expect(state.utilisation).toBe(1);
  });

  it('treats a deduction that wipes the allowance as exhausted', () => {
    const state = computeQuotaState({
      planAllowance: 1_000,
      purchased: 0,
      adjustments: -1_000,
      consumed: 0,
    });
    expect(state.effectiveAllowance).toBe(0);
    expect(state.exhausted).toBe(true);
  });

  it('never lets adjustments push the allowance below zero', () => {
    const state = computeQuotaState({
      planAllowance: 100,
      purchased: 0,
      adjustments: -5_000,
      consumed: 0,
    });
    expect(state.effectiveAllowance).toBe(0);
  });
});

describe('companion slots', () => {
  it('counts draft, processing, active, paused and failed against the limit', () => {
    for (const status of ['DRAFT', 'PROCESSING', 'ACTIVE', 'PAUSED', 'FAILED'] as const) {
      expect(consumesCompanionSlot(status)).toBe(true);
    }
  });

  it('frees the slot for archived and revoked companions', () => {
    expect(consumesCompanionSlot('ARCHIVED')).toBe(false);
    expect(consumesCompanionSlot('REVOKED')).toBe(false);
  });

  it('reports exhaustion at the limit', () => {
    const slots = computeCompanionSlots(3, PLAN_DEFINITIONS.free.entitlements);
    expect(slots).toEqual({ used: 3, limit: 3, remaining: 0, exhausted: true });
  });

  it('never exhausts an unlimited plan', () => {
    const slots = computeCompanionSlots(50_000, PLAN_DEFINITIONS.business.entitlements);
    expect(slots.limit).toBeNull();
    expect(slots.exhausted).toBe(false);
  });
});

describe('billing cycle', () => {
  it('rolls on the signup anchor day', () => {
    const cycle = calendarCycle(new Date('2026-01-10T00:00:00Z'), new Date('2026-06-15T00:00:00Z'));
    expect(cycle.start.toISOString().slice(0, 10)).toBe('2026-06-10');
    expect(cycle.end.toISOString().slice(0, 10)).toBe('2026-07-10');
  });

  it('steps back a month when the anchor day has not arrived yet', () => {
    const cycle = calendarCycle(new Date('2026-01-25T00:00:00Z'), new Date('2026-06-10T00:00:00Z'));
    expect(cycle.start.toISOString().slice(0, 10)).toBe('2026-05-25');
  });

  it('clamps a 31st anchor into a short month', () => {
    const cycle = calendarCycle(new Date('2026-01-31T00:00:00Z'), new Date('2026-02-28T00:00:00Z'));
    expect(cycle.start.getUTCMonth()).toBe(1);
    expect(cycle.start.getUTCDate()).toBeLessThanOrEqual(28);
  });

  it('treats the cycle as half-open', () => {
    const cycle = calendarCycle(new Date('2026-01-01T00:00:00Z'), new Date('2026-06-15T00:00:00Z'));
    expect(isWithinCycle(cycle.start, cycle)).toBe(true);
    expect(isWithinCycle(cycle.end, cycle)).toBe(false);
  });
});

describe('adjustment applicability', () => {
  const cycle = {
    start: new Date('2026-06-01T00:00:00Z'),
    end: new Date('2026-07-01T00:00:00Z'),
  };
  const now = new Date('2026-06-15T00:00:00Z');

  it('applies a one-off grant made inside the cycle', () => {
    expect(
      adjustmentAppliesToCycle(
        { createdAt: new Date('2026-06-05T00:00:00Z'), expiresAt: null, recurring: false },
        cycle,
        now,
      ),
    ).toBe(true);
  });

  it('does not carry a one-off grant into the next cycle', () => {
    expect(
      adjustmentAppliesToCycle(
        { createdAt: new Date('2026-05-05T00:00:00Z'), expiresAt: null, recurring: false },
        cycle,
        now,
      ),
    ).toBe(false);
  });

  it('carries a recurring grant forward', () => {
    expect(
      adjustmentAppliesToCycle(
        { createdAt: new Date('2026-01-05T00:00:00Z'), expiresAt: null, recurring: true },
        cycle,
        now,
      ),
    ).toBe(true);
  });

  it('stops applying an expired grant', () => {
    expect(
      adjustmentAppliesToCycle(
        {
          createdAt: new Date('2026-06-05T00:00:00Z'),
          expiresAt: new Date('2026-06-10T00:00:00Z'),
          recurring: true,
        },
        cycle,
        now,
      ),
    ).toBe(false);
  });
});

describe('entitlement resolution', () => {
  it('lets a later override win', () => {
    const merged = mergeEntitlements(PLAN_DEFINITIONS.free.entitlements, {
      monthlyQuestions: 10_000,
    });
    expect(merged.monthlyQuestions).toBe(10_000);
    expect(merged.maxActiveCompanions).toBe(3);
  });

  it('ignores an empty or absent override', () => {
    const base = PLAN_DEFINITIONS.pro.entitlements;
    expect(mergeEntitlements(base, null, undefined, {})).toEqual(base);
  });

  it('applies overrides in order', () => {
    const merged = mergeEntitlements(
      PLAN_DEFINITIONS.free.entitlements,
      { monthlyQuestions: 500 },
      { monthlyQuestions: 900 },
    );
    expect(merged.monthlyQuestions).toBe(900);
  });

  it('keeps plan tiers strictly increasing on the headline limits', () => {
    const order: Entitlements[] = [
      PLAN_DEFINITIONS.free.entitlements,
      PLAN_DEFINITIONS.personal.entitlements,
      PLAN_DEFINITIONS.pro.entitlements,
      PLAN_DEFINITIONS.business.entitlements,
    ];
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index]!.monthlyQuestions).toBeGreaterThan(order[index - 1]!.monthlyQuestions);
      expect(order[index]!.storageBytes).toBeGreaterThan(order[index - 1]!.storageBytes);
    }
  });

  it('ranks analytics levels', () => {
    expect(analyticsAtLeast('advanced', 'full')).toBe(true);
    expect(analyticsAtLeast('basic', 'full')).toBe(false);
    expect(analyticsAtLeast('full', 'full')).toBe(true);
  });
});
