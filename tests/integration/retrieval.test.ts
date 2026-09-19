import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema, sql } from '@companion/db';
import {
  createCompanion,
  createTenant,
  db,
  prepareDatabase,
  truncateAll,
  type CompanionFixture,
  type TenantFixture,
} from './helpers/db';

/**
 * Lexical retrieval against a real Postgres full-text index.
 *
 * These exist because of a defect that unit tests could not have found: the
 * search conjoined every word of the question, so "what is the termination
 * notice period?" became `termin & notic & period` and a clause reading
 * "terminate … by giving sixty days written notice" matched nothing at all.
 * Every question failed, silently, and the product answered "I could not find
 * that" about text it was holding.
 */
const { retrieve } = await import('../../apps/web/src/server/services/retrieval');

let sender: TenantFixture;
let companion: CompanionFixture;

const PASSAGES = [
  {
    name: 'contract.pdf',
    page: 1,
    text:
      '4. TERMINATION\n4.1 Either party may terminate this Agreement for convenience by giving ' +
      'sixty (60) days written notice to the other party.\n4.2 Either party may terminate ' +
      'immediately upon a material breach that remains uncured for thirty days.',
  },
  {
    name: 'contract.pdf',
    page: 2,
    text:
      '3. FEES\nThe Customer shall pay an annual platform fee of EUR 48,000, invoiced quarterly ' +
      'in advance. Implementation services are charged at EUR 1,200 per day.',
  },
  {
    name: 'handbook.pdf',
    page: 1,
    text:
      'Welcome to the team. The office is open from eight in the morning until seven in the ' +
      'evening, and the kitchen is restocked every Monday.',
  },
];

beforeAll(async () => {
  await prepareDatabase();
});

beforeEach(async () => {
  await truncateAll();
  sender = await createTenant('retrieval');
  companion = await createCompanion(sender);

  await db()
    .delete(schema.chunks)
    .where(sql`${schema.chunks.companionId} = ${companion.id}`);

  await db().insert(schema.chunks).values(
    PASSAGES.map((passage, index) => ({
      companionId: companion.id,
      fileId: companion.fileId,
      fileVersionId: companion.fileVersionId,
      unitId: companion.unitId,
      ordinal: index + 1,
      text: passage.text,
      tokenEstimate: Math.ceil(passage.text.length / 4),
      fileName: passage.name,
      kind: 'PDF' as const,
      page: passage.page,
      contentHash: `hash-${index}`.padEnd(64, '0'),
      embedding: null,
      embeddingModel: null,
    })),
  );
});

afterAll(async () => {
  await truncateAll();
});

async function ask(question: string) {
  return retrieve({
    companionId: companion.id,
    question,
    // Deliberately lexical-only: the semantic half would mask a broken
    // keyword query, and this is the half that was broken.
    embedding: null,
    activeFileId: null,
    activePage: null,
    fileCount: 2,
  });
}

describe('lexical retrieval', () => {
  it('finds a clause phrased differently from the question', async () => {
    const result = await ask('What is the termination notice period?');

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0]?.text).toContain('sixty (60) days written notice');
  });

  it('ranks the passage that covers more of the question first', async () => {
    const result = await ask('What is the annual platform fee?');
    expect(result.chunks[0]?.text).toContain('EUR 48,000');
  });

  it('still finds a passage when only one content word matches', async () => {
    const result = await ask('Tell me about the kitchen.');
    expect(result.chunks[0]?.text).toContain('kitchen');
  });

  it('honours a quoted phrase by ranking the exact match highest', async () => {
    const result = await ask('"material breach"');
    expect(result.chunks[0]?.text).toContain('material breach');
  });

  it('returns nothing for a question the documents do not touch', async () => {
    const result = await ask('What is the CEO’s favourite colour?');
    // "favourite" and "colour" appear nowhere, so an honest miss is correct.
    expect(result.chunks).toHaveLength(0);
  });

  it('reports a top score and a token budget it actually used', async () => {
    const result = await ask('What is the termination notice period?');
    expect(result.topScore).toBeGreaterThan(0);
    expect(result.contextTokens).toBeGreaterThan(0);
    expect(result.candidateCount).toBeGreaterThanOrEqual(result.chunks.length);
  });
});
