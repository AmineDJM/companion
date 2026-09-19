import { AppError } from '@companion/shared';
import { headers } from 'next/headers';
import { hashClientIp } from '@/server/auth/session';
import { json, parseJson, route } from '@/server/http';
import { createDraft } from '@/server/services/drafts';
import { checkRateLimit } from '@/server/services/rate-limit';
import { z } from 'zod';

export const runtime = 'nodejs';

const bodySchema = z.object({ name: z.string().trim().max(140).optional() });

/** Starts an anonymous upload from the homepage. No account required yet. */
export const POST = route(async (request) => {
  const input = await parseJson(request, bodySchema);
  const requestHeaders = await headers();
  const ipHash = hashClientIp(requestHeaders);

  const limit = await checkRateLimit({
    key: `draft:create:${ipHash ?? 'unknown'}`,
    windowSeconds: 3_600,
    max: 20,
  });
  if (!limit.allowed) {
    throw new AppError('rate_limited', 'Too many uploads from this network. Try again later.');
  }

  const draft = await createDraft(input.name);
  return json({ draftToken: draft.token });
});
