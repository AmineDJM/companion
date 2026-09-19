/**
 * Index coverage.
 *
 * The question this answers is blunt: could a reader ask about any part of
 * their document and have it findable? Text that exists in the source but sits
 * between two chunk boundaries is invisible to retrieval, and nothing else in
 * the system would notice.
 */
export interface CoverageInput {
  /** Text of every document unit, in order. */
  unitTexts: string[];
  /** Text of every chunk derived from those units. */
  chunkTexts: string[];
}

export interface CoverageReport {
  eligibleCharacters: number;
  coveredCharacters: number;
  coverage: number;
  /** Runs of source text that no chunk contains, longest first. */
  gaps: { unitIndex: number; start: number; length: number; excerpt: string }[];
}

/** Shortest run of missing text worth reporting; below this it is punctuation drift. */
const MIN_GAP = 120;

export function measureCoverage(input: CoverageInput): CoverageReport {
  // Chunking normalises whitespace and may prepend a heading, so coverage is
  // measured on a normalised form rather than on raw offsets.
  const haystack = input.chunkTexts.map(normalise).join('\n');
  const gaps: CoverageReport['gaps'] = [];

  let eligible = 0;
  let covered = 0;

  for (const [unitIndex, rawUnit] of input.unitTexts.entries()) {
    const unit = normalise(rawUnit);
    if (unit.length === 0) continue;
    eligible += unit.length;

    // Walk the unit in sentence-sized probes: a probe found in the chunk text
    // is covered, and consecutive misses accumulate into a gap.
    const probes = probeSpans(unit);
    let gapStart: number | null = null;
    let gapLength = 0;

    for (const probe of probes) {
      const text = unit.slice(probe.start, probe.start + probe.length);
      if (text.trim().length === 0) {
        covered += probe.length;
        continue;
      }

      if (haystack.includes(text.trim())) {
        covered += probe.length;
        if (gapStart !== null && gapLength >= MIN_GAP) {
          gaps.push({
            unitIndex,
            start: gapStart,
            length: gapLength,
            excerpt: unit.slice(gapStart, gapStart + Math.min(gapLength, 160)),
          });
        }
        gapStart = null;
        gapLength = 0;
      } else {
        if (gapStart === null) gapStart = probe.start;
        gapLength += probe.length;
      }
    }

    if (gapStart !== null && gapLength >= MIN_GAP) {
      gaps.push({
        unitIndex,
        start: gapStart,
        length: gapLength,
        excerpt: unit.slice(gapStart, gapStart + Math.min(gapLength, 160)),
      });
    }
  }

  return {
    eligibleCharacters: eligible,
    coveredCharacters: Math.min(covered, eligible),
    coverage: eligible === 0 ? 1 : Math.min(covered / eligible, 1),
    gaps: gaps.sort((a, b) => b.length - a.length).slice(0, 20),
  };
}

/** Splits a unit into sentence-ish spans with their offsets preserved. */
function probeSpans(text: string): { start: number; length: number }[] {
  const spans: { start: number; length: number }[] = [];
  const pattern = /[^.!?\n]+[.!?\n]*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match[0].length === 0) break;
    spans.push({ start: match.index, length: match[0].length });
  }
  return spans.length > 0 ? spans : [{ start: 0, length: text.length }];
}

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Chunk size distribution, for spotting a chunker that has gone wrong. */
export interface ChunkStatistics {
  count: number;
  totalTokens: number;
  mean: number;
  median: number;
  p95: number;
  min: number;
  max: number;
}

export function chunkStatistics(tokenCounts: number[]): ChunkStatistics {
  if (tokenCounts.length === 0) {
    return { count: 0, totalTokens: 0, mean: 0, median: 0, p95: 0, min: 0, max: 0 };
  }
  const sorted = [...tokenCounts].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    totalTokens: total,
    mean: total / sorted.length,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

export function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  // Nearest-rank, which needs no interpolation assumptions.
  const rank = Math.ceil(fraction * sortedValues.length);
  const index = Math.min(Math.max(rank - 1, 0), sortedValues.length - 1);
  return sortedValues[index] ?? 0;
}
