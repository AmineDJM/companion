import {
  AppError,
  NO_ANSWER_TEXT,
  PROTECTION_REFUSAL_MESSAGE,
  PROTECTION_THRESHOLDS,
  RETRIEVAL_BUDGET,
  citationLabel,
  classifyRequest,
  enforceQuoteLimit,
  isGroundedAnswer,
  nextExtractionState,
  sanitiseCitations,
  type ResolvedCitation,
} from '@companion/shared';
import { assignTopic, makeLocator, makeSourceId, type RetrievedSource } from '@companion/ai';
import { eq, schema, sql } from '@companion/db';
import { getContainer } from '../container';
import { recordAnalyticsEvent } from './analytics';
import { measureSourceExposure, verifyAnswer } from './answer-quality';
import { platformLimits } from './entitlements';
import { assertCanAskQuestion, type WorkspaceQuotaContext } from './quota';
import { checkRateLimit } from './rate-limit';
import { activeExcerpt, bundleFileNames, retrieve, type RetrievedChunk } from './retrieval';
import { recordUsage, workspaceSpendThisMonth } from './usage';
import {
  incrementSessionQuestions,
  persistExtractionState,
  type RecipientSession,
} from './recipient-session';
import type { CompanionRecord } from './companions';

/**
 * The recipient question pipeline.
 *
 * Order matters and is enforced here, not in a route handler:
 *   access -> rate limit -> quota -> spend cap -> protection classifier ->
 *   retrieval -> bounded context -> Luna -> citation resolution ->
 *   outbound quote enforcement -> persistence.
 *
 * A refusal produced before the model is called costs nothing and does not
 * consume the customer's question allowance.
 */
export interface AskInput {
  companion: CompanionRecord;
  session: RecipientSession;
  quotaContext: WorkspaceQuotaContext;
  question: string;
  conversationId: string | null;
  context: {
    fileId: string | null;
    page: number | null;
    sheet: string | null;
    slide: number | null;
    selection: string | null;
  };
  senderLabel: string | null;
  signal?: AbortSignal;
}

export interface AskResult {
  questionId: string;
  conversationId: string;
  answer: string;
  answered: boolean;
  citations: ResolvedCitation[];
  refusalKind: 'none' | 'source_protection' | 'no_context' | 'rate_limited' | 'quota';
}

