import { describe, expect, it } from 'vitest';
import {
  assessGroundedness,
  assessLegibility,
  chunkStatistics,
  checkNumericConsistency,
  compareGeometry,
  hammingDistance,
  isRefusal,
  measureCoverage,
  needsVisionRead,
  parseNumbers,
  perceptualHash,
  structuralSimilarity,
  summariseRetrieval,
  textConsistency,
  type GreyscaleImage,
} from '@companion/quality';

/**
 * The measurement primitives.
 *
 * Every check in the quality engine reduces to one of these functions, so each
 * one is tested against the failure it exists to catch rather than against a
 * happy path.
 */
describe('parseNumbers', () => {
  it('reads Anglo grouping', () => {
    expect(parseNumbers('The fee is €1,234.56 per year')[0]).toMatchObject({
      value: 1234.56,
      currency: 'EUR',
    });
  });

  it('reads Continental grouping', () => {
    expect(parseNumbers('Der Betrag beträgt 1.234,56 EUR')[0]?.value).toBe(1234.56);
  });

  it('applies scale words', () => {
    expect(parseNumbers('a valuation of $4.2 million')[0]?.value).toBe(4_200_000);
  });

  it('marks percentages so they are never compared against absolute values', () => {
    expect(parseNumbers('growth of 12%')[0]).toMatchObject({ value: 12, isPercentage: true });
  });
});

describe('checkNumericConsistency', () => {
  it('accepts a figure that appears in the evidence', () => {
    const result = checkNumericConsistency(
      'The annual licence costs €50,000.',
      'Section 4 — Fees. The annual licence fee is €50,000, payable in advance.',
    );
    expect(result.mismatches).toHaveLength(0);
    expect(result.consistency).toBe(1);
  });

  it('catches a decimal shift: €50,000 stated as €500,000', () => {
    const result = checkNumericConsistency(
      'The annual licence costs €500,000.',
      'The annual licence fee is €50,000, payable in advance.',
    );
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]?.reason).toBe('magnitude');
    expect(result.mismatches[0]?.ratio).toBeCloseTo(10, 6);
    expect(result.consistency).toBe(0);
  });

  it('catches a number that is simply not in the evidence', () => {
    const result = checkNumericConsistency(
      'There were 4,812 incidents.',
      'The report does not give an incident count.',
    );
    expect(result.mismatches[0]?.reason).toBe('absent');
  });

  it('catches a currency swap even when the digits match', () => {
    const result = checkNumericConsistency(
      'The cap is $2,000,000.',
      'The liability cap is €2,000,000.',
    );
    expect(result.mismatches[0]?.reason).toBe('currency');
  });

  it('tolerates rounding within half a percent', () => {
    const result = checkNumericConsistency('roughly 61.8% of revenue', 'margin was 61.9%');
    expect(result.mismatches).toHaveLength(0);
  });

  it('ignores small ordinals so page references are not treated as claims', () => {
    const result = checkNumericConsistency('See clause 4 on page 7.', 'Clause text with no numbers.');
    expect(result.mismatches).toHaveLength(0);
  });
});

describe('assessGroundedness', () => {
  const evidence =
    'The service level agreement guarantees ninety-nine point nine percent monthly uptime. ' +
    'Credits are issued automatically when the monthly uptime falls below that threshold.';

  it('marks a restatement of the evidence as supported', () => {
    const report = assessGroundedness(
      'The agreement guarantees monthly uptime, and credits are issued automatically when uptime falls below the threshold.',
      evidence,
    );
    expect(report.unsupported).toBe(0);
    expect(report.unsupportedRate).toBe(0);
  });

  it('marks an invented claim as unsupported', () => {
    const report = assessGroundedness(
      'The vendor also indemnifies the customer against third-party patent litigation worldwide.',
      evidence,
    );
    expect(report.unsupported).toBeGreaterThan(0);
    expect(report.unsupportedRate).toBeGreaterThan(0);
  });

  it('treats a numerically wrong sentence as unsupported however well it is worded', () => {
    const report = assessGroundedness(
      'The service level agreement guarantees 99.9% monthly uptime for €500,000 per year.',
      'The service level agreement guarantees 99.9% monthly uptime for €50,000 per year.',
    );
    expect(report.claims.some((claim) => claim.support === 'UNSUPPORTED')).toBe(true);
  });

  it('does not penalise a refusal, which makes no claims', () => {
    const report = assessGroundedness(
      "I could not find that in the shared material. Try asking about the uptime guarantee.",
      evidence,
    );
    expect(report.unsupported).toBe(0);
  });
});

