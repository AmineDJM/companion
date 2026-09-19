import {
  isRefusal,
  specVersion,
  summariseRetrieval,
  type CorpusOutcome,
  type RetrievalReport,
} from '@companion/quality';
import {
  AppError,
  NO_ANSWER_TEXT,
  PROTECTION_THRESHOLDS,
  RETRIEVAL_BUDGET,
} from '@companion/shared';
import { makeLocator, makeSourceId } from '@companion/ai';
import { asc, eq, schema, sql } from '@companion/db';
import { getContainer } from '../container';
import { measure, releaseId } from './quality';
import { retrieve, type RetrievedChunk } from './retrieval';

/**
 * Golden-corpus evaluation.
 *
 * A fixed set of questions with known answers, run against real retrieval and
 * scored with the standard information-retrieval measures. Nothing here asks a
 * model whether retrieval worked: a question either surfaced the passage that
 * actually contains its answer, or it did not.
 *
 * Results are stored per release so a regression is a comparison against the
 * previous run rather than an opinion about whether things feel worse.
 */
export interface GoldenCase {
  id: string;
  key: string;
  companionId: string | null;
  question: string;
  category: string;
  answerable: boolean;
  expectedEvidence: { fileName: string; page?: number; sheet?: string; quote?: string }[];
  expectedValue: string | null;
  forbiddenValues: string[];
  attackKind: string | null;
}

export interface EvaluationReport {
  runId: string;
  releaseId: string;
  qualitySpecVersion: string;
  cases: number;
  recallAt5: number;
  recallAt1: number;
  precisionAt5: number;
  mrr: number;
  ndcgAt5: number;
  regressionDelta: number;
  passed: boolean;
  blockingFailures: number;
  warnings: number;
  byCategory: RetrievalReport['byCategory'];
  /** Golden keys whose answer never appeared in the top five. */
  misses: string[];
}

export async function loadGoldenCases(companionId?: string): Promise<GoldenCase[]> {
  const { db } = getContainer();
  const rows = await db
    .select()
    .from(schema.goldenQuestions)
    .where(companionId ? eq(schema.goldenQuestions.companionId, companionId) : sql`true`)
    .orderBy(asc(schema.goldenQuestions.key));

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    companionId: row.companionId,
    question: row.question,
    category: row.category,
    answerable: row.answerable,
    expectedEvidence: row.expectedEvidence,
    expectedValue: row.expectedValue,
    forbiddenValues: row.forbiddenValues,
    attackKind: row.attackKind,
  }));
}

/**
 * Decides whether a retrieved chunk is one of the passages the question's
 * answer genuinely lives in.
 *
 * Matching is on file, then location, then an exact quote when the case
 * provides one — never on similarity, because a judgement that is itself
 * approximate cannot measure approximation.
 */
/** Single id space: relevance here is by expectation, not by file identity. */
const CORPUS_SPACE = 'golden';

function satisfiedExpectation(
  chunk: RetrievedChunk,
  evidence: GoldenCase['expectedEvidence'],
): string | null {
  const normalise = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

  const index = evidence.findIndex((expected) => {
    if (chunk.fileName !== expected.fileName) return false;
    if (expected.page !== undefined && chunk.page !== expected.page) return false;
    if (expected.sheet !== undefined && chunk.sheetName !== expected.sheet) return false;
    if (expected.quote) return normalise(chunk.text).includes(normalise(expected.quote));
    return true;
  });

  return index === -1 ? null : `e${index}`;
}

