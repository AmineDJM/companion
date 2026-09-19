import { entitlementsSchema, isPlanKey } from '@companion/shared';
import { z } from 'zod';
import { AppError } from '@companion/shared';
import { json, parseJson, route } from '@/server/http';
import { updatePlanEntitlements } from '@/server/services/admin-ops';
import { adminContext } from '../_guard';

export const runtime = 'nodejs';

const bodySchema = z.object({
  planKey: z.string(),
  entitlements: entitlementsSchema,
  displayName: z.string().trim().min(1).max(80).optional(),
  tagline: z.string().trim().max(300).optional(),
  highlights: z.array(z.string().trim().max(120)).max(12).optional(),
  isPublic: z.boolean().optional(),
  stripeMonthlyPriceId: z.string().max(64).nullable().optional(),
  stripeAnnualPriceId: z.string().max(64).nullable().optional(),
});

export const PATCH = route(async (request) => {
  const { adminUserId, adminLabel } = await adminContext();
  const input = await parseJson(request, bodySchema);
  if (!isPlanKey(input.planKey)) throw new AppError('validation_failed', 'Unknown plan.');

  await updatePlanEntitlements({
    planKey: input.planKey,
    adminUserId,
    adminLabel,
    entitlements: input.entitlements,
    display: {
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.tagline !== undefined ? { tagline: input.tagline } : {}),
      ...(input.highlights ? { highlights: input.highlights } : {}),
      ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
    },
    stripe: {
      ...(input.stripeMonthlyPriceId !== undefined
        ? { monthlyPriceId: input.stripeMonthlyPriceId }
        : {}),
      ...(input.stripeAnnualPriceId !== undefined
        ? { annualPriceId: input.stripeAnnualPriceId }
        : {}),
    },
  });

  return json({ ok: true });
});
