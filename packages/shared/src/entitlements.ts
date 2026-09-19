import { z } from 'zod';
import type { AnalyticsLevel, PlanKey } from './constants.js';
import { ANALYTICS_LEVELS, PLAN_KEYS } from './constants.js';

/**
 * Entitlements describe *everything* a plan is allowed to do.
 *
 * Product code must never branch on a plan key. It asks the entitlement
 * resolver a question ("can this workspace use password protection?") and the
 * resolver merges: plan defaults -> admin plan overrides (DB) -> workspace
 * overrides (DB) -> feature flags.
 */
export const entitlementsSchema = z.object({
  /** Maximum number of quota-consuming Companions. `null` means unlimited (fair use). */
  maxActiveCompanions: z.number().int().positive().nullable(),
  /** AI questions included per billing cycle. */
  monthlyQuestions: z.number().int().nonnegative(),
  /** Largest single upload accepted, in bytes. */
  maxUploadBytes: z.number().int().positive(),
  /** Total stored bytes (originals + derived assets). */
  storageBytes: z.number().int().positive(),
  /** Files allowed inside a single Companion. */
  maxFilesPerCompanion: z.number().int().positive(),
  /** Seats in the workspace. */
  maxTeamMembers: z.number().int().positive(),
  analyticsLevel: z.enum(ANALYTICS_LEVELS),
  passwordProtection: z.boolean(),
  emailListAccess: z.boolean(),
  identifiedAccess: z.boolean(),
  customExpiration: z.boolean(),
  removeBranding: z.boolean(),
  customBranding: z.boolean(),
  replaceDocuments: z.boolean(),
  priorityProcessing: z.boolean(),
  customDomains: z.boolean(),
  apiAccess: z.boolean(),
});

export type Entitlements = z.infer<typeof entitlementsSchema>;
export type EntitlementKey = keyof Entitlements;

/** Partial overrides stored on plan records or per-workspace. */
export const entitlementOverrideSchema = entitlementsSchema.partial();
export type EntitlementOverride = z.infer<typeof entitlementOverrideSchema>;

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  displayName: string;
  tagline: string;
  /** Price in minor units (cents) for a monthly subscription. */
  monthlyPriceCents: number;
  /** Price in minor units charged once per year. */
  annualPriceCents: number;
  currency: 'eur';
  sortOrder: number;
  /** Bullet points shown on the pricing page (plain product language, no AI jargon). */
  highlights: string[];
  entitlements: Entitlements;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

const FREE_ENTITLEMENTS: Entitlements = {
  maxActiveCompanions: 3,
  monthlyQuestions: 50,
  maxUploadBytes: 25 * MB,
  storageBytes: 500 * MB,
  maxFilesPerCompanion: 15,
  maxTeamMembers: 1,
  analyticsLevel: 'basic',
  passwordProtection: false,
  emailListAccess: false,
  identifiedAccess: false,
  customExpiration: false,
  removeBranding: false,
  customBranding: false,
  replaceDocuments: false,
  priorityProcessing: false,
  customDomains: false,
  apiAccess: false,
};

const PERSONAL_ENTITLEMENTS: Entitlements = {
  ...FREE_ENTITLEMENTS,
  maxActiveCompanions: 25,
  monthlyQuestions: 1_000,
  maxUploadBytes: 100 * MB,
  storageBytes: 10 * GB,
  maxFilesPerCompanion: 100,
  analyticsLevel: 'full',
  passwordProtection: true,
  emailListAccess: true,
  customExpiration: true,
  removeBranding: true,
};

const PRO_ENTITLEMENTS: Entitlements = {
  ...PERSONAL_ENTITLEMENTS,
  maxActiveCompanions: 150,
  monthlyQuestions: 5_000,
  maxUploadBytes: 500 * MB,
  storageBytes: 100 * GB,
  maxFilesPerCompanion: 400,
  maxTeamMembers: 3,
  analyticsLevel: 'advanced',
  customBranding: true,
  replaceDocuments: true,
  priorityProcessing: true,
};

const BUSINESS_ENTITLEMENTS: Entitlements = {
  ...PRO_ENTITLEMENTS,
  maxActiveCompanions: null,
  monthlyQuestions: 25_000,
  maxUploadBytes: 2 * GB,
  storageBytes: 1024 * GB,
  maxFilesPerCompanion: 2_000,
  maxTeamMembers: 25,
  identifiedAccess: true,
  customDomains: true,
  apiAccess: true,
};

