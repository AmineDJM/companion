import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { billingEnabled } from '@/server/env';
import { listPlans } from '@companion/shared';
import { getAuthContext } from '@/server/auth/session';
import { getContainer } from '@/server/container';
import { PricingTable } from '@/components/pricing-table';
import { schema } from '@companion/db';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Simple plans for sharing documents that answer questions. Pay for how much you share and how much people interact with it — no tokens, no AI jargon.',
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: 'Companion pricing',
    description: 'Pay for how much you share and how much people interact with it.',
    url: '/pricing',
  },
};

export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  // Nothing is for sale while Stripe is unconfigured, so this page does not
  // exist rather than showing prices that lead to a 503.
  if (!billingEnabled()) notFound();

  const auth = await getAuthContext().catch(() => null);
  const { db } = getContainer();

  // Plans are configuration, not code: an operator can edit entitlements in
  // /admin and the public page reflects it without a deploy.
  const rows = await db.select().from(schema.plans).orderBy(schema.plans.sortOrder);
  const fallback = listPlans();

  const plans = (rows.length > 0 ? rows : []).filter((row) => row.isPublic);
  const resolved =
    plans.length > 0
      ? plans.map((plan) => ({
          key: plan.key,
          displayName: plan.displayName,
          tagline: plan.tagline,
          monthlyPriceCents: plan.monthlyPriceCents,
          annualPriceCents: plan.annualPriceCents,
          currency: plan.currency,
          highlights: plan.highlights,
        }))
      : fallback.map((plan) => ({
          key: plan.key,
          displayName: plan.displayName,
          tagline: plan.tagline,
          monthlyPriceCents: plan.monthlyPriceCents,
          annualPriceCents: plan.annualPriceCents,
          currency: plan.currency,
          highlights: plan.highlights,
        }));

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-xl text-center">
        <h1 className="text-[32px] leading-tight tracking-[-0.03em] text-ink text-balance">
          Simple enough to forget about.
        </h1>
        <p className="mt-3.5 text-[15px] leading-relaxed text-ink-muted text-pretty">
          Pay for how much you share and how much people interact with it. No tokens, no AI jargon.
        </p>
      </div>

      <PricingTable
        plans={resolved}
        currentPlan={auth?.workspace.planKey ?? null}
        authenticated={Boolean(auth)}
      />

      <section className="mx-auto mt-16 max-w-2xl" aria-labelledby="pricing-faq">
        <h2 id="pricing-faq" className="text-[19px] text-ink">
          Questions about plans
        </h2>
        <dl className="mt-5 divide-y divide-line">
          <Faq
            q="What counts as a question?"
            a="One question a recipient asks and gets an answer to. Refused or failed requests never count."
          />
          <Faq
            q="What happens if I run out of questions?"
            a="Your documents stay available and readable. Asking pauses until the next cycle, or until you move to a larger plan."
          />
          <Faq
            q="What if I downgrade and have too many Companions?"
            a="Nothing is deleted. You simply cannot create new ones until you archive a few."
          />
          <Faq
            q="Do recipients need to pay or sign up?"
            a="Never. Recipients open your link and read. Only senders have accounts."
          />
        </dl>
      </section>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="py-4">
      <dt className="text-[14.5px] font-[520] text-ink">{q}</dt>
      <dd className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted text-pretty">{a}</dd>
    </div>
  );
}
