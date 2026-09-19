import { z } from 'zod';
import { json, parseJson, route } from '@/server/http';
import { retryJob } from '@/server/services/admin-ops';
import { adminContext } from '../../_guard';

export const runtime = 'nodejs';

const bodySchema = z.object({ jobId: z.string().uuid() });

export const POST = route(async (request) => {
  const { adminUserId, adminLabel } = await adminContext();
  const input = await parseJson(request, bodySchema);
  await retryJob({ jobId: input.jobId, adminUserId, adminLabel });
  return json({ ok: true });
});
