/**
 * Outbound email.
 *
 * Companion needs email for exactly two things: a sender's magic link, and a
 * recipient's confirmation code on an identity-gated document. Both are
 * access-critical — without delivery, an invited reader cannot open what was
 * shared with them — so the provider is named explicitly in configuration
 * rather than inferred from whichever credential happens to be present.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Inner HTML; the sender wraps it in the shared shell. */
  html?: string;
}

export interface EmailSendResult {
  delivered: boolean;
  /** Provider-side identifier, when one is returned. Useful in support. */
  messageId?: string;
  /** Sanitised reason. Never a raw provider payload, never a credential. */
  error?: string;
  latencyMs: number;
}

export interface EmailProvider {
  /** Stable identifier recorded against every send. */
  readonly id: 'resend' | 'smtp' | 'none';
  readonly displayName: string;
  send(message: EmailMessage & { from: string }): Promise<EmailSendResult>;
}
