import { describe, expect, it } from 'vitest';
import {
  applyContextBoost,
  citationLabel,
  diversifyByFile,
  estimateTokens,
  fitToTokenBudget,
  isComplexQuestion,
  isGroundedAnswer,
  reciprocalRankFusion,
  sanitiseCitations,
} from '@companion/shared';

describe('reciprocal rank fusion', () => {
  it('ranks a chunk both retrievers agree on above either list alone', () => {
    const fused = reciprocalRankFusion(
      [
        { id: 'a', score: 9 },
        { id: 'b', score: 8 },
      ],
      [
        { id: 'b', score: 0.9 },
        { id: 'c', score: 0.8 },
      ],
    );
    expect(fused[0]?.id).toBe('b');
    expect(fused[0]?.agreement).toBe(true);
  });

  it('includes results unique to one retriever', () => {
    const fused = reciprocalRankFusion([{ id: 'a', score: 1 }], [{ id: 'z', score: 1 }]);
    expect(fused.map((entry) => entry.id).sort()).toEqual(['a', 'z']);
  });

  it('needs no score normalisation between two different scoring spaces', () => {
    // Lexical ranks are unbounded; cosine similarity is 0..1. Only order matters.
    const fused = reciprocalRankFusion(
      [{ id: 'lex', score: 10_000 }],
      [{ id: 'vec', score: 0.0001 }],
    );
    expect(fused).toHaveLength(2);
    expect(fused[0]?.score).toBeGreaterThan(0);
  });

  it('is deterministic for identical inputs', () => {
    const lexical = [
      { id: 'b', score: 1 },
      { id: 'a', score: 1 },
    ];
    const first = reciprocalRankFusion(lexical, []);
    const second = reciprocalRankFusion(lexical, []);
    expect(first).toEqual(second);
  });

  it('handles an empty semantic list when embedding failed', () => {
    const fused = reciprocalRankFusion([{ id: 'a', score: 1 }], []);
    expect(fused[0]?.id).toBe('a');
    expect(fused[0]?.semanticRank).toBeNull();
  });
});

describe('context boosting', () => {
  const chunks = new Map([
    ['x', { id: 'x', fileId: 'file-1', page: 17 }],
    ['y', { id: 'y', fileId: 'file-2', page: 3 }],
  ]);

  it('lifts a near-tie on the page the reader is looking at', () => {
    const boosted = applyContextBoost(
      [
        { id: 'y', score: 0.011, lexicalRank: 1, semanticRank: 1, agreement: true },
        { id: 'x', score: 0.01, lexicalRank: 2, semanticRank: 2, agreement: true },
      ],
      chunks,
      { activeFileId: 'file-1', activePage: 17 },
    );
    expect(boosted[0]?.id).toBe('x');
  });

  it('does not let the active page beat a far better match elsewhere', () => {
    const boosted = applyContextBoost(
      [
        { id: 'y', score: 0.05, lexicalRank: 1, semanticRank: 1, agreement: true },
        { id: 'x', score: 0.01, lexicalRank: 2, semanticRank: 2, agreement: true },
      ],
      chunks,
      { activeFileId: 'file-1', activePage: 17 },
    );
    expect(boosted[0]?.id).toBe('y');
  });

  it('is a no-op when no file is open', () => {
    const input = [{ id: 'x', score: 0.01, lexicalRank: 1, semanticRank: 1, agreement: true }];
    expect(applyContextBoost(input, chunks, { activeFileId: null, activePage: null })).toBe(input);
  });
});

describe('file diversification', () => {
  it('stops one long file crowding out the rest of a bundle', () => {
    const items = [
      { fileId: 'a', id: 1 },
      { fileId: 'a', id: 2 },
      { fileId: 'a', id: 3 },
      { fileId: 'b', id: 4 },
      { fileId: 'c', id: 5 },
    ];
    const selected = diversifyByFile(items, 4, 2);
    expect(selected.filter((item) => item.fileId === 'a')).toHaveLength(2);
    expect(selected.map((item) => item.fileId)).toContain('b');
    expect(selected.map((item) => item.fileId)).toContain('c');
  });

  it('backfills from the overflow rather than returning too few', () => {
    const items = [
      { fileId: 'a', id: 1 },
      { fileId: 'a', id: 2 },
      { fileId: 'a', id: 3 },
    ];
    expect(diversifyByFile(items, 3, 1)).toHaveLength(3);
  });
});

