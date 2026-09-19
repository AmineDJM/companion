import { describe, expect, it } from 'vitest';
import {
  allMetrics,
  applyGates,
  evaluate,
  loadSpec,
  metric,
  specVersion,
  type Evaluation,
  type QualityMetric,
} from '@companion/quality';

/**
 * The specification itself is under test.
 *
 * A quality engine whose own thresholds can drift silently measures nothing,
 * so the shape of the spec, the honesty of its threshold origins and the
 * behaviour of the release gate are all asserted here.
 */
const ratioMetric: QualityMetric = {
  metricId: 'test.ratio',
  description: 'A ratio that must reach one.',
  measurementMethod: 'observed / expected',
  unit: 'ratio',
  comparison: 'gte',
  target: 1,
  warningThreshold: 0.99,
  failureThreshold: 0.95,
  severity: 'HARD_FAIL',
  thresholdOrigin: 'COMPANION_HOUSE_STANDARD',
  standardReference: null,
  repairStrategy: 'reprocess_file',
  minimumSampleSize: 0,
};

function evaluation(overrides: Partial<Evaluation>): Evaluation {
  return {
    metricId: 'test.metric',
    value: 1,
    passed: true,
    status: 'pass',
    severity: 'WARNING',
    sampleSize: 1,
    qualitySpecVersion: '1.0.0',
    evidence: {},
    measuredAt: new Date('2026-01-01T00:00:00Z'),
    repairStrategy: 'none',
    ...overrides,
  };
}

describe('evaluate', () => {
  it('passes a value at the target', () => {
    const result = evaluate(ratioMetric, { value: 1 }, '1.0.0');
    expect(result.status).toBe('pass');
    expect(result.passed).toBe(true);
  });

  it('warns between the warning and failure thresholds', () => {
    expect(evaluate(ratioMetric, { value: 0.97 }, '1.0.0').status).toBe('warn');
  });

  it('fails below the failure threshold', () => {
    const result = evaluate(ratioMetric, { value: 0.94 }, '1.0.0');
    expect(result.status).toBe('fail');
    expect(result.passed).toBe(false);
  });

  it('records the spec version that judged it', () => {
    expect(evaluate(ratioMetric, { value: 1 }, '7.3.1').qualitySpecVersion).toBe('7.3.1');
  });

  it('carries the evidence through untouched', () => {
    const result = evaluate(ratioMetric, { value: 1, evidence: { pages: [3, 4] } }, '1.0.0');
    expect(result.evidence).toEqual({ pages: [3, 4] });
  });

  it('skips a metric below its sample floor rather than failing it', () => {
    const sampled = { ...ratioMetric, minimumSampleSize: 20 };
    const result = evaluate(sampled, { value: 0, sampleSize: 3 }, '1.0.0');
    expect(result.skipped).toBe(true);
    expect(result.status).toBe('pass');
  });

  it('judges a lower-is-better metric in the right direction', () => {
    const latency: QualityMetric = {
      ...ratioMetric,
      metricId: 'test.latency',
      unit: 'milliseconds',
      comparison: 'lte',
      target: 2500,
      warningThreshold: 2500,
      failureThreshold: 4000,
    };
    expect(evaluate(latency, { value: 1800 }, '1.0.0').status).toBe('pass');
    expect(evaluate(latency, { value: 3200 }, '1.0.0').status).toBe('warn');
    expect(evaluate(latency, { value: 9000 }, '1.0.0').status).toBe('fail');
  });
});

