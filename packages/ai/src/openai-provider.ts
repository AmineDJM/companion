import {
  DEFAULT_ANSWER_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  modelAnswerSchema,
  type ModelAnswer,
} from '@companion/shared';
import OpenAI from 'openai';
import { BLANK_PAGE_MARKER, PAGE_READER_INSTRUCTIONS, buildSystemPrompt, buildUserPrompt } from './prompts.js';
import {
  ProviderError,
  type AnswerRequest,
  type DocumentVisionProvider,
  type DocumentVisionRequest,
  type DocumentVisionResult,
  type AnswerResult,
  type DocumentAnswerProvider,
  type EmbeddingProvider,
  type EmbeddingRequest,
  type EmbeddingResult,
  type ProviderHealthResult,
  type ProviderUsage,
} from './provider.js';

export interface OpenAIProviderConfig {
  apiKey: string;
  /** Configurable so regional endpoints and gateways can be used. */
  baseUrl?: string;
  answerModel?: string;
  embeddingModel?: string;
  /** Hard ceiling on a single request, in milliseconds. */
  timeoutMs?: number;
  maxRetries?: number;
  organization?: string;
}

/**
 * Bumped whenever ANSWER_POLICY_PREFIX changes, so a policy edit starts a new
 * cache generation instead of colliding with the previous prefix.
 */
const PROMPT_CACHE_KEY = 'companion-answer-v1';

const EMPTY_USAGE: ProviderUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

/**
 * The only provider enabled in V1.
 *
 * Uses the Responses API with a JSON schema so the structured answer contract
 * is enforced by the API rather than by parsing prose, and keeps reasoning at
 * the lowest useful setting — ordinary document questions do not need it.
 */
export class OpenAILunaProvider implements DocumentAnswerProvider, EmbeddingProvider {
  readonly id = 'openai';
  readonly answerModel: string;
  readonly embeddingModel: string;
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private readonly client: OpenAI;

  constructor(config: OpenAIProviderConfig) {
    this.answerModel = config.answerModel ?? DEFAULT_ANSWER_MODEL;
    this.embeddingModel = config.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      ...(config.organization ? { organization: config.organization } : {}),
      timeout: config.timeoutMs ?? 60_000,
      maxRetries: config.maxRetries ?? 2,
    });
  }

  async answer(request: AnswerRequest): Promise<AnswerResult> {
    const started = Date.now();
    try {
      const response = await this.client.responses.create(
        this.buildPayload(request, false),
        request.signal ? { signal: request.signal } : undefined,
      );
      const text = extractOutputText(response);
      return {
        answer: parseAnswer(text),
        usage: readUsage(response),
        model: this.answerModel,
        latencyMs: Date.now() - started,
        requestId: readRequestId(response),
      };
    } catch (error) {
      throw toProviderError(error, this.id);
    }
  }

  async answerStream(
    request: AnswerRequest,
    onDelta: (delta: string) => void,
  ): Promise<AnswerResult> {
    const started = Date.now();
    try {
      const stream = await this.client.responses.create(
        { ...this.buildPayload(request, true), stream: true },
        request.signal ? { signal: request.signal } : undefined,
      );

      let buffered = '';
      let emittedUpTo = 0;
      let finalResponse: unknown = null;

      for await (const event of stream as AsyncIterable<Record<string, unknown>>) {
        const type = event['type'];
        if (type === 'response.output_text.delta' && typeof event['delta'] === 'string') {
          buffered += event['delta'];
          // The model emits JSON; surface only the prose inside "answer" so the
          // reader never sees the envelope while it streams.
          const visible = extractPartialAnswerText(buffered);
          if (visible.length > emittedUpTo) {
            onDelta(visible.slice(emittedUpTo));
            emittedUpTo = visible.length;
          }
        } else if (type === 'response.completed') {
          finalResponse = event['response'];
        } else if (type === 'response.failed' || type === 'error') {
          throw new ProviderError('The answer service failed mid-stream', this.id, true);
        }
      }

      const answer = parseAnswer(buffered);
      // Flush any prose the incremental extractor could not confirm while the
      // JSON was still unbalanced.
      if (answer.answer.length > emittedUpTo) onDelta(answer.answer.slice(emittedUpTo));

      return {
        answer,
        usage: finalResponse ? readUsage(finalResponse) : EMPTY_USAGE,
        model: this.answerModel,
        latencyMs: Date.now() - started,
        requestId: finalResponse ? readRequestId(finalResponse) : null,
      };
    } catch (error) {
      throw toProviderError(error, this.id);
    }
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const started = Date.now();
    if (request.input.length === 0) {
      return { embeddings: [], usage: EMPTY_USAGE, model: this.embeddingModel, latencyMs: 0 };
    }
    try {
      const response = await this.client.embeddings.create(
        {
          model: this.embeddingModel,
          input: request.input,
          dimensions: this.dimensions,
        },
        request.signal ? { signal: request.signal } : undefined,
      );
      return {
        embeddings: response.data
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding as number[]),
        usage: {
          ...EMPTY_USAGE,
          inputTokens: response.usage?.prompt_tokens ?? 0,
        },
        model: this.embeddingModel,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      throw toProviderError(error, this.id);
    }
  }

  async health(): Promise<ProviderHealthResult> {
    const started = Date.now();
    try {
      await this.client.models.retrieve(this.embeddingModel);
      return { healthy: true, latencyMs: Date.now() - started };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - started,
        // Deliberately coarse: provider errors can echo request material.
        message: error instanceof Error ? error.name : 'unknown error',
      };
    }
  }

  private buildPayload(request: AnswerRequest, streaming: boolean): Record<string, unknown> {
    return {
      model: this.answerModel,
      // Stable prefix first so the prompt cache can serve it.
      instructions: buildSystemPrompt(),
      input: buildUserPrompt(request),
      // Routes identical prefixes to the same cache shard. Versioned so an
      // edit to the answer policy cannot be served from a stale prefix.
      prompt_cache_key: PROMPT_CACHE_KEY,
      max_output_tokens: request.maxOutputTokens,
      // Ordinary document questions need no deliberation; complex cross-document
      // comparisons get a modest budget and nothing more.
      reasoning: { effort: request.complex ? 'low' : 'none' },
      text: {
        format: {
          type: 'json_schema',
          name: 'companion_answer',
          strict: true,
          schema: ANSWER_JSON_SCHEMA,
        },
      },
      ...(streaming ? {} : { store: false }),
    };
  }
}

