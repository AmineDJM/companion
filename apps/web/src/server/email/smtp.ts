import { createTransport, type Transporter } from 'nodemailer';
import type { EmailMessage, EmailProvider, EmailSendResult } from './types';

/**
 * SMTP, for an instance that must send through its own relay.
 *
 * The transport is created once and reused; nodemailer pools connections, so
 * a burst of recipient codes does not open a connection each.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly id = 'smtp' as const;
  readonly displayName = 'SMTP';
  private transport: Transporter | null = null;

  constructor(private readonly url: string) {}

  private connection(): Transporter {
    // The URL form and the options object are separate overloads, so pooling
    // is expressed through the URL's own query parameters.
    const url = new URL(this.url);
    url.searchParams.set('pool', 'true');
    url.searchParams.set('maxConnections', '3');
    this.transport ??= createTransport(url.toString());
    return this.transport;
  }

  async send(message: EmailMessage & { from: string }): Promise<EmailSendResult> {
    const started = Date.now();
    try {
      const info = await this.connection().sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
      return {
        delivered: true,
        ...(info.messageId ? { messageId: info.messageId } : {}),
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      // An SMTP error carries the recipient address and sometimes the subject;
      // only the code or name is kept.
      const code =
        error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : null;
      return {
        delivered: false,
        error: code ?? (error instanceof Error ? error.name : 'unknown'),
        latencyMs: Date.now() - started,
      };
    }
  }
}