export async function ask(input: AskInput): Promise<AskResult> {
  const { answerProvider, embeddingProvider, logger } = getContainer();
  const limits = await platformLimits();
  const started = Date.now();

  await enforceRateLimits(input, limits.maxQuestionsPerMinutePerSession, limits.maxQuestionsPerMinutePerWorkspace);
  await assertCanAskQuestion(input.quotaContext);
  await assertSpendCap(input.quotaContext.workspaceId, limits.workspaceMonthlySpendHardCapUsd);

  const conversationId = await ensureConversation(input);

  // Source protection runs before retrieval: a bulk-extraction request is
  // refused without ever touching the model or the customer's quota.
  const classification = classifyRequest(
    input.question,
    input.companion.sourceProtectionMode,
    input.session.extraction,
  );

  if (classification.blocked) {
    const questionId = await persistQuestion(input, conversationId, classification, true);
    await persistAnswer({
      questionId,
      companionId: input.companion.id,
      text: PROTECTION_REFUSAL_MESSAGE,
      answered: false,
      refusalKind: 'source_protection',
      citations: [],
      model: null,
      latencyMs: Date.now() - started,
      confidence: 0,
    });
    await persistExtractionState(
      input.session.id,
      nextExtractionState(input.session.extraction, {
        wasExtractionAttempt: true,
        quotedCharacters: 0,
        quotedUnitIds: [],
        answerDelivered: false,
      }),
    );
    await afterQuestion(input, questionId, false);
    return {
      questionId,
      conversationId,
      answer: PROTECTION_REFUSAL_MESSAGE,
      answered: false,
      citations: [],
      refusalKind: 'source_protection',
    };
  }

  if (!answerProvider || !embeddingProvider) {
    throw new AppError('provider_unavailable', 'Questions are temporarily unavailable.');
  }

  // Embed the question for the semantic half of retrieval.
  let embedding: number[] | null = null;
  try {
    const embedded = await embeddingProvider.embed({
      input: [input.question],
      ...(input.signal ? { signal: input.signal } : {}),
    });
    embedding = embedded.embeddings[0] ?? null;
    await recordUsage({
      workspaceId: input.quotaContext.workspaceId,
      companionId: input.companion.id,
      recipientSessionId: input.session.id,
      provider: embeddingProvider.id,
      model: embedded.model,
      requestKind: 'embedding',
      inputTokens: embedded.usage.inputTokens,
      latencyMs: embedded.latencyMs,
      succeeded: true,
      billable: false,
    });
  } catch (error) {
    // Lexical-only retrieval still produces a useful answer.
    logger.warn('question embedding failed; falling back to lexical retrieval', {
      companionId: input.companion.id,
      error,
    });
  }

  const [fileNames, excerpt] = await Promise.all([
    bundleFileNames(input.companion.id),
    input.context.selection
      ? Promise.resolve(null)
      : activeExcerpt(input.companion.id, input.context.fileId, input.context.page),
  ]);

  const retrievalStarted = Date.now();
  const retrieval = await retrieve({
    companionId: input.companion.id,
    question: input.question,
    embedding,
    activeFileId: input.context.fileId,
    activePage: input.context.page,
    fileCount: fileNames.length,
  });
  const retrievalLatencyMs = Date.now() - retrievalStarted;

  const questionId = await persistQuestion(input, conversationId, classification, false);
  await recordRetrievalDiagnostics(questionId, input.companion.id, retrieval, retrievalLatencyMs);

  // Nothing relevant was found: say so rather than letting the model improvise.
  if (retrieval.chunks.length === 0) {
    await persistAnswer({
      questionId,
      companionId: input.companion.id,
      text: NO_ANSWER_TEXT,
      answered: false,
      refusalKind: 'no_context',
      citations: [],
      model: null,
      latencyMs: Date.now() - started,
      confidence: 0,
    });
    await afterQuestion(input, questionId, false);
    return {
      questionId,
      conversationId,
      answer: NO_ANSWER_TEXT,
      answered: false,
      citations: [],
      refusalKind: 'no_context',
    };
  }

  const sources: RetrievedSource[] = retrieval.chunks.map((chunk, index) => ({
    sourceId: makeSourceId(index),
    fileName: chunk.fileName,
    locator: makeLocator(chunk),
    text: chunk.text,
  }));
  const sourceById = new Map(sources.map((source, index) => [source.sourceId, retrieval.chunks[index]!]));

  const thresholds = PROTECTION_THRESHOLDS[input.companion.sourceProtectionMode];
  const history = await recentHistory(conversationId);

  const maxOutputTokens = Math.min(
    retrieval.complex
      ? RETRIEVAL_BUDGET.complexMaxOutputTokens
      : RETRIEVAL_BUDGET.defaultMaxOutputTokens,
    limits.maxAnswerOutputTokens,
  );

  let result;
  try {
    result = await answerProvider.answer({
      question: input.question,
      sources,
      activeContext: {
        fileName: input.context.fileId
          ? (retrieval.chunks.find((chunk) => chunk.fileId === input.context.fileId)?.fileName ??
            null)
          : null,
        page: input.context.page,
        slide: input.context.slide,
        sheet: input.context.sheet,
        selection: input.context.selection,
        excerpt,
      },
      history,
      bundleFileNames: fileNames,
      senderLabel: input.senderLabel,
      maxQuoteCharacters: thresholds.maxQuoteCharsPerAnswer,
      complex: retrieval.complex,
      maxOutputTokens,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    await recordUsage({
      workspaceId: input.quotaContext.workspaceId,
      companionId: input.companion.id,
      recipientSessionId: input.session.id,
      questionId,
      provider: answerProvider.id,
      model: answerProvider.answerModel,
      requestKind: 'answer',
      inputTokens: 0,
      latencyMs: Date.now() - started,
      succeeded: false,
      // A provider failure must never consume the customer's allowance.
      billable: false,
      errorCode: error instanceof Error ? error.name : 'unknown',
    });
    logger.error('answer provider failed', { companionId: input.companion.id, error });
    throw new AppError('provider_unavailable', 'Questions are temporarily unavailable. Try again shortly.');
  }

  await recordUsage({
    workspaceId: input.quotaContext.workspaceId,
    companionId: input.companion.id,
    recipientSessionId: input.session.id,
    questionId,
    provider: answerProvider.id,
    model: result.model,
    requestKind: 'answer',
    inputTokens: result.usage.inputTokens,
    cachedInputTokens: result.usage.cachedInputTokens,
    outputTokens: result.usage.outputTokens,
    reasoningTokens: result.usage.reasoningTokens,
    latencyMs: result.latencyMs,
    succeeded: true,
    // The single place a question is counted against the plan allowance.
    billable: true,
    requestId: result.requestId,
  });

  const resolution = resolveCitations({
    answer: result.answer,
    sourceById,
    mode: input.companion.sourceProtectionMode,
    session: input.session,
  });

  const grounded = isGroundedAnswer(result.answer, resolution.citations.length);
  const answerText = grounded ? result.answer.answer : NO_ANSWER_TEXT;

  await persistAnswer({
    questionId,
    companionId: input.companion.id,
    text: answerText,
    answered: grounded,
    refusalKind: grounded ? 'none' : 'no_context',
    citations: resolution.citations,
    model: result.model,
    latencyMs: result.latencyMs,
    confidence: retrieval.topScore,
  });

  const extraction = nextExtractionState(input.session.extraction, {
    wasExtractionAttempt: classification.intent !== 'none',
    quotedCharacters: resolution.quotedCharacters,
    quotedUnitIds: resolution.quotedUnitIds,
    answerDelivered: true,
  });
  await persistExtractionState(input.session.id, extraction);

  await afterQuestion(input, questionId, grounded);

  // Verification runs after the answer is durable, so evidence gathering can
  // never delay or fail a recipient's reply.
  await verifyAnswer({
    workspaceId: input.companion.workspaceId,
    companionId: input.companion.id,
    questionId,
    answer: answerText,
    answered: grounded,
    claimedSourceIds: resolution.claimedSourceIds,
    validSourceIds: new Set(sourceById.keys()),
    quotes: resolution.quotes,
    citations: resolution.citations,
    evidence: sources.map((source) => source.text).join('\n\n'),
  }).catch((error: unknown) => {
    logger.error('answer verification failed', { questionId, error });
  });

  await measureSourceExposure({
    workspaceId: input.companion.workspaceId,
    companionId: input.companion.id,
    sessionId: input.session.id,
    quotedCharactersTotal: extraction.quotedCharacters,
    documentCharacters: await companionCharacterCount(input.companion.id),
    mode: input.companion.sourceProtectionMode,
  }).catch((error: unknown) => {
    logger.error('source exposure measurement failed', { questionId, error });
  });

  return {
    questionId,
    conversationId,
    answer: answerText,
    answered: grounded,
    citations: resolution.citations,
    refusalKind: grounded ? 'none' : 'no_context',
  };
}

async function enforceRateLimits(
  input: AskInput,
  perSession: number,
  perWorkspace: number,
): Promise<void> {
  const sessionLimit = await checkRateLimit({
    key: `ask:session:${input.session.id}`,
    windowSeconds: 60,
    max: perSession,
  });
  if (!sessionLimit.allowed) {
    throw new AppError('rate_limited', 'Too many questions in a short time. Please wait a moment.');
  }
  const workspaceLimit = await checkRateLimit({
    key: `ask:workspace:${input.quotaContext.workspaceId}`,
    windowSeconds: 60,
    max: perWorkspace,
  });
  if (!workspaceLimit.allowed) {
    throw new AppError('rate_limited', 'This document is very busy right now. Please try again shortly.');
  }
}

/**
 * Emergency stop. Deliberately generous: the alert threshold surfaces in
 * /admin long before this cap, so a paying customer is never silently cut off
 * over a small overage.
 */
async function assertSpendCap(workspaceId: string, capUsd: number): Promise<void> {
  const spend = await workspaceSpendThisMonth(workspaceId);
  if (spend >= capUsd) {
    throw new AppError('spend_cap_reached', 'Questions are temporarily unavailable for this document.');
  }
}

interface CitationResolution {
  citations: ResolvedCitation[];
  quotedCharacters: number;
  quotedUnitIds: string[];
  /** Every source id the model claimed, including ones that did not exist. */
  claimedSourceIds: string[];
  /** One entry per quote the model offered, and whether it survived checking. */
  quotes: { verified: boolean }[];
}

/**
 * Resolves model citations against the real sources.
 *
 * A source id the model invented is dropped. Every quote is re-checked against
 * the chunk it claims to come from and trimmed to the session's remaining
 * verbatim budget, so the outbound path enforces protection independently of
 * whatever the model decided to do.
 */
function resolveCitations(input: {
  answer: { citations: { source_id: string; quote?: string | null; relevance?: number | null }[] };
  sourceById: Map<string, RetrievedChunk>;
  mode: CompanionRecord['sourceProtectionMode'];
  session: RecipientSession;
}): CitationResolution {
  const valid = new Set(input.sourceById.keys());
  const sanitised = sanitiseCitations(input.answer.citations, valid);
  const claimedSourceIds = input.answer.citations.map((citation) => citation.source_id);

  const citations: ResolvedCitation[] = [];
  const quotedUnitIds: string[] = [];
  const quotes: { verified: boolean }[] = [];
  let quotedCharacters = 0;

  for (const [index, citation] of sanitised.entries()) {
    const chunk = input.sourceById.get(citation.source_id);
    if (!chunk) continue;

    let quote: string | null = null;
    if (citation.quote) {
      // A quote the model did not actually take from this chunk is discarded.
      const verified = verifyQuote(citation.quote, chunk.text);
      quotes.push({ verified: verified !== null });
      if (verified) {
        const enforced = enforceQuoteLimit(
          verified,
          input.mode,
          input.session.extraction,
          quotedCharacters,
        );
        quote = enforced.quote;
        if (quote) quotedCharacters += quote.length;
      }
    }

    if (chunk.unitId) quotedUnitIds.push(chunk.unitId);

    citations.push({
      id: `${chunk.id}:${index}`,
      fileId: chunk.fileId,
      fileName: chunk.fileName,
      fileVersionId: chunk.fileVersionId,
      unitId: chunk.unitId,
      chunkId: chunk.id,
      page: chunk.page,
      slide: chunk.slide,
      sheet: chunk.sheetName,
      range: chunk.range,
      sectionTitle: chunk.sectionTitle,
      quote,
      relevance: citation.relevance ?? chunk.score,
      label: citationLabel({
        fileName: chunk.fileName,
        page: chunk.page,
        slide: chunk.slide,
        sheet: chunk.sheetName,
        range: chunk.range,
        sectionTitle: chunk.sectionTitle,
      }),
    });
  }

  return { citations, quotedCharacters, quotedUnitIds, claimedSourceIds, quotes };
}

/**
 * Confirms a quote really appears in its source. Whitespace and quote-character
 * differences are tolerated; invented text is not.
 */
function verifyQuote(quote: string, sourceText: string): string | null {
  const normalise = (value: string) =>
    value
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„‟]/g, '"')
      .replace(/[‐-―]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const needle = normalise(quote);
  if (needle.length < 8) return null;
  if (normalise(sourceText).includes(needle)) return quote.trim();
  return null;
}

async function ensureConversation(input: AskInput): Promise<string> {
  const { db } = getContainer();
  if (input.conversationId) {
    const rows = await db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(
        sql`${schema.conversations.id} = ${input.conversationId} AND ${schema.conversations.recipientSessionId} = ${input.session.id}`,
      )
      .limit(1);
    if (rows[0]) return rows[0].id;
  }

  const [created] = await db
    .insert(schema.conversations)
    .values({
      companionId: input.companion.id,
      recipientSessionId: input.session.id,
      lastMessageAt: new Date(),
    })
    .returning({ id: schema.conversations.id });
  if (!created) throw new AppError('internal_error', 'Could not start the conversation.');
  return created.id;
}

async function recentHistory(
  conversationId: string,
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const { db } = getContainer();
  const rows = await db
    .select({ question: schema.questions.text, answer: schema.answers.text })
    .from(schema.questions)
    .leftJoin(schema.answers, eq(schema.answers.questionId, schema.questions.id))
    .where(eq(schema.questions.conversationId, conversationId))
    .orderBy(sql`${schema.questions.createdAt} DESC`)
    .limit(3);

  const turns: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const row of [...rows].reverse()) {
    turns.push({ role: 'user', content: row.question });
    if (row.answer) turns.push({ role: 'assistant', content: row.answer });
  }
  return turns;
}