const ANSWER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'citations', 'answered'],
  properties: {
    answer: { type: 'string' },
    answered: { type: 'boolean' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source_id', 'quote', 'relevance'],
        properties: {
          source_id: { type: 'string' },
          quote: { type: ['string', 'null'] },
          relevance: { type: 'number' },
        },
      },
    },
  },
} as const;

function extractOutputText(response: unknown): string {
  const record = response as { output_text?: unknown; output?: unknown };
  if (typeof record.output_text === 'string' && record.output_text.length > 0) {
    return record.output_text;
  }
  // Fall back to walking the output items when the convenience field is absent.
  const output = Array.isArray(record.output) ? record.output : [];
  const parts: string[] = [];
  for (const item of output) {
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') parts.push(text);
    }
  }
  return parts.join('');
}

function readUsage(response: unknown): ProviderUsage {
  const usage = (response as { usage?: Record<string, unknown> }).usage;
  if (!usage) return EMPTY_USAGE;
  const inputDetails = (usage['input_tokens_details'] ?? {}) as Record<string, unknown>;
  const outputDetails = (usage['output_tokens_details'] ?? {}) as Record<string, unknown>;
  return {
    inputTokens: numberOr(usage['input_tokens'], 0),
    cachedInputTokens: numberOr(inputDetails['cached_tokens'], 0),
    outputTokens: numberOr(usage['output_tokens'], 0),
    reasoningTokens: numberOr(outputDetails['reasoning_tokens'], 0),
  };
}