export async function runGoldenCorpus(options: {
  companionId?: string;
  triggeredByUserId?: string | null;
} = {}): Promise<EvaluationReport> {
  const { db, embeddingProvider, logger } = getContainer();
  const startedAt = new Date();
  const release = releaseId();
  const specification = specVersion();

  const [run] = await db
    .insert(schema.qualityRuns)
    .values({
      releaseId: release,
      qualitySpecVersion: specification,
      kind: 'golden_corpus',
      passed: false,
      startedAt,
      triggeredByUserId: options.triggeredByUserId ?? null,
    })
    .returning({ id: schema.qualityRuns.id });
  if (!run) throw new Error('could not start the evaluation run');

  const cases = (await loadGoldenCases(options.companionId)).filter(
    // Retrieval cases only: an adversarial case has no passage to find, and
    // scoring it here would depress recall for the wrong reason.
    (item) => item.answerable && item.expectedEvidence.length > 0 && item.companionId !== null,
  );

  const outcomes: CorpusOutcome[] = [];

  for (const item of cases) {
    if (!item.companionId) continue;

    let embedding: number[] | null = null;
    if (embeddingProvider) {
      try {
        const embedded = await embeddingProvider.embed({ input: [item.question] });
        embedding = embedded.embeddings[0] ?? null;
      } catch (error) {
        // A lexical-only run is still a valid measurement; it is recorded as
        // such rather than silently scored as if the vectors were there.
        logger.warn('golden corpus embedding failed', { key: item.key, error });
      }
    }

    const result = await retrieve({
      companionId: item.companionId,
      question: item.question,
      embedding,
      activeFileId: null,
      activePage: null,
      fileCount: 0,
    });

    // Each expected passage gets a synthetic id, and a retrieved chunk carries
    // the id of the first expectation it satisfies. The standard metrics then
    // score file, page and quote matching identically, with no second notion
    // of relevance to drift apart from this one.
    outcomes.push({
      questionId: item.key,
      answerable: item.answerable,
      category: item.category,
      expected: item.expectedEvidence.map((_, index) => ({
        fileId: CORPUS_SPACE,
        unitId: `e${index}`,
      })),
      results: result.chunks.map((chunk) => ({
        fileId: CORPUS_SPACE,
        unitId: satisfiedExpectation(chunk, item.expectedEvidence),
      })),
    });
  }

  const report = summariseRetrieval(outcomes);
  const { recallAt5, recallAt1, precisionAt5: precision, mrr, ndcgAt5: ndcg } = report;

  const previous = await previousRecall(release);
  // Negative means this release retrieves worse than the last one did.
  const regressionDelta = previous === null ? 0 : recallAt5 - previous;

  const evidence = {
    cases: report.sampleSize,
    releaseId: release,
    byCategory: report.byCategory,
    previousRecallAt5: previous,
    misses: report.misses.slice(0, 10),
  };

  const sampleSize = report.sampleSize;
  const evaluations = sampleSize === 0
    ? []
    : await Promise.all([
        measure('retrieval.recall_at_5', { value: recallAt5, sampleSize, evidence }),
        measure('retrieval.recall_at_1', { value: recallAt1, sampleSize, evidence }),
        measure('retrieval.precision_at_5', { value: precision, sampleSize, evidence }),
        measure('retrieval.mrr', { value: mrr, sampleSize, evidence }),
        measure('retrieval.ndcg_at_5', { value: ndcg, sampleSize, evidence }),
        measure('retrieval.regression_delta_recall_at_5', {
          // The metric is stated as a loss, so a gain is reported as zero loss
          // rather than as a negative that would flatter an average.
          value: Math.max(-regressionDelta, 0),
          sampleSize,
          evidence,
        }),
      ]);

  const blocking = evaluations.filter(
    (item) =>
      item.status === 'fail' && (item.severity === 'CRITICAL' || item.severity === 'HARD_FAIL'),
  ).length;
  const warnings = evaluations.filter((item) => item.status !== 'pass').length - blocking;
  const passed = blocking === 0 && sampleSize > 0;

  const finishedAt = new Date();
  await db
    .update(schema.qualityRuns)
    .set({
      passed,
      blockingFailures: blocking,
      warnings: Math.max(warnings, 0),
      headline: {
        recallAt5,
        recallAt1,
        precisionAt5: precision,
        mrr,
        ndcgAt5: ndcg,
        cases: sampleSize,
      },
      summary:
        sampleSize === 0
          ? 'No golden cases are seeded, so retrieval quality is unmeasured.'
          : `${sampleSize} cases, Recall@5 ${(recallAt5 * 100).toFixed(1)}%`,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      finishedAt,
    })
    .where(eq(schema.qualityRuns.id, run.id));

  return {
    runId: run.id,
    releaseId: release,
    qualitySpecVersion: specification,
    cases: sampleSize,
    recallAt5,
    recallAt1,
    precisionAt5: precision,
    mrr,
    ndcgAt5: ndcg,
    regressionDelta,
    passed,
    blockingFailures: blocking,
    warnings: Math.max(warnings, 0),
    byCategory: report.byCategory,
    // The cases a human should look at first.
    misses: report.misses,
  };
}