async function persistQuestion(
  input: AskInput,
  conversationId: string,
  classification: { intent: string; score: number },
  blocked: boolean,
): Promise<string> {
  const { db } = getContainer();
  const topic = assignTopic(input.question);

  const [row] = await db
    .insert(schema.questions)
    .values({
      conversationId,
      companionId: input.companion.id,
      workspaceId: input.companion.workspaceId,
      recipientSessionId: input.session.id,
      text: input.question,
      contextFileId: input.context.fileId,
      contextPage: input.context.page,
      contextSheet: input.context.sheet,
      hasSelection: Boolean(input.context.selection),
      protectionIntent: classification.intent,
      protectionScore: classification.score,
      blockedByProtection: blocked,
    })
    .returning({ id: schema.questions.id });
  if (!row) throw new AppError('internal_error', 'Could not record the question.');

  await db
    .update(schema.conversations)
    .set({
      questionCount: sql`${schema.conversations.questionCount} + 1`,
      lastMessageAt: new Date(),
    })
    .where(eq(schema.conversations.id, conversationId));

  await upsertTopic(input.companion.id, row.id, topic, input.question);
  return row.id;
}

async function upsertTopic(
  companionId: string,
  questionId: string,
  topic: { slug: string; label: string; confidence: number },
  question: string,
): Promise<void> {
  const { db } = getContainer();
  const [row] = await db
    .insert(schema.questionTopics)
    .values({
      companionId,
      slug: topic.slug,
      label: topic.label,
      questionCount: 1,
      confidence: topic.confidence,
      exampleQuestions: [question.slice(0, 200)],
      lastQuestionAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.questionTopics.companionId, schema.questionTopics.slug],
      set: {
        questionCount: sql`${schema.questionTopics.questionCount} + 1`,
        lastQuestionAt: new Date(),
        // Keep at most five examples so the row cannot grow unbounded.
        exampleQuestions: sql`(
          SELECT to_jsonb(array_agg(value))
          FROM (
            SELECT value FROM jsonb_array_elements(${schema.questionTopics.exampleQuestions} || ${JSON.stringify([question.slice(0, 200)])}::jsonb)
            LIMIT 5
          ) AS sample
        )`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: schema.questionTopics.id });

  if (row) {
    await db
      .update(schema.questions)
      .set({ topicId: row.id })
      .where(eq(schema.questions.id, questionId));
  }
}

