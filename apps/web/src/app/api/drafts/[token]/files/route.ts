import { AppError, describeFile } from '@companion/shared';
import { headers } from 'next/headers';
import { hashClientIp } from '@/server/auth/session';
import { json, route } from '@/server/http';
import { addFileToDraft } from '@/server/services/drafts';
import { checkRateLimit } from '@/server/services/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = route(async (request, context: { params: Promise<{ token: string }> }) => {
  const { token } = await context.params;
  const requestHeaders = await headers();
  const ipHash = hashClientIp(requestHeaders);

  const limit = await checkRateLimit({
    key: `draft:upload:${ipHash ?? 'unknown'}`,
    windowSeconds: 3_600,
    max: 200,
  });
  if (!limit.allowed) {
    throw new AppError('rate_limited', 'Too many uploads. Try again later.');
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError('validation_failed', 'No file was received.');

  const relativePath = String(form.get('relativePath') ?? file.name);
  const bytes = Buffer.from(await file.arrayBuffer());
  const info = describeFile(file.name);

  const result = await addFileToDraft({
    token,
    filename: file.name,
    bytes,
    contentType: file.type || info.mimeType,
    relativePath,
  });

  return json({ ok: true, stored: result.stored });
});