describe('isRefusal', () => {
  it('recognises the product refusal wording', () => {
    expect(isRefusal("I could not find that in the shared material.")).toBe(true);
  });

  it('does not treat a real answer as a refusal', () => {
    expect(isRefusal('The licence fee is €50,000 per year.')).toBe(false);
  });
});

describe('measureCoverage', () => {
  it('reports full coverage when every unit is chunked', () => {
    const unit = 'Alpha beta gamma delta. '.repeat(20);
    const report = measureCoverage({ unitTexts: [unit], chunkTexts: [unit] });
    expect(report.coverage).toBe(1);
    expect(report.gaps).toHaveLength(0);
  });

  it('finds the run of text a chunking bug dropped', () => {
    const kept = 'The parties agree to the following terms and conditions in full. '.repeat(6);
    const dropped = 'The indemnity in clause nine survives termination of this agreement. '.repeat(6);
    const report = measureCoverage({
      unitTexts: [kept + dropped],
      chunkTexts: [kept],
    });

    expect(report.coverage).toBeLessThan(0.995);
    expect(report.gaps.length).toBeGreaterThan(0);
    expect(report.gaps[0]?.excerpt).toContain('indemnity');
  });

  it('treats an empty document as fully covered rather than as a failure', () => {
    expect(measureCoverage({ unitTexts: [], chunkTexts: [] }).coverage).toBe(1);
  });
});

describe('chunkStatistics', () => {
  it('summarises the token distribution', () => {
    const stats = chunkStatistics([100, 200, 300, 400, 500]);
    expect(stats.count).toBe(5);
    expect(stats.mean).toBe(300);
    expect(stats.p95).toBeGreaterThanOrEqual(400);
  });

  it('handles an empty index without dividing by zero', () => {
    expect(chunkStatistics([]).mean).toBe(0);
  });
});

function solidImage(width: number, height: number, value: number): GreyscaleImage {
  return { width, height, data: new Uint8Array(width * height).fill(value) };
}

function patterned(width: number, height: number, seed: number): GreyscaleImage {
  const data = new Uint8Array(width * height);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = (index * seed) % 256;
  }
  return { width, height, data };
}

describe('structuralSimilarity', () => {
  it('scores an identical image at one', () => {
    const image = patterned(64, 64, 7);
    expect(structuralSimilarity(image, image)).toBeCloseTo(1, 6);
  });

  it('scores a blank page against a dense one far below the fidelity target', () => {
    const blank = solidImage(64, 64, 255);
    const dense = patterned(64, 64, 11);
    expect(structuralSimilarity(blank, dense)).toBeLessThan(0.99);
  });

  it('refuses to compare images of different sizes rather than guessing', () => {
    expect(() => structuralSimilarity(solidImage(32, 32, 0), solidImage(64, 64, 0))).toThrow();
  });
});

describe('perceptualHash', () => {
  it('gives the same hash to the same image', () => {
    const image = patterned(32, 32, 5);
    expect(hammingDistance(perceptualHash(image), perceptualHash(image))).toBe(0);
  });

  it('separates two different pages', () => {
    const distance = hammingDistance(
      perceptualHash(patterned(32, 32, 3)),
      perceptualHash(solidImage(32, 32, 255)),
    );
    expect(distance).toBeGreaterThan(0);
  });
});

describe('compareGeometry', () => {
  it('reports no deviation for a proportional resize', () => {
    const check = compareGeometry({ width: 1240, height: 1754 }, { width: 620, height: 877 });
    expect(check.deviation).toBeCloseTo(0, 6);
    expect(check.orientationMatches).toBe(true);
  });

  it('catches a preview that was stretched', () => {
    const check = compareGeometry({ width: 1240, height: 1754 }, { width: 1240, height: 1200 });
    expect(check.deviation).toBeGreaterThan(0.005);
  });

  it('catches a rotated page', () => {
    const check = compareGeometry({ width: 1240, height: 1754 }, { width: 1754, height: 1240 });
    expect(check.orientationMatches).toBe(false);
  });
});

