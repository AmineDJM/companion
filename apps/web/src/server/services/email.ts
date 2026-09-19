import type { EmailMessage } from '../email';

/**
 * Message templates.
 *
 * Delivery lives in `server/email`; this module only decides what a message
 * says. Nothing here interpolates document content — a subject line is template
 * text plus a Companion's name, which the sender chose.
 */
export { sendEmail, emailProvider, emailProviderStatus } from '../email';
export type { EmailMessage } from '../email';

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
