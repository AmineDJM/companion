import type { EmailMessage, EmailProvider, EmailSendResult } from './types';

/**
 * Resend, over its REST API.
 *
 * Deliberately not the SDK: one POST with a bearer token is the whole
 * integration, and a dependency that wraps it would only add a version to keep
 * in step. The key is read once at construction and never leaves this module.
 */
const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 15_000;

export class ResendEmailProvider implements EmailProvider {
  readonly id = 'resend' as const;
  readonly displayName = 'Resend';

  constructor(private readonly apiKey: string) {}

  async send(message: EmailMessage & { from: string }): Promise<EmailSendResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Resend reports the reason in a JSON body; only its short form is
        // kept, because the rest can echo the message that was being sent.
        const detail = await response
          .json()
          .then((body: unknown) =>
            typeof body === 'object' && body !== null && 'message' in body
              ? String((body as { message: unknown }).message)
              : '',
          )
          .catch(() => '');
        return {
          delivered: false,
          error: `${response.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`,
          latencyMs: Date.now() - started,
        };
      }

      const body = (await response.json().catch(() => ({}))) as { id?: string };
      return {
        delivered: true,
        ...(body.id ? { messageId: body.id } : {}),
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        delivered: false,
        error:
          error instanceof Error && error.name === 'AbortError'
            ? `timed out after ${TIMEOUT_MS}ms`
            : error instanceof Error
              ? error.name
              : 'unknown',
        latencyMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
