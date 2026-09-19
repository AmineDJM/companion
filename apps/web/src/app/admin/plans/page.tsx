import { formatCurrencyCents } from '@companion/shared';
import { requireSuperAdmin } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { schema } from '@companion/db';
import { AdminPage } from '@/components/admin/shell';
import { PlanEditor } from '@/components/admin/plan-editor';

export const dynamic = 'force-dynamic';

export default async function AdminPlansPage() {
  await requireSuperAdmin();
  const { db } = getContainer();
  const plans = await db.select().from(schema.plans).orderBy(schema.plans.sortOrder);

  return (
    <AdminPage
      title="Plans & pricing"
      description="Entitlements are editable here and take effect immediately. Monetary prices require a new Stripe Price object, so existing subscribers stay grandfathered."
    >
      <div className="space-y-4">
        {plans.map((plan) => (
          <PlanEditor
            key={plan.key}
            plan={{
              key: plan.key,
              displayName: plan.displayName,
              tagline: plan.tagline,
              monthlyPrice: formatCurrencyCents(plan.monthlyPriceCents, plan.currency),
              annualPrice: formatCurrencyCents(plan.annualPriceCents, plan.currency),
              entitlements: plan.entitlements,
              highlights: plan.highlights,
              isPublic: plan.isPublic,
              stripeMonthlyPriceId: plan.stripeMonthlyPriceId,
              stripeAnnualPriceId: plan.stripeAnnualPriceId,
            }}
          />
        ))}
      </div>
    </AdminPage>
  );
}
