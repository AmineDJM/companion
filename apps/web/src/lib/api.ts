import type { ErrorCode } from '@companion/shared';

/** Typed fetch wrapper for the browser. Every error surfaces as an ApiError. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'network_error',
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  input: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(input, {
      ...rest,
      headers: {
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch (error) {
    throw new ApiError('network_error', 'Connection lost. Check your network and try again.', 0, {
      cause: String(error),
    });
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const body = payload as { error?: { code?: ErrorCode; message?: string; details?: Record<string, unknown> } } | null;
    throw new ApiError(
      body?.error?.code ?? 'internal_error',
      body?.error?.message ?? 'Something went wrong. Please try again.',
      response.status,
      body?.error?.details,
    );
  }

  return payload as T;
}

/**
 * Uploads one file with progress. XHR rather than fetch because fetch still has
 * no upload-progress event, and a 400 MB deck needs a progress bar.
 */
export function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.responseType = 'json';

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    });

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.response);
      } else {
        const body = request.response as { error?: { code?: ErrorCode; message?: string } } | null;
        reject(
          new ApiError(
            body?.error?.code ?? 'internal_error',
            body?.error?.message ?? 'Upload failed. Please try again.',
            request.status,
          ),
        );
      }
    });

    request.addEventListener('error', () =>
      reject(new ApiError('network_error', 'Upload failed. Check your connection.', 0)),
    );
    request.addEventListener('abort', () =>
      reject(new ApiError('network_error', 'Upload cancelled.', 0)),
    );

    signal?.addEventListener('abort', () => request.abort());
    request.send(formData);
  });
}

/**
 * A per-occurrence identifier for a viewer event.
 *
 * Beacons are retried on flaky connections and some of them fire from two
 * lifecycle handlers at once, so the server needs a way to tell a repeat from
 * a second occurrence. randomUUID is not available over plain HTTP on older
 * browsers, hence the fallback.
 */
export function eventId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
