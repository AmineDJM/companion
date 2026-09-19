import { adminSearchSchema } from '@companion/shared';
import { json, parseQuery, route } from '@/server/http';
import { adminSearch } from '@/server/services/admin';
import { adminContext } from '../_guard';

export const runtime = 'nodejs';

export const GET = route(async (request) => {
  await adminContext();
  const { q } = parseQuery(request, adminSearchSchema);
  const results = await adminSearch(q);
  return json({ results });
});