describe('applyGates', () => {
  it('passes when nothing failed', () => {
    const result = applyGates([evaluation({}), evaluation({ metricId: 'b' })]);
    expect(result.passed).toBe(true);
    expect(result.blocking).toHaveLength(0);
  });

  it('blocks on a single CRITICAL failure however good the rest look', () => {
    const result = applyGates([
      ...Array.from({ length: 50 }, (_, index) =>
        evaluation({ metricId: `fine.${index}`, status: 'pass' }),
      ),
      evaluation({
        metricId: 'security.cross_tenant_leaks',
        status: 'fail',
        passed: false,
        severity: 'CRITICAL',
      }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.blocking.map((entry) => entry.metricId)).toEqual([
      'security.cross_tenant_leaks',
    ]);
    expect(result.summary).toContain('security.cross_tenant_leaks');
  });

  it('never averages a critical failure away behind passing metrics', () => {
    const many = Array.from({ length: 99 }, (_, index) =>
      evaluation({ metricId: `fine.${index}`, value: 1 }),
    );
    const leak = evaluation({
      metricId: 'security.idor_failures',
      status: 'fail',
      passed: false,
      severity: 'CRITICAL',
      value: 1,
    });
    // A weighted average would score this at 99%; the gate must still block.
    expect(applyGates([...many, leak]).passed).toBe(false);
  });

  it('treats a WARNING-severity failure as a warning, not a blocker', () => {
    const result = applyGates([
      evaluation({ metricId: 'performance.answer_latency_p95_ms', status: 'fail', passed: false }),
    ]);
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('counts warn-status evaluations as warnings', () => {
    const result = applyGates([evaluation({ status: 'warn' })]);
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });
});

describe('the shipped specification', () => {
  const spec = loadSpec();

  it('is versioned', () => {
    expect(specVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('covers every domain the product makes promises about', () => {
    const domains = spec.domains.map((entry) => entry.domain).sort();
    expect(domains).toEqual(
      expect.arrayContaining([
        'analytics',
        'answer_quality',
        'billing',
        'ingestion',
        'performance',
        'retrieval',
        'security',
        'storage',
        'viewer',
      ]),
    );
  });

  it('gives every metric a unique id', () => {
    const ids = allMetrics().map((entry) => entry.metricId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('throws on an unknown metric id rather than silently passing', () => {
    expect(() => metric('does.not.exist')).toThrow();
  });

  it('never sets a failure threshold stricter than its target', () => {
    for (const entry of allMetrics()) {
      if (entry.comparison === 'gte') {
        expect(entry.failureThreshold).toBeLessThanOrEqual(entry.target);
      }
      if (entry.comparison === 'lte') {
        expect(entry.failureThreshold).toBeGreaterThanOrEqual(entry.target);
      }
    }
  });

  it('cites a source whenever a threshold claims to come from a standard', () => {
    for (const entry of allMetrics()) {
      if (
        entry.thresholdOrigin === 'INDUSTRY_STANDARD' ||
        entry.thresholdOrigin === 'PROVIDER_REQUIREMENT'
      ) {
        expect(entry.standardReference, entry.metricId).toBeTruthy();
      }
    }
  });

  it('does not dress house metrics up as industry standards', () => {
    // Retrieval targets are Companion's own choices. Labelling them as an
    // industry standard would be a false appeal to authority.
    for (const entry of allMetrics()) {
      if (entry.metricId.startsWith('retrieval.')) {
        expect(entry.thresholdOrigin, entry.metricId).toBe('COMPANION_HOUSE_STANDARD');
      }
    }
  });

  it('requires a repair strategy for everything that can block a release', () => {
    for (const entry of allMetrics()) {
      if (entry.severity === 'CRITICAL' || entry.severity === 'HARD_FAIL') {
        expect(entry.repairStrategy, entry.metricId).not.toBe('none');
      }
    }
  });

  it('demands zero tolerance where the spec says zero', () => {
    const zeroTolerance = [
      'security.cross_tenant_leaks',
      'security.idor_failures',
      'security.prompt_injection_success_rate',
      'answer.citation_validity',
      'analytics.tenant_contamination',
    ];
    for (const id of zeroTolerance) {
      const definition = metric(id);
      expect(definition.failureThreshold, id).toBe(definition.target);
      expect(['CRITICAL', 'HARD_FAIL']).toContain(definition.severity);
    }
  });
});
