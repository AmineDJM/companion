import { AppError, isAppError, type ErrorCode } from '@companion/shared';
import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { getContainer } from './container';
import { newRequestId } from './logger';

/**
 * Route-handler plumbing.
 *
 * Every API route funnels its errors through `handleRouteError` so the shape of
 * an error response is identical everywhere, unexpected failures never leak an
 * internal message, and each failure carries a request id for correlation.
 */
export function json<T>(body: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(body, init);
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

export function handleRouteError(error: unknown, context: Record<string, unknown> = {}): NextResponse {
  const { logger } = getContainer();
  const requestId = newRequestId();

  if (isAppError(error)) {
    // Expected, user-facing failures are logged at info; they are not incidents.
    logger.info('request rejected', { ...context, requestId, code: error.code });
    return NextResponse.json(error.toJSON(), {
      status: error.status,
      headers: { 'x-request-id': requestId },
    });
  }

  if (error instanceof ZodError) {
    const details = Object.fromEntries(
      error.issues.map((issue) => [issue.path.join('.') || '_', issue.message]),
    );
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Check the highlighted fields.', details } },
      { status: 422, headers: { 'x-request-id': requestId } },
    );
  }

  // Anything else is a bug. Log it fully, tell the caller nothing.
  logger.error('unhandled route error', { ...context, requestId, error });
  return NextResponse.json(
    { error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } },
    { status: 500, headers: { 'x-request-id': requestId } },
  );
}

/** Parses and validates a JSON body, throwing a 422 on malformed input. */
export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('validation_failed', 'Expected a JSON body.');
  }
  return schema.parse(raw);
}

export function parseQuery<T>(request: Request, schema: ZodType<T>): T {
  const url = new URL(request.url);
  return schema.parse(Object.fromEntries(url.searchParams));
}

/** Wraps a handler so no route needs its own try/catch. */
export function route<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>,
): (request: Request, ...args: Args) => Promise<Response> {
  return async (request, ...args) => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      return handleRouteError(error, { path: new URL(request.url).pathname });
    }
  };
}

/** Recipient responses must never be cached by a shared proxy. */
export const NO_STORE_HEADERS: Record<string, string> = {
  'cache-control': 'private, no-store, max-age=0, must-revalidate',
  'x-robots-tag': 'noindex, nofollow, noarchive',
};
