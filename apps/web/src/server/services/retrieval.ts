import {
  RETRIEVAL_BUDGET,
  applyContextBoost,
  diversifyByFile,
  estimateTokens,
  fitToTokenBudget,
  isComplexQuestion,
  reciprocalRankFusion,
  type DocumentKind,
} from '@companion/shared';
import { lexicalTerms, normaliseQuestion } from '@companion/ai';
import { and, eq, isNull, schema, sql } from '@companion/db';
import { getContainer } from '../container';
import { platformLimits } from './entitlements';

/**
 * Hybrid retrieval.
 *
 * A Companion is never sent to the model in full. Postgres full-text search and
 * pgvector cosine search each produce a ranked list; the two are fused with
 * Reciprocal Rank Fusion, nudged toward what the reader is currently looking
 * at, diversified across files, and trimmed to a token budget.
 */
export interface RetrievedChunk {
  id: string;
  fileId: string;
  fileVersionId: string;
  unitId: string | null;
  fileName: string;
  kind: DocumentKind;
  page: number | null;
  slide: number | null;
  sheetName: string | null;
  range: string | null;
  sectionTitle: string | null;
  text: string;
  score: number;
  /** True when both retrievers agreed — a strong grounding signal. */
  agreement: boolean;
}

export interface RetrievalContext {
  companionId: string;
  question: string;
  embedding: number[] | null;
  activeFileId: string | null;
  activePage: number | null;
  fileCount: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  complex: boolean;
  contextTokens: number;
  topScore: number;
  /** Candidate pool size, for the low-confidence diagnostic. */
  candidateCount: number;
}

const CANDIDATE_POOL = 40;

export async function retrieve(context: RetrievalContext): Promise<RetrievalResult> {
  const limits = await platformLimits();
  const complex = isComplexQuestion(context.question, context.fileCount);

  const maxChunks = Math.min(
    complex ? RETRIEVAL_BUDGET.maxChunksComplex : RETRIEVAL_BUDGET.maxChunksNormal,
    limits.maxRetrievalChunks,
  );
  const budgetTokens = complex
    ? RETRIEVAL_BUDGET.maxContextTokensComplex
    : RETRIEVAL_BUDGET.maxContextTokensNormal;

  const [lexicalRows, semanticRows] = await Promise.all([
    lexicalSearch(context.companionId, context.question),
    context.embedding ? semanticSearch(context.companionId, context.embedding) : Promise.resolve([]),
  ]);

  const byId = new Map<string, ChunkRow>();
  for (const row of [...lexicalRows, ...semanticRows]) byId.set(row.id, row);

  const fused = reciprocalRankFusion(
    lexicalRows.map((row) => ({ id: row.id, score: row.score })),
    semanticRows.map((row) => ({ id: row.id, score: row.score })),
  );

  const boosted = applyContextBoost(fused, byId, {
    activeFileId: context.activeFileId,
    activePage: context.activePage,
  });

  const ordered: RetrievedChunk[] = [];
  for (const result of boosted) {
    const row = byId.get(result.id);
    if (!row) continue;
    ordered.push({
      id: row.id,
      fileId: row.fileId,
      fileVersionId: row.fileVersionId,
      unitId: row.unitId,
      fileName: row.fileName,
      kind: row.kind,
      page: row.page,
      slide: row.slide,
      sheetName: row.sheetName,
      range: row.range,
      sectionTitle: row.sectionTitle,
      text: row.text,
      score: result.score,
      agreement: result.agreement,
    });
  }

  // Never let one long document crowd out the rest of a bundle.
  const maxPerFile = context.fileCount > 1 ? Math.max(2, Math.ceil(maxChunks / 2)) : maxChunks;
  const diversified = diversifyByFile(ordered, maxChunks, maxPerFile);
  const { kept, usedTokens } = fitToTokenBudget(diversified, budgetTokens);

  return {
    chunks: kept,
    complex,
    contextTokens: usedTokens,
    topScore: kept[0]?.score ?? 0,
    candidateCount: byId.size,
  };
}

interface ChunkRow extends Record<string, unknown> {
  id: string;
  fileId: string;
  fileVersionId: string;
  unitId: string | null;
  fileName: string;
  kind: DocumentKind;
  page: number | null;
  slide: number | null;
  sheetName: string | null;
  range: string | null;
  sectionTitle: string | null;
  text: string;
  score: number;
}

/**
 * Lexical half.
 *
 * Two queries, not one. `websearch_to_tsquery` conjoins every term, which is
 * right for a search box and wrong for a question: "what is the termination
 * notice period?" becomes `termin & notic & period`, and a clause that says
 * "terminate ... by giving sixty days written notice" matches none of it. So
 * the *match* is a disjunction of the content words, which is what recall
 * needs, and a row that also satisfies the strict query is scored higher,
 * which is what precision needs. `ts_rank_cd` then does the rest: a passage
 * covering more of the question outranks one covering less.
 */
