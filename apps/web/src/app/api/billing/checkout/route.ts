import { AppError, checkoutSchema } from '@companion/shared';
import { requireAuth } from '@/server/auth/session';
import { json, parseJson, route } from '@/server/http';
import { createCheckoutSession } from '@/server/services/billing';

export const runtime = 'nodejs';

export const POST = route(async (request) => {
  const auth = await requireAuth();
  const input = await parseJson(request, checkoutSchema);

  if (auth.workspace.role !== 'owner' && auth.workspace.role !== 'admin') {
    throw new AppError('forbidden', 'Only a workspace owner can change the plan.');
  }

  const url = await createCheckoutSession({
    workspaceId: auth.workspace.id,
    workspaceName: auth.workspace.name,
    userId: auth.user.id,
    email: auth.user.email,
    planKey: input.planKey,
    interval: input.interval,
  });

  return json({ url });
});