describe('token budgeting', () => {
  it('over-estimates slightly rather than under', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    expect(estimateTokens(text)).toBeGreaterThan(text.split(' ').length);
  });

  it('keeps chunks until the budget is reached', () => {
    const items = Array.from({ length: 10 }, () => ({ text: 'w'.repeat(3_600) }));
    const { kept, usedTokens } = fitToTokenBudget(items, 3_000);
    expect(kept.length).toBeLessThan(items.length);
    expect(usedTokens).toBeLessThanOrEqual(3_000);
  });

  it('always keeps at least one chunk, even an oversized one', () => {
    const { kept } = fitToTokenBudget([{ text: 'w'.repeat(100_000) }], 100);
    expect(kept).toHaveLength(1);
  });
});

describe('question complexity', () => {
  it.each([
    'Compare the pricing in these three files.',
    'Does the contract contradict the commercial proposal?',
    'Reconcile the revenue figures across all documents.',
  ])('treats a cross-document question as complex: %s', (question) => {
    expect(isComplexQuestion(question, 5)).toBe(true);
  });

  it.each(['What is the delivery deadline?', 'Explain the termination clause.'])(
    'treats an ordinary question as simple: %s',
    (question) => {
      expect(isComplexQuestion(question, 5)).toBe(false);
    },
  );

  it('does not call a single-file question complex just because it says "all"', () => {
    expect(isComplexQuestion('List all the documents', 1)).toBe(false);
  });
});

describe('citation handling', () => {
  it('drops a source id the model invented', () => {
    const sanitised = sanitiseCitations(
      [
        { source_id: 'S1', quote: 'real', relevance: 0.9 },
        { source_id: 'S99', quote: 'made up', relevance: 0.99 },
      ],
      new Set(['S1']),
    );
    expect(sanitised).toHaveLength(1);
    expect(sanitised[0]?.source_id).toBe('S1');
  });

  it('collapses duplicates to the highest relevance', () => {
    const sanitised = sanitiseCitations(
      [
        { source_id: 'S1', quote: 'a', relevance: 0.4 },
        { source_id: 'S1', quote: 'b', relevance: 0.8 },
      ],
      new Set(['S1']),
    );
    expect(sanitised).toHaveLength(1);
    expect(sanitised[0]?.relevance).toBe(0.8);
  });

  it('builds the label a reader recognises', () => {
    expect(citationLabel({ fileName: 'Draft Contract.docx', page: 11 })).toBe(
      'Draft Contract.docx · page 11',
    );
    expect(citationLabel({ fileName: 'Investor Presentation', slide: 18 })).toBe(
      'Investor Presentation · slide 18',
    );
    expect(
      citationLabel({ fileName: 'Financial Model', sheet: 'Forecast', range: 'B12:F20' }),
    ).toBe('Financial Model · Forecast sheet · B12:F20');
  });

  it('refuses to call a long uncited claim grounded', () => {
    const answer = {
      answer: 'A long confident assertion about the documents. '.repeat(10),
      citations: [],
      answered: true,
    };
    expect(isGroundedAnswer(answer, 0)).toBe(false);
  });

  it('accepts a short procedural reply without citations', () => {
    expect(
      isGroundedAnswer({ answer: 'Which of the three files do you mean?', citations: [], answered: true }, 0),
    ).toBe(true);
  });

  it('accepts a long answer once citations resolved', () => {
    const answer = {
      answer: 'A long grounded explanation. '.repeat(20),
      citations: [{ source_id: 'S1', quote: null, relevance: 1 }],
      answered: true,
    };
    expect(isGroundedAnswer(answer, 1)).toBe(true);
  });
});