describe('textConsistency', () => {
  it('scores identical text at one', () => {
    expect(textConsistency('the quick brown fox', 'the quick brown fox')).toBe(1);
  });

  it('falls when the preview shows different words than the index holds', () => {
    expect(textConsistency('annual licence fee fifty thousand euros', 'unrelated cover page')).
      toBeLessThan(0.98);
  });
});

describe('assessLegibility', () => {
  it('scores clean prose highly', () => {
    const report = assessLegibility({
      text: 'The agreement shall commence on the first day of January and continue for three years.',
    });
    expect(report.score).toBeGreaterThan(0.75);
    expect(report.suspectedEmptyRead).toBe(false);
  });

  it('scores mojibake low instead of letting it into the index', () => {
    const report = assessLegibility({ text: '~~ &&% ]]^ ((( ### @@@ ||| }}} <<< $$$ ***' });
    expect(report.score).toBeLessThan(0.75);
  });

  it('flags an inked page that produced no text', () => {
    const report = assessLegibility({ text: '', inkRatio: 0.35 });
    expect(report.score).toBe(0);
    expect(report.suspectedEmptyRead).toBe(true);
  });

  it('does not flag a genuinely blank page as a failed read', () => {
    expect(assessLegibility({ text: '', inkRatio: 0 }).suspectedEmptyRead).toBe(false);
  });
});

describe('needsVisionRead', () => {
  it('sends a page with no embedded text to the reader', () => {
    expect(needsVisionRead('')).toBe(true);
  });

  it('leaves a page with good embedded text alone, which costs nothing', () => {
    expect(
      needsVisionRead(
        'This master services agreement is entered into between the parties named below.',
      ),
    ).toBe(false);
  });
});

describe('summariseRetrieval', () => {
  const expected = [{ fileId: 'f1', unitId: 'u1' }];

  it('scores a perfect first hit at the top of every measure', () => {
    const report = summariseRetrieval([
      {
        questionId: 'q1',
        answerable: true,
        expected,
        results: [
          { fileId: 'f1', unitId: 'u1' },
          { fileId: 'f1', unitId: 'u2' },
        ],
      },
    ]);
    expect(report.recallAt1).toBe(1);
    expect(report.recallAt5).toBe(1);
    expect(report.mrr).toBe(1);
  });

  it('discounts an answer buried at rank three', () => {
    const report = summariseRetrieval([
      {
        questionId: 'q1',
        answerable: true,
        expected,
        results: [
          { fileId: 'f1', unitId: 'uX' },
          { fileId: 'f1', unitId: 'uY' },
          { fileId: 'f1', unitId: 'u1' },
        ],
      },
    ]);
    expect(report.recallAt1).toBe(0);
    expect(report.recallAt5).toBe(1);
    expect(report.mrr).toBeCloseTo(1 / 3, 6);
  });

  it('records a complete miss and names the question', () => {
    const report = summariseRetrieval([
      {
        questionId: 'q-missed',
        answerable: true,
        expected,
        results: [{ fileId: 'f2', unitId: 'u9' }],
      },
    ]);
    expect(report.recallAt5).toBe(0);
    expect(report.misses).toEqual(['q-missed']);
  });

  it('breaks results down by category so one weak document type is visible', () => {
    const report = summariseRetrieval([
      { questionId: 'a', answerable: true, category: 'pdf', expected, results: [{ fileId: 'f1', unitId: 'u1' }] },
      { questionId: 'b', answerable: true, category: 'table', expected, results: [{ fileId: 'f9', unitId: 'u9' }] },
    ]);
    expect(report.byCategory['pdf']?.recallAt5).toBe(1);
    expect(report.byCategory['table']?.recallAt5).toBe(0);
  });

  it('excludes unanswerable cases, which have no passage to find', () => {
    const report = summariseRetrieval([
      { questionId: 'a', answerable: false, expected: [], results: [] },
    ]);
    expect(report.sampleSize).toBe(0);
  });
});