const STRICT_MATCH_BOOST = 2;

async function lexicalSearch(companionId: string, question: string): Promise<ChunkRow[]> {
  const { db } = getContainer();
  const normalized = normaliseQuestion(question);
  const terms = lexicalTerms(question);
  if (normalized.length === 0) return [];

  const anyTerm = terms.join(' | ');
  const rows = await db.execute<ChunkRow>(sql`
    WITH q AS (
      SELECT
        CASE
          WHEN numnode(websearch_to_tsquery('english', ${normalized})) > 0
            THEN websearch_to_tsquery('english', ${normalized})
          ELSE NULL
        END AS strict,
        CASE
          WHEN ${anyTerm} <> '' THEN to_tsquery('english', ${anyTerm})
          ELSE NULL
        END AS loose
    )
    SELECT
      c.id,
      c.file_id           AS "fileId",
      c.file_version_id   AS "fileVersionId",
      c.unit_id           AS "unitId",
      c.file_name         AS "fileName",
      c.kind,
      c.page,
      c.slide,
      c.sheet_name        AS "sheetName",
      c.range,
      c.section_title     AS "sectionTitle",
      c.text,
      (
        ts_rank_cd(to_tsvector('english', c.text), coalesce(q.loose, q.strict))
        * CASE
            WHEN q.strict IS NOT NULL AND to_tsvector('english', c.text) @@ q.strict
              THEN ${STRICT_MATCH_BOOST}
            ELSE 1
          END
      )::float8 AS score
    FROM chunks c
    JOIN files f ON f.id = c.file_id
    CROSS JOIN q
    WHERE c.companion_id = ${companionId}
      AND f.removed_at IS NULL
      AND coalesce(q.loose, q.strict) IS NOT NULL
      AND to_tsvector('english', c.text) @@ coalesce(q.loose, q.strict)
    ORDER BY score DESC
    LIMIT ${CANDIDATE_POOL}
  `);
  return [...rows];
}

/** Semantic half. Cosine distance over the HNSW index. */
async function semanticSearch(companionId: string, embedding: number[]): Promise<ChunkRow[]> {
  const { db } = getContainer();
  const literal = `[${embedding.join(',')}]`;
  const rows = await db.execute<ChunkRow>(sql`
    SELECT
      c.id,
      c.file_id           AS "fileId",
      c.file_version_id   AS "fileVersionId",
      c.unit_id           AS "unitId",
      c.file_name         AS "fileName",
      c.kind,
      c.page,
      c.slide,
      c.sheet_name        AS "sheetName",
      c.range,
      c.section_title     AS "sectionTitle",
      c.text,
      (1 - (c.embedding <=> ${literal}::vector))::float8 AS score
    FROM chunks c
    JOIN files f ON f.id = c.file_id
    WHERE c.companion_id = ${companionId}
      AND c.embedding IS NOT NULL
      AND f.removed_at IS NULL
    ORDER BY c.embedding <=> ${literal}::vector
    LIMIT ${CANDIDATE_POOL}
  `);
  return [...rows];
}

/** Every file name in the bundle, so the model can say what exists. */
export async function bundleFileNames(companionId: string): Promise<string[]> {
  const { db } = getContainer();
  const rows = await db
    .select({ name: schema.files.name })
    .from(schema.files)
    .where(
      and(
        eq(schema.files.companionId, companionId),
        isNull(schema.files.removedAt),
        eq(schema.files.isContainer, false),
      ),
    )
    .orderBy(schema.files.sortOrder);
  return rows.map((row) => row.name);
}

/** Short excerpt of the page the reader is on, for "explain this" questions. */
export async function activeExcerpt(
  companionId: string,
  fileId: string | null,
  page: number | null,
): Promise<string | null> {
  if (!fileId) return null;
  const { db } = getContainer();
  const conditions = [
    eq(schema.documentUnits.companionId, companionId),
    eq(schema.documentUnits.fileId, fileId),
  ];
  if (page !== null) conditions.push(eq(schema.documentUnits.page, page));

  const rows = await db
    .select({ text: schema.documentUnits.text })
    .from(schema.documentUnits)
    .where(and(...conditions))
    .orderBy(schema.documentUnits.ordinal)
    .limit(1);

  const text = rows[0]?.text;
  if (!text) return null;

  // Budgeted at roughly the planned 700 tokens of active-page context.
  const budgetChars = RETRIEVAL_BUDGET.activeContextTokens * 3;
  return text.length > budgetChars ? `${text.slice(0, budgetChars)}…` : text;
}

export { estimateTokens };
