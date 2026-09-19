/**
 * Centralised AI pricing.
 *
 * Model prices change. They are declared here once, versioned by effective
 * date, and every cost figure in the product is derived from this table via
 * `estimateCostUsd`. No price literal may appear anywhere else in the codebase.
 */

export interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  inputPerMillionUsd: number;
  /** USD per 1,000,000 cached input tokens (prompt caching). */
  cachedInputPerMillionUsd: number;
  /** USD per 1,000,000 output tokens. Includes reasoning tokens when billed as output. */
  outputPerMillionUsd: number;
  /** ISO date this price schedule took effect, for auditability. */
  effectiveFrom: string;
}

/**
 * Bumped whenever any price below changes.
 *
 * Every ledger row stores the version that priced it, so a historical cost can
 * be re-derived exactly as it was computed. Re-pricing history with today's
 * table would silently rewrite what a customer was told they spent.
 */
export const PRICING_VERSION = '2026.01';

export const DEFAULT_ANSWER_MODEL = 'gpt-5.6-luna';
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-5.6-luna': {
    inputPerMillionUsd: 0.2,
    cachedInputPerMillionUsd: 0.02,
    outputPerMillionUsd: 1.2,
    effectiveFrom: '2026-01-01',
  },
  'text-embedding-3-small': {
    inputPerMillionUsd: 0.02,
    cachedInputPerMillionUsd: 0.02,
    outputPerMillionUsd: 0,
    effectiveFrom: '2026-01-01',
  },
  'text-embedding-3-large': {
    inputPerMillionUsd: 0.13,
    cachedInputPerMillionUsd: 0.13,
    outputPerMillionUsd: 0,
    effectiveFrom: '2026-01-01',
  },
};

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}

/**
 * Returns the cost in USD for a single model call. Cached input tokens are
 * billed at the cached rate and are assumed to be a *subset* of inputTokens,
 * which is how the OpenAI Responses API reports them.
 */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const uncached = Math.max(usage.inputTokens - cached, 0);
  const output = usage.outputTokens ?? 0;
  const cost =
    (uncached * pricing.inputPerMillionUsd) / 1_000_000 +
    (cached * pricing.cachedInputPerMillionUsd) / 1_000_000 +
    (output * pricing.outputPerMillionUsd) / 1_000_000;
  // Store to micro-dollar precision; cheaper calls must not round to zero.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function isPricedModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODEL_PRICING, model);
}

/** Planning budget used by the cost alerting job in /admin. */
export const COST_BASELINE = {
  /** Expected average cost of one ordinary recipient question, in USD. */
  targetCostPerQuestionUsd: 0.00162,
  /** Alert when the rolling average exceeds this multiple of the target. */
  alertMultiplier: 2.5,
  /** Expected input tokens for an ordinary question. */
  targetInputTokens: 6_000,
  /** Expected output tokens for an ordinary answer. */
  targetOutputTokens: 350,
} as const;
