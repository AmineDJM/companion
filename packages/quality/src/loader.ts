import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specFileSchema, type QualityMetric, type QualitySpec } from './spec.js';

/**
 * Loads and validates the specification once per process.
 *
 * The files are the source of truth: an unknown metric id is an error rather
 * than a silent pass, so a check can never quietly stop being enforced.
 */
let cached: QualitySpec | null = null;

function specDirectory(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Resolves both from source (src/) and from the build output (dist/).
  for (const candidate of [join(here, '..', 'spec'), join(here, 'spec')]) {
    try {
      readdirSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error('Quality specification directory not found');
}

export function loadSpec(): QualitySpec {
  if (cached) return cached;

  const directory = specDirectory();
  const base = JSON.parse(readFileSync(join(directory, 'companion-base.json'), 'utf8')) as {
    version: string;
    updatedAt: string;
  };

  const domains = readdirSync(directory)
    .filter((name) => name.endsWith('.json') && name !== 'companion-base.json')
    .sort()
    .map((name) => specFileSchema.parse(JSON.parse(readFileSync(join(directory, name), 'utf8'))));

  const seen = new Set<string>();
  for (const domain of domains) {
    for (const metric of domain.metrics) {
      if (seen.has(metric.metricId)) {
        throw new Error(`Duplicate quality metric id: ${metric.metricId}`);
      }
      seen.add(metric.metricId);
    }
  }

  cached = { version: base.version, updatedAt: base.updatedAt, domains };
  return cached;
}

export function specVersion(): string {
  return loadSpec().version;
}

export function allMetrics(): QualityMetric[] {
  return loadSpec().domains.flatMap((domain) => domain.metrics);
}

export function metric(metricId: string): QualityMetric {
  const found = allMetrics().find((candidate) => candidate.metricId === metricId);
  if (!found) {
    throw new Error(
      `Unknown quality metric "${metricId}". Declare it in packages/quality/spec before measuring it.`,
    );
  }
  return found;
}

export function metricsForDomain(domain: string): QualityMetric[] {
  return loadSpec().domains.find((entry) => entry.domain === domain)?.metrics ?? [];
}

/** Test seam so a suite can assert behaviour against a controlled spec. */
export function resetSpecCache(): void {
  cached = null;
}