/** Recall@5 from the most recent completed run of a different release. */
async function previousRecall(currentRelease: string): Promise<number | null> {
  const { db } = getContainer();
  const rows = await db
    .select({ headline: schema.qualityRuns.headline })
    .from(schema.qualityRuns)
    .where(
      sql`${schema.qualityRuns.kind} = 'golden_corpus'
          AND ${schema.qualityRuns.finishedAt} IS NOT NULL
          AND ${schema.qualityRuns.releaseId} <> ${currentRelease}`,
    )
    .orderBy(sql`${schema.qualityRuns.startedAt} DESC`)
    .limit(1);

  const value = rows[0]?.headline['recallAt5'];
  return typeof value === 'number' ? value : null;
}

/**
 * Answerability calibration.
 *
 * Two failure modes, measured separately because they pull in opposite
 * directions: answering a question the documents cannot support, and refusing
 * one they can. Optimising either alone produces a system that is confidently
 * wrong or uselessly cautious.
 */
export function calibration(
  results: { answerable: boolean; refused: boolean; containsExpected: boolean }[],
): { falseAnswerRate: number; falseRefusalRate: number } {
  const unanswerable = results.filter((result) => !result.answerable);
  const answerable = results.filter((result) => result.answerable);

  return {
    falseAnswerRate:
      unanswerable.length === 0
        ? 0
        : unanswerable.filter((result) => !result.refused).length / unanswerable.length,
    falseRefusalRate:
      answerable.length === 0
        ? 0
        : answerable.filter((result) => result.refused || !result.containsExpected).length /
          answerable.length,
  };
}

export interface AnswerabilityReport {
  cases: number;
  falseAnswerRate: number;
  falseRefusalRate: number;
  injectionCases: number;
  injectionSuccessRate: number;
  failures: { key: string; reason: string }[];
}

/**
 * End-to-end answer behaviour over the corpus.
 *
 * Every case goes through real retrieval and the real answer provider, then is
 * judged by string comparison against what the case declares: the expected
 * value must appear, forbidden values must not, and a question the documents
 * cannot answer must produce a refusal. Adversarial cases are scored the same
 * way — an injection succeeded if and only if a forbidden string came back.
 */
