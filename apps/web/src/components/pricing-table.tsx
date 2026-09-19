'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatCurrencyCents, isFeaturedPlan, isFreePlan, type PlanKey } from '@companion/shared';
import { clsx } from 'clsx';
import { ApiError, apiFetch } from '../lib/api';
import { Button } from './ui/button';
import { SegmentedControl } from './ui/fields';
import { Badge } from './ui/primitives';
import { CheckIcon } from './ui/icons';

export interface PricingPlan {
  key: string;
  displayName: string;
  tagline: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  currency: string;
  highlights: string[];
}

export function PricingTable({
  plans,
  currentPlan,
  authenticated,
}: {
  plans: PricingPlan[];
  currentPlan: string | null;
  authenticated: boolean;
}) {
  const router = useRouter();
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly');
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (planKey: string) => {
    if (!authenticated) {
      router.push(`/signup?plan=${planKey}`);
      return;
    }
    // The Free plan has no Stripe price, so there is nothing to check out.
    if (isFreePlan(planKey)) {
      router.push('/billing');
      return;
    }

    setBusyPlan(planKey);
    setError(null);
    try {
      const response = await apiFetch<{ url: string }>('/api/billing/checkout', {
        method: 'POST',
        json: { planKey: planKey as PlanKey, interval },
      });
      window.location.href = response.url;
    } catch (checkoutError) {
      setError(
        checkoutError instanceof ApiError
          ? checkoutError.message
          : 'Could not start checkout. Please try again.',
      );
      setBusyPlan(null);
    }
  };

  return (
    <>
      <div className="mt-8 flex justify-center">
        <SegmentedControl
          ariaLabel="Billing interval"
          value={interval}
          onChange={setInterval}
          options={[
            { value: 'monthly', label: 'Monthly' },
            { value: 'annual', label: 'Yearly — save 20%' },
          ]}
        />
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-center text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-8 grid gap-4 lg:grid-cols-4">
        {plans.map((plan) => {
          const isCurrent = currentPlan === plan.key;
          // The yearly figure is shown as a monthly equivalent, while Stripe
          // charges the real annual amount.
          const monthlyEquivalent =
            interval === 'annual' ? Math.round(plan.annualPriceCents / 12) : plan.monthlyPriceCents;
          const featured = isFeaturedPlan(plan.key);

          return (
            <div
              key={plan.key}
              className={clsx(
                'relative flex flex-col rounded-[20px] border bg-surface p-6',
                featured ? 'border-accent shadow-[0_4px_20px_rgba(99,116,255,0.12)]' : 'border-line',
              )}
            >
              {featured ? (
                <span className="absolute -top-2.5 left-6 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-[520] text-white">
                  Most popular
                </span>
              ) : null}

              <div className="flex items-center gap-2">
                <h2 className="text-[16px] font-[560] text-ink">{plan.displayName}</h2>
                {isCurrent ? <Badge tone="success">Current</Badge> : null}
              </div>
              <p className="mt-1 min-h-[2.5rem] text-[12.5px] leading-relaxed text-ink-muted">
                {plan.tagline}
              </p>

              <p className="mt-4">
                <span className="text-[30px] font-[560] tracking-[-0.03em] text-ink tabular-nums">
                  {monthlyEquivalent === 0
                    ? formatCurrencyCents(0, plan.currency)
                    : formatCurrencyCents(monthlyEquivalent, plan.currency)}
                </span>
                {monthlyEquivalent > 0 ? (
                  <span className="text-[13px] text-ink-muted">/month</span>
                ) : null}
              </p>
              {interval === 'annual' && plan.annualPriceCents > 0 ? (
                <p className="mt-0.5 text-[12px] text-ink-subtle">
                  {formatCurrencyCents(plan.annualPriceCents, plan.currency)} billed yearly
                </p>
              ) : (
                <p className="mt-0.5 text-[12px] text-ink-subtle">
                  {plan.monthlyPriceCents === 0 ? 'Free forever' : 'Billed monthly'}
                </p>
              )}

              <ul className="mt-5 flex-1 space-y-2.5">
                {plan.highlights.map((highlight) => (
                  <li key={highlight} className="flex gap-2 text-[13px] leading-snug text-ink">
                    <CheckIcon size={15} className="mt-0.5 shrink-0 text-success" />
                    {highlight}
                  </li>
                ))}
              </ul>

              <Button
                className="mt-6 w-full"
                variant={featured ? 'primary' : 'secondary'}
                disabled={isCurrent}
                loading={busyPlan === plan.key}
                onClick={() => void choose(plan.key)}
              >
                {isCurrent
                  ? 'Your plan'
                  : isFreePlan(plan.key)
                    ? 'Start free'
                    : `Choose ${plan.displayName}`}
              </Button>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-center text-[12.5px] text-ink-subtle">
        Prices in euro, excluding VAT. Cancel any time from your billing settings.
      </p>
    </>
  );
}