function readRequestId(response: unknown): string | null {
  const id = (response as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Parses the structured answer. A model that returns malformed JSON is a
 * provider fault, not a recipient-visible failure, so we degrade to a plain
 * uncited answer rather than throwing away a usable reply.
 */
export function parseAnswer(raw: string): ModelAnswer {
  const cleaned = stripCodeFence(raw.trim());
  try {
    const parsed = modelAnswerSchema.parse(JSON.parse(cleaned));
    return parsed;
  } catch {
    const salvaged = extractPartialAnswerText(cleaned);
    const text = salvaged || cleaned;
    if (!text) {
      return { answer: '', citations: [], answered: false };
    }
    return { answer: text, citations: [], answered: text.length > 0 };
  }
}

function stripCodeFence(value: string): string {
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/;
  const match = fence.exec(value);
  return match?.[1] ?? value;
}

/**
 * Pulls the (possibly incomplete) value of the "answer" field out of a partial
 * JSON string, handling escape sequences so a half-written `\"` is not shown.
 */
export function extractPartialAnswerText(partial: string): string {
  const keyIndex = partial.indexOf('"answer"');
  if (keyIndex === -1) return '';
  const colon = partial.indexOf(':', keyIndex + 8);
  if (colon === -1) return '';
  let index = colon + 1;
  while (index < partial.length && /\s/.test(partial[index] as string)) index += 1;
  if (partial[index] !== '"') return '';
  index += 1;

  let out = '';
  while (index < partial.length) {
    const char = partial[index] as string;
    if (char === '\\') {
      const next = partial[index + 1];
      if (next === undefined) break; // escape sequence not yet complete
      switch (next) {
        case 'n':
          out += '\n';
          break;
        case 't':
          out += '\t';
          break;
        case 'r':
          out += '\r';
          break;
        case 'u': {
          const hex = partial.slice(index + 2, index + 6);
          if (hex.length < 4) return out;
          out += String.fromCharCode(Number.parseInt(hex, 16));
          index += 6;
          continue;
        }
        default:
          out += next;
      }
      index += 2;
      continue;
    }
    if (char === '"') break;
    out += char;
    index += 1;
  }
  return out;
}

function toProviderError(error: unknown, providerId: string): ProviderError {
  if (error instanceof ProviderError) return error;
  const status = (error as { status?: number }).status;
  const retryable = status === undefined || status === 429 || status >= 500;
  const name = error instanceof Error ? error.name : 'ProviderRequestFailed';
  return new ProviderError(`${name}${status ? ` (${status})` : ''}`, providerId, retryable, {
    cause: error,
  });
}

/**
 * Page reading via the vision model.
 *
 * Companion does not run classical OCR. A scanned page is rendered to an image
 * and read by the same model that answers questions about it, which handles
 * layout, tables and poor scans far more reliably than character recognition —
 * and, crucially, produces text a reader would recognise rather than a stream
 * of plausible-looking garbage that would silently poison the index.
 */
export class OpenAIVisionReader implements DocumentVisionProvider {
  readonly id = 'openai';
  readonly visionModel: string;
  private readonly client: OpenAI;

  constructor(config: OpenAIProviderConfig & { visionModel?: string }) {
    this.visionModel = config.visionModel ?? config.answerModel ?? DEFAULT_ANSWER_MODEL;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      ...(config.organization ? { organization: config.organization } : {}),
      // Page reads are slower than answers and must not be cut short.
      timeout: config.timeoutMs ?? 120_000,
      maxRetries: config.maxRetries ?? 2,
    });
  }

  async readPage(request: DocumentVisionRequest): Promise<DocumentVisionResult> {
    const started = Date.now();
    const dataUrl = `data:${request.mimeType};base64,${request.image.toString('base64')}`;

    try {
      const response = await this.client.responses.create(
        {
          model: this.visionModel,
          instructions: PAGE_READER_INSTRUCTIONS,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: request.documentHint
                    ? `Transcribe page ${request.page} of this ${request.documentHint}.`
                    : `Transcribe page ${request.page}.`,
                },
                { type: 'input_image', image_url: dataUrl, detail: 'high' },
              ],
            },
          ],
          // A dense page can exceed 4k tokens of text; leave headroom.
          max_output_tokens: 8_000,
          reasoning: { effort: 'none' },
          store: false,
        } as never,
        request.signal ? { signal: request.signal } : undefined,
      );

      const text = extractOutputText(response).trim();
      const blank = text === BLANK_PAGE_MARKER || text.length === 0;

      return {
        text: blank ? '' : text,
        usage: readUsage(response),
        model: this.visionModel,
        latencyMs: Date.now() - started,
        blank,
      };
    } catch (error) {
      throw toProviderError(error, this.id);
    }
  }
}