export async function runAnswerability(options: { companionId?: string } = {}): Promise<AnswerabilityReport> {
  const { answerProvider, embeddingProvider, logger } = getContainer();
  if (!answerProvider) {
    throw new AppError('provider_unavailable', 'No answer provider is configured.');
  }

  const cases = (await loadGoldenCases(options.companionId)).filter(
    (item) => item.companionId !== null,
  );

  const judged: { answerable: boolean; refused: boolean; containsExpected: boolean }[] = [];
  const failures: { key: string; reason: string }[] = [];
  let injectionCases = 0;
  let injectionSuccesses = 0;

  for (const item of cases) {
    if (!item.companionId) continue;

    let embedding: number[] | null = null;
    if (embeddingProvider) {
      try {
        const embedded = await embeddingProvider.embed({ input: [item.question] });
        embedding = embedded.embeddings[0] ?? null;
      } catch (error) {
        logger.warn('corpus embedding failed', { key: item.key, error });
      }
    }

    const retrieval = await retrieve({
      companionId: item.companionId,
      question: item.question,
      embedding,
      activeFileId: null,
      activePage: null,
      fileCount: 0,
    });

    let answer = NO_ANSWER_TEXT;
    if (retrieval.chunks.length > 0) {
      try {
        const result = await answerProvider.answer({
          question: item.question,
          sources: retrieval.chunks.map((chunk, index) => ({
            sourceId: makeSourceId(index),
            fileName: chunk.fileName,
            locator: makeLocator(chunk),
            text: chunk.text,
          })),
          activeContext: {
            fileName: null,
            page: null,
            slide: null,
            sheet: null,
            selection: null,
            excerpt: null,
          },
          history: [],
          bundleFileNames: [...new Set(retrieval.chunks.map((chunk) => chunk.fileName))],
          senderLabel: null,
          maxQuoteCharacters: PROTECTION_THRESHOLDS.STANDARD.maxQuoteCharsPerAnswer,
          complex: retrieval.complex,
          maxOutputTokens: RETRIEVAL_BUDGET.defaultMaxOutputTokens,
        });
        answer = result.answer.answer;
      } catch (error) {
        logger.error('corpus answer failed', { key: item.key, error });
        failures.push({ key: item.key, reason: 'provider error' });
        continue;
      }
    }

    const normalised = answer.toLowerCase();
    const leaked = item.forbiddenValues.filter((value) =>
      normalised.includes(value.toLowerCase()),
    );
    const refused = isRefusal(answer) || answer === NO_ANSWER_TEXT;
    const containsExpected = item.expectedValue
      ? normalised.includes(item.expectedValue.toLowerCase())
      : !refused;

    if (item.attackKind) {
      injectionCases += 1;
      // An attack succeeded only on evidence: a string the case declares must
      // never come back, came back.
      if (leaked.length > 0) {
        injectionSuccesses += 1;
        failures.push({ key: item.key, reason: `returned forbidden value: ${leaked[0] ?? ''}` });
      }
      continue;
    }

    if (leaked.length > 0) {
      failures.push({ key: item.key, reason: `returned forbidden value: ${leaked[0] ?? ''}` });
    } else if (item.answerable && !containsExpected) {
      failures.push({ key: item.key, reason: refused ? 'refused an answerable question' : 'missing expected value' });
    } else if (!item.answerable && !refused) {
      failures.push({ key: item.key, reason: 'answered a question the documents cannot support' });
    }

    judged.push({ answerable: item.answerable, refused, containsExpected });
  }

  const rates = calibration(judged);
  const evidence = {
    cases: judged.length,
    injectionCases,
    failures: failures.slice(0, 10),
  };

  if (judged.length > 0) {
    await measure('answer.false_answer_rate', {
      value: rates.falseAnswerRate,
      sampleSize: judged.filter((item) => !item.answerable).length,
      evidence,
    });
    await measure('answer.false_refusal_rate', {
      value: rates.falseRefusalRate,
      sampleSize: judged.filter((item) => item.answerable).length,
      evidence,
    });
  }

  if (injectionCases > 0) {
    await measure('security.prompt_injection_success_rate', {
      value: injectionSuccesses / injectionCases,
      sampleSize: injectionCases,
      evidence: {
        ...evidence,
        rule: 'a case fails only when a string it declares forbidden appears in the answer',
      },
    });
  }

  return {
    cases: judged.length,
    falseAnswerRate: rates.falseAnswerRate,
    falseRefusalRate: rates.falseRefusalRate,
    injectionCases,
    injectionSuccessRate: injectionCases === 0 ? 0 : injectionSuccesses / injectionCases,
    failures,
  };
}

export { isRefusal };
