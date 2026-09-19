import { AppError } from '@companion/shared';
import { requireAuth } from '@/server/auth/session';
import { json, route } from '@/server/http';
import { createPortalSession } from '@/server/services/billing';

export const runtime = 'nodejs';

export const POST = route(async () => {
  const auth = await requireAuth();
  if (auth.workspace.role !== 'owner' && auth.workspace.role !== 'admin') {
    throw new AppError('forbidden', 'Only a workspace owner can manage billing.');
  }
  const url = await createPortalSession(auth.workspace.id);
  return json({ url });
});