async function persistAnswer(input: {
  questionId: string;
  companionId: string;
  text: string;
  answered: boolean;
  refusalKind: 'none' | 'source_protection' | 'no_context' | 'rate_limited' | 'quota';
  citations: ResolvedCitation[];
  model: string | null;
  latencyMs: number;
  confidence: number;
}): Promise<void> {
  const { db } = getContainer();
  await db.transaction(async (tx) => {
    const [answer] = await tx
      .insert(schema.answers)
      .values({
        questionId: input.questionId,
        companionId: input.companionId,
        text: input.text,
        answered: input.answered,
        refusalKind: input.refusalKind,
        confidence: input.confidence,
        model: input.model,
        latencyMs: input.latencyMs,
      })
      .returning({ id: schema.answers.id });
    if (!answer || input.citations.length === 0) return;

    await tx.insert(schema.citations).values(
      input.citations.map((citation, position) => ({
        answerId: answer.id,
        companionId: input.companionId,
        fileId: citation.fileId,
        fileVersionId: citation.fileVersionId,
        unitId: citation.unitId,
        chunkId: citation.chunkId,
        page: citation.page,
        slide: citation.slide,
        sheetName: citation.sheet,
        range: citation.range,
        sectionTitle: citation.sectionTitle,
        quote: citation.quote,
        relevance: citation.relevance,
        position,
      })),
    );
  });
}

