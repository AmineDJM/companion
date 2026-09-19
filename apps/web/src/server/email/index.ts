import { and, desc, eq, gte, schema, sql } from '@companion/db';
import { getContainer } from '../container';
import { canonicalUrl, env, isProduction } from '../env';
import { ResendEmailProvider } from './resend';
import { SmtpEmailProvider } from './smtp';
import type { EmailMessage, EmailProvider, EmailSendResult } from './types';

export type { EmailMessage, EmailProvider, EmailSendResult };

/**
 * Provider selection and delivery accounting.
 *
 * `EMAIL_PROVIDER=none` is a real choice, not an accident: an instance that
 * only ever shares public links needs no mail at all. What it must not do is
 * pretend. Every attempt is recorded against `provider_health`, so the admin
 * console can answer "when did a message last actually arrive" rather than
 * "is a credential present".
 */
let provider: EmailProvider | null = null;
let resolved = false;

class DisabledEmailProvider implements EmailProvider {
  readonly id = 'none' as const;
  readonly displayName = 'Not configured';
  async send(): Promise<EmailSendResult> {
    return { delivered: false, error: 'no email provider configured', latencyMs: 0 };
  }
}

export function emailProvider(): EmailProvider {
  if (resolved && provider) return provider;
  resolved = true;
  const config = env();

  switch (config.EMAIL_PROVIDER) {
    case 'resend':
      // The schema refuses this combination, so the cast is unreachable in a
      // parsed environment; it is here so a future caller cannot slip past it.
      provider = new ResendEmailProvider(config.RESEND_API_KEY as string);
      break;
    case 'smtp':
      provider = new SmtpEmailProvider(config.SMTP_URL as string);
      break;
    default:
      provider = new DisabledEmailProvider();
  }
  return provider;
}

/** Test seam, and the reset the configuration reload needs. */
export function resetEmailProvider(): void {
  provider = null;
  resolved = false;
}

export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const { logger } = getContainer();
  const active = emailProvider();

  if (active.id === 'none') {
    if (isProduction()) {
      // Loud: an identity-gated document is unopenable without this.
      logger.error('email not sent: EMAIL_PROVIDER is none', { subject: message.subject });
    } else {
      logger.info('email (not sent, no provider configured)', {
        subject: message.subject,
        preview: message.text.slice(0, 400),
      });
    }
    await recordAttempt(active.id, { delivered: false, error: 'not configured', latencyMs: 0 });
    return false;
  }

  const result = await active.send({
    ...message,
    from: env().EMAIL_FROM,
    ...(message.html ? { html: wrapHtml(message.html) } : {}),
  });

  if (!result.delivered) {
    // The subject is template text, never document content, so it is safe to log.
    logger.error('email delivery failed', {
      provider: active.id,
      subject: message.subject,
      error: result.error,
    });
  }

  await recordAttempt(active.id, result);
  return result.delivered;
}

/**
 * One row per attempt. Bounded by the maintenance sweep like every other
 * operational table, and it holds an outcome — never an address or a body.
 */
async function recordAttempt(providerId: string, result: EmailSendResult): Promise<void> {
  const { db, logger } = getContainer();
  try {
    await db.insert(schema.providerHealth).values({
      provider: providerId,
      capability: 'email',
      healthy: result.delivered,
      latencyMs: result.latencyMs,
      message: result.error ? result.error.slice(0, 300) : null,
      checkedAt: new Date(),
    });
  } catch (error) {
    logger.warn('email health write failed', { error });
  }
}

export interface EmailProviderStatus {
  provider: EmailProvider['id'];
  displayName: string;
  configured: boolean;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
  attempts24h: number;
  failures24h: number;
  errorRate24h: number;
}

/** What the admin console shows. Never the credential, only its consequences. */
export async function emailProviderStatus(): Promise<EmailProviderStatus> {
  const { db } = getContainer();
  const active = emailProvider();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [success, failure, counts] = await Promise.all([
    db
      .select({ checkedAt: schema.providerHealth.checkedAt })
      .from(schema.providerHealth)
      .where(
        and(eq(schema.providerHealth.capability, 'email'), eq(schema.providerHealth.healthy, true)),
      )
      .orderBy(desc(schema.providerHealth.checkedAt))
      .limit(1),
    db
      .select({
        checkedAt: schema.providerHealth.checkedAt,
        message: schema.providerHealth.message,
      })
      .from(schema.providerHealth)
      .where(
        and(eq(schema.providerHealth.capability, 'email'), eq(schema.providerHealth.healthy, false)),
      )
      .orderBy(desc(schema.providerHealth.checkedAt))
      .limit(1),
    db
      .select({
        attempts: sql<number>`count(*)::int`,
        failures: sql<number>`count(*) FILTER (WHERE NOT ${schema.providerHealth.healthy})::int`,
      })
      .from(schema.providerHealth)
      .where(
        and(
          eq(schema.providerHealth.capability, 'email'),
          gte(schema.providerHealth.checkedAt, since),
        ),
      ),
  ]);

  const attempts = counts[0]?.attempts ?? 0;
  const failures = counts[0]?.failures ?? 0;

  return {
    provider: active.id,
    displayName: active.displayName,
    configured: active.id !== 'none',
    lastSuccessAt: success[0]?.checkedAt ?? null,
    lastFailureAt: failure[0]?.checkedAt ?? null,
    lastError: failure[0]?.message ?? null,
    attempts24h: attempts,
    failures24h: failures,
    errorRate24h: attempts === 0 ? 0 : failures / attempts,
  };
}

function wrapHtml(body: string): string {
  const origin = canonicalUrl();
  return `<!doctype html><html><body style="margin:0;padding:32px;background:#F7F7F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#15161A">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E4E5E9;border-radius:20px;padding:28px">
${body}
<p style="margin-top:28px;padding-top:16px;border-top:1px solid #E4E5E9;font-size:12px;color:#767983">
<a href="${origin}" style="color:#6374FF;text-decoration:none">Companion</a>
</p></div></body></html>`;
}
