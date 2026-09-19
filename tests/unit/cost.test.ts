import { describe, expect, it } from 'vitest';
import {
  COST_BASELINE,
  DEFAULT_ANSWER_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  MODEL_PRICING,
  estimateCostUsd,
  isPricedModel,
} from '@companion/shared';

describe('cost estimation', () => {
  it('prices an ordinary question close to the planning target', () => {
    const cost = estimateCostUsd(DEFAULT_ANSWER_MODEL, {
      inputTokens: COST_BASELINE.targetInputTokens,
      outputTokens: COST_BASELINE.targetOutputTokens,
    });
    // 6,000 input at $0.20/M plus 350 output at $1.20/M.
    expect(cost).toBeCloseTo(0.00162, 5);
    expect(cost).toBeCloseTo(COST_BASELINE.targetCostPerQuestionUsd, 5);
  });

  it('bills cached input at the cached rate', () => {
    const uncached = estimateCostUsd(DEFAULT_ANSWER_MODEL, { inputTokens: 10_000 });
    const cached = estimateCostUsd(DEFAULT_ANSWER_MODEL, {
      inputTokens: 10_000,
      cachedInputTokens: 10_000,
    });
    expect(cached).toBeLessThan(uncached);
    expect(cached).toBeCloseTo((10_000 * 0.02) / 1_000_000, 8);
  });

  it('treats cached tokens as a subset of input, never as an addition', () => {
    const cost = estimateCostUsd(DEFAULT_ANSWER_MODEL, {
      inputTokens: 1_000,
      cachedInputTokens: 5_000,
    });
    const allCached = estimateCostUsd(DEFAULT_ANSWER_MODEL, {
      inputTokens: 1_000,
      cachedInputTokens: 1_000,
    });
    expect(cost).toBe(allCached);
  });

  it('prices embeddings at the documented rate', () => {
    // 1M indexed tokens should cost about two cents.
    expect(estimateCostUsd(DEFAULT_EMBEDDING_MODEL, { inputTokens: 1_000_000 })).toBeCloseTo(
      0.02,
      4,
    );
    expect(estimateCostUsd(DEFAULT_EMBEDDING_MODEL, { inputTokens: 100_000 })).toBeCloseTo(
      0.002,
      5,
    );
  });

  it('keeps micro-dollar precision so cheap calls do not round to zero', () => {
    expect(estimateCostUsd(DEFAULT_ANSWER_MODEL, { inputTokens: 100 })).toBeGreaterThan(0);
  });

  it('returns zero for a model with no published price rather than guessing', () => {
    expect(estimateCostUsd('some-unknown-model', { inputTokens: 1_000_000 })).toBe(0);
    expect(isPricedModel('some-unknown-model')).toBe(false);
  });

  it('prices a thousand questions at roughly the planned figure', () => {
    const perQuestion = estimateCostUsd(DEFAULT_ANSWER_MODEL, {
      inputTokens: COST_BASELINE.targetInputTokens,
      outputTokens: COST_BASELINE.targetOutputTokens,
    });
    expect(perQuestion * 1_000).toBeCloseTo(1.62, 2);
  });

  it('declares every model it prices with all three rates', () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.inputPerMillionUsd, model).toBeGreaterThan(0);
      expect(pricing.cachedInputPerMillionUsd, model).toBeGreaterThan(0);
      expect(pricing.outputPerMillionUsd, model).toBeGreaterThanOrEqual(0);
      expect(pricing.effectiveFrom, model).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
