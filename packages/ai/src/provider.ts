import type { ModelAnswer } from '@companion/shared';

/**
 * Provider abstraction.
 *
 * V1 enables exactly one implementation (OpenAI Luna). The interface exists so
 * a second provider could be introduced without touching any product code; no
 * component, route or service imports an SDK directly.
 */

export interface RetrievedSource {
  /** Short opaque id handed to the model. The model may cite only these. */
  sourceId: string;
  fileName: string;
  /** "page 18", "Forecast sheet · B12:F20", "slide 4" — human-readable locator. */
  locator: string;
  text: string;
}

export interface ActiveContext {
  fileName: string | null;
  page: number | null;
  slide: number | null;
  sheet: string | null;
  /** Text the recipient highlighted before asking. */
  selection: string | null;
  /** Short excerpt of what is currently on screen. */
  excerpt: string | null;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnswerRequest {
  question: string;
  sources: RetrievedSource[];
  activeContext: ActiveContext;
  history: ConversationTurn[];
  /** Names of every file in the bundle, so the model can say what exists. */
  bundleFileNames: string[];
  senderLabel: string | null;
  /** Verbatim quoting budget, derived from the Companion's protection mode. */
  maxQuoteCharacters: number;
  /** Raised only for genuinely complex, multi-document questions. */
  complex: boolean;
  maxOutputTokens: number;
  /** Abort signal so a disconnected recipient stops costing money. */
  signal?: AbortSignal;
}

export interface ProviderUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface AnswerResult {
  answer: ModelAnswer;
  usage: ProviderUsage;
  model: string;
  latencyMs: number;
  requestId: string | null;
}

export interface EmbeddingRequest {
  input: string[];
  signal?: AbortSignal;
}

export interface EmbeddingResult {
  embeddings: number[][];
  usage: ProviderUsage;
  model: string;
  latencyMs: number;
}

export interface ProviderHealthResult {
  healthy: boolean;
  latencyMs: number;
  message?: string;
}

/** Produces grounded answers with citations from a bounded set of sources. */
export interface DocumentAnswerProvider {
  readonly id: string;
  readonly answerModel: string;
  answer(request: AnswerRequest): Promise<AnswerResult>;
  /** Streams answer text; the structured result resolves when the stream ends. */
  answerStream(
    request: AnswerRequest,
    onDelta: (delta: string) => void,
  ): Promise<AnswerResult>;
  health(): Promise<ProviderHealthResult>;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly embeddingModel: string;
  readonly dimensions: number;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
  health(): Promise<ProviderHealthResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ProviderError';
  }
}