async function recordRetrievalDiagnostics(
  questionId: string,
  companionId: string,
  retrieval: { topScore: number; chunks: { fileId: string }[]; contextTokens: number; complex: boolean },
  latencyMs: number,
): Promise<void> {
  const { db } = getContainer();
  await db.insert(schema.retrievalDiagnostics).values({
    questionId,
    companionId,
    topScore: retrieval.topScore,
    chunkCount: retrieval.chunks.length,
    contextTokens: retrieval.contextTokens,
    fileIds: [...new Set(retrieval.chunks.map((chunk) => chunk.fileId))],
    complex: retrieval.complex,
    latencyMs,
  });
}

/** Counters, analytics and topic bookkeeping after a question completes. */
async function afterQuestion(
  input: AskInput,
  questionId: string,
  answered: boolean,
): Promise<void> {
  const { db } = getContainer();

  await db
    .update(schema.companions)
    .set({
      questionCount: sql`${schema.companions.questionCount} + 1`,
      unansweredCount: answered
        ? sql`${schema.companions.unansweredCount}`
        : sql`${schema.companions.unansweredCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.companions.id, input.companion.id));

  if (!answered) {
    await db
      .update(schema.questionTopics)
      .set({ unansweredCount: sql`${schema.questionTopics.unansweredCount} + 1` })
      .where(
        sql`${schema.questionTopics.id} = (SELECT ${schema.questions.topicId} FROM ${schema.questions} WHERE ${schema.questions.id} = ${questionId})`,
      );
  }

  await incrementSessionQuestions(input.session.id);

  await recordAnalyticsEvent({
    companionId: input.companion.id,
    workspaceId: input.companion.workspaceId,
    recipientSessionId: input.session.id,
    type: answered ? 'question_asked' : 'question_unanswered',
    fileId: input.context.fileId,
    page: input.context.page,
  });
}

/**
 * Total extractable characters in a Companion, cached per request path by the
 * database's own planner rather than in memory: it changes only when content is
 * replaced, and a stale value would understate exposure.
 */
async function companionCharacterCount(companionId: string): Promise<number> {
  const { db } = getContainer();
  const rows = await db
    .select({ value: sql<number>`coalesce(sum(${schema.documentUnits.characterCount}), 0)::int` })
    .from(schema.documentUnits)
    .where(eq(schema.documentUnits.companionId, companionId));
  return rows[0]?.value ?? 0;
}