export const PLAN_DEFINITIONS: Record<PlanKey, PlanDefinition> = {
  free: {
    key: 'free',
    name: 'free',
    displayName: 'Free',
    tagline: 'Everything you need to share your first documents.',
    monthlyPriceCents: 0,
    annualPriceCents: 0,
    currency: 'eur',
    sortOrder: 0,
    highlights: [
      '3 active Companions',
      '50 questions a month',
      'Basic analytics',
      'Expiration and revocation',
      'View-only sharing',
    ],
    entitlements: FREE_ENTITLEMENTS,
  },
  personal: {
    key: 'personal',
    name: 'personal',
    displayName: 'Personal',
    tagline: 'For people who share documents every week.',
    monthlyPriceCents: 900,
    annualPriceCents: 8_640,
    currency: 'eur',
    sortOrder: 1,
    highlights: [
      '25 active Companions',
      '1,000 questions a month',
      'Full analytics',
      'Password protection',
      'Custom expiration',
      'Remove Companion branding',
    ],
    entitlements: PERSONAL_ENTITLEMENTS,
  },
  pro: {
    key: 'pro',
    name: 'pro',
    displayName: 'Pro',
    tagline: 'For teams sending proposals, decks and data rooms.',
    monthlyPriceCents: 2_400,
    annualPriceCents: 23_040,
    currency: 'eur',
    sortOrder: 2,
    highlights: [
      '150 active Companions',
      '5,000 questions a month',
      'Advanced analytics',
      'Your own branding',
      'Replace documents without changing the link',
      'Priority processing',
    ],
    entitlements: PRO_ENTITLEMENTS,
  },
  business: {
    key: 'business',
    name: 'business',
    displayName: 'Business',
    tagline: 'For organisations that share confidential material at scale.',
    monthlyPriceCents: 7_900,
    annualPriceCents: 75_840,
    currency: 'eur',
    sortOrder: 3,
    highlights: [
      'Unlimited Companions (fair use)',
      '25,000 questions a month',
      'Team workspace',
      'Custom domains',
      'Identified access',
      'Advanced engagement analytics',
    ],
    entitlements: BUSINESS_ENTITLEMENTS,
  },
};

export const ANNUAL_DISCOUNT_RATE = 0.2;

/** Monthly-equivalent price of the annual plan, in cents (for display only). */
export function annualMonthlyEquivalentCents(plan: PlanDefinition): number {
  return Math.round(plan.annualPriceCents / 12);
}

export function listPlans(): PlanDefinition[] {
  return PLAN_KEYS.map((key) => PLAN_DEFINITIONS[key]).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function isPlanKey(value: string): value is PlanKey {
  return (PLAN_KEYS as readonly string[]).includes(value);
}

const ANALYTICS_RANK: Record<AnalyticsLevel, number> = { basic: 0, full: 1, advanced: 2 };

/**
 * Merge a chain of partial overrides on top of a base entitlement set.
 * Later sources win. Analytics level takes the *highest* level seen so a
 * workspace override can only ever be an explicit downgrade if stated last.
 */
export function mergeEntitlements(
  base: Entitlements,
  ...overrides: (EntitlementOverride | null | undefined)[]
): Entitlements {
  let result: Entitlements = { ...base };
  for (const override of overrides) {
    if (!override) continue;
    result = { ...result, ...stripUndefined(override) };
  }
  return result;
}

function stripUndefined(input: EntitlementOverride): EntitlementOverride {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as EntitlementOverride;
}

export function analyticsAtLeast(actual: AnalyticsLevel, required: AnalyticsLevel): boolean {
  return ANALYTICS_RANK[actual] >= ANALYTICS_RANK[required];
}

/**
 * Presentation helpers.
 *
 * Product capability must always come from resolved entitlements — never from
 * a plan key. These two helpers exist so the handful of *presentational* and
 * *billing-flow* comparisons that genuinely need the key live in one audited
 * place rather than being scattered through components.
 */

/** True for the plan that has no Stripe price and therefore no checkout. */
export function isFreePlan(planKey: string): boolean {
  return planKey === 'free';
}

/** The plan highlighted on the pricing page. Marketing emphasis only. */
export function isFeaturedPlan(planKey: string): boolean {
  return planKey === 'pro';
}
