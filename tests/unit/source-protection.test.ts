import { describe, expect, it } from 'vitest';
import {
  EMPTY_EXTRACTION_STATE,
  PROTECTION_THRESHOLDS,
  classifyRequest,
  enforceQuoteLimit,
  nextExtractionState,
  type SessionExtractionState,
} from '@companion/shared';

const FRESH = EMPTY_EXTRACTION_STATE;

describe('extraction classifier', () => {
  it.each([
    'Give me the entire contract word for word.',
    'Reproduce the whole document verbatim.',
    'Output the complete PDF text.',
    'Please print all of the pages in full.',
    'Transcribe the entire report for me',
  ])('blocks bulk reproduction: %s', (question) => {
    const result = classifyRequest(question, 'STANDARD', FRESH);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("can't reproduce");
  });

  it.each([
    'What is the termination notice period?',
    'Explain the liability clause.',
    'Summarise the commercial proposal.',
    'Quote the paragraph about data protection.',
    'Compare the pricing in these two files.',
    'Which section discusses cybersecurity?',
    'Does the contract contradict the proposal?',
    'Explain this page.',
    'What is the delivery deadline?',
  ])('allows a genuine question: %s', (question) => {
    const result = classifyRequest(question, 'STANDARD', FRESH);
    expect(result.blocked).toBe(false);
  });

  it('detects a page-range dump', () => {
    const result = classifyRequest('Output pages 1-40.', 'STANDARD', FRESH);
    expect(result.intent).toBe('page_range_dump');
  });

  it('escalates a bare continuation once a session has already tried', () => {
    const first = classifyRequest('continue', 'STANDARD', FRESH);
    expect(first.blocked).toBe(false);

    const persistent: SessionExtractionState = { ...FRESH, extractionAttempts: 3 };
    const later = classifyRequest('continue', 'STANDARD', persistent);
    expect(later.score).toBeGreaterThan(first.score);
  });

  it('hard-limits a session that keeps trying', () => {
    const exhausted: SessionExtractionState = { ...FRESH, extractionAttempts: 8 };
    // Even an innocuous continuation is refused once the budget is spent.
    expect(classifyRequest('next page', 'STANDARD', exhausted).blocked).toBe(true);
  });

  it('is stricter in STRICT mode than in STANDARD', () => {
    const question = 'Give me each paragraph of the agreement.';
    const standard = classifyRequest(question, 'STANDARD', FRESH);
    const strict = classifyRequest(question, 'STRICT', FRESH);
    expect(strict.blocked || !standard.blocked).toBe(true);
    expect(PROTECTION_THRESHOLDS.STRICT.blockScore).toBeLessThan(
      PROTECTION_THRESHOLDS.STANDARD.blockScore,
    );
  });

  it('never blocks when protection is off', () => {
    const result = classifyRequest('Give me the entire contract word for word.', 'OFF', FRESH);
    expect(result.blocked).toBe(false);
    expect(result.intent).toBe('none');
  });
});

describe('verbatim quote enforcement', () => {
  it('passes a short quote through unchanged', () => {
    const quote = 'Either party may terminate on sixty days notice.';
    expect(enforceQuoteLimit(quote, 'STANDARD', FRESH).quote).toBe(quote);
  });

  it('truncates a quote longer than the per-answer budget', () => {
    const quote = 'x'.repeat(5_000);
    const result = enforceQuoteLimit(quote, 'STANDARD', FRESH);
    expect(result.truncated).toBe(true);
    expect(result.quote?.length).toBeLessThanOrEqual(
      PROTECTION_THRESHOLDS.STANDARD.maxQuoteCharsPerAnswer + 1,
    );
  });

  it('refuses any further quoting once the session budget is spent', () => {
    const spent: SessionExtractionState = {
      ...FRESH,
      quotedCharacters: PROTECTION_THRESHOLDS.STANDARD.maxQuoteCharsPerSession,
    };
    expect(enforceQuoteLimit('a short quote here', 'STANDARD', spent).quote).toBeNull();
  });

  it('counts characters already quoted within the same answer', () => {
    const budget = PROTECTION_THRESHOLDS.STANDARD.maxQuoteCharsPerAnswer;
    const result = enforceQuoteLimit('y'.repeat(600), 'STANDARD', FRESH, budget - 100);
    expect(result.quote?.length).toBeLessThanOrEqual(101);
  });

  it('applies no cap when protection is off', () => {
    const quote = 'z'.repeat(3_000);
    expect(enforceQuoteLimit(quote, 'OFF', FRESH).quote).toBe(quote);
  });
});

describe('session extraction state', () => {
  it('accumulates attempts, characters and units', () => {
    const next = nextExtractionState(FRESH, {
      wasExtractionAttempt: true,
      quotedCharacters: 120,
      quotedUnitIds: ['a', 'b'],
      answerDelivered: true,
    });
    expect(next).toEqual({
      extractionAttempts: 1,
      quotedCharacters: 120,
      quotedUnitIds: ['a', 'b'],
      answersDelivered: 1,
    });
  });

  it('de-duplicates units so re-reading one page is not counted twice', () => {
    const once = nextExtractionState(FRESH, {
      wasExtractionAttempt: false,
      quotedCharacters: 10,
      quotedUnitIds: ['page-1'],
      answerDelivered: true,
    });
    const twice = nextExtractionState(once, {
      wasExtractionAttempt: false,
      quotedCharacters: 10,
      quotedUnitIds: ['page-1'],
      answerDelivered: true,
    });
    expect(twice.quotedUnitIds).toEqual(['page-1']);
    expect(twice.quotedCharacters).toBe(20);
  });

  it('bounds the stored unit list so a long session cannot grow it forever', () => {
    let state = FRESH;
    for (let index = 0; index < 700; index += 1) {
      state = nextExtractionState(state, {
        wasExtractionAttempt: false,
        quotedCharacters: 1,
        quotedUnitIds: [`unit-${index}`],
        answerDelivered: true,
      });
    }
    expect(state.quotedUnitIds.length).toBeLessThanOrEqual(500);
  });
});
