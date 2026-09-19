import { createTransport, type Transporter } from 'nodemailer';
import { appUrl, env, isProduction } from '../env';
import { getContainer } from '../container';

/**
 * Outbound email.
 *
 * Optional by design: Companion works without it (a recipient never needs an
 * email, and senders can use a password). When SMTP_URL is absent, messages are
 * logged in development and dropped with a warning in production, so a missing
 * mail provider degrades one feature rather than breaking sign-in.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null = null;
let attempted = false;

function getTransporter(): Transporter | null {
  if (attempted) return transporter;
  attempted = true;
  const url = env().SMTP_URL;
  if (!url) return null;
  transporter = createTransport(url);
  return transporter;
}

export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const { logger } = getContainer();
  const transport = getTransporter();

  if (!transport) {
    if (isProduction()) {
      logger.warn('SMTP_URL is not configured; email not sent', { subject: message.subject });
    } else {
      logger.info('email (not sent, no SMTP configured)', {
        subject: message.subject,
        preview: message.text.slice(0, 400),
      });
    }
    return false;
  }

  try {
    await transport.sendMail({
      from: env().EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: wrapHtml(message.html) } : {}),
    });
    return true;
  } catch (error) {
    logger.error('email delivery failed', { subject: message.subject, error });
    return false;
  }
}

function wrapHtml(body: string): string {
  return `<!doctype html><html><body style="margin:0;padding:32px;background:#F7F7F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#15161A">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E4E5E9;border-radius:20px;padding:28px">
${body}
<p style="margin-top:28px;padding-top:16px;border-top:1px solid #E4E5E9;font-size:12px;color:#767983">
<a href="${appUrl()}" style="color:#6374FF;text-decoration:none">Companion</a>
</p></div></body></html>`;
}

export function recipientCodeEmail(input: {
  code: string;
  companionName: string;
  senderLabel: string | null;
}): EmailMessage {
  const from = input.senderLabel ? ` by ${input.senderLabel}` : '';
  return {
    to: '',
    subject: `Your code for ${input.companionName}`,
    text: `Your confirmation code is ${input.code}.\n\nIt lets you open "${input.companionName}", shared with you${from}. The code expires in 15 minutes.\n\nThe sender will be able to see that you opened the document.`,
    html: `<p style="font-size:15px;margin:0 0 16px">Your confirmation code is</p>
<p style="font-size:30px;letter-spacing:6px;font-weight:600;margin:0 0 16px">${input.code}</p>
<p style="font-size:14px;color:#767983;margin:0">It lets you open <strong>${escapeHtml(input.companionName)}</strong>, shared with you${escapeHtml(from)}. The code expires in 15 minutes. The sender will be able to see that you opened the document.</p>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
