import { formatCompactNumber } from '@companion/shared';
import { ProgressBar } from '../ui/primitives';

/**
 * Usage is always expressed in questions. Customers understand questions;
 * tokens are an internal concern and never appear in the product.
 */
export function UsageMeter({
  used,
  allowance,
  utilisation,
}: {
  used: number;
  allowance: number;
  utilisation: number;
}) {
  const tone = utilisation >= 1 ? 'danger' : utilisation >= 0.85 ? 'warning' : 'accent';
  return (
    <div className="mt-1.5">
      <p className="text-[19px] font-[560] tracking-[-0.02em] text-ink tabular-nums">
        {formatCompactNumber(used)}
        <span className="text-[14px] font-normal text-ink-subtle">
          {' '}
          / {formatCompactNumber(allowance)}
        </span>
      </p>
      <ProgressBar
        value={utilisation * 100}
        tone={tone}
        className="mt-2"
        label={`${used} of ${allowance} questions used this cycle`}
      />
      <p className="mt-1.5 text-[12px] text-ink-subtle">
        {allowance - used > 0
          ? `${formatCompactNumber(allowance - used)} questions left this cycle`
          : 'Question allowance reached'}
      </p>
    </div>
  );
}
