import { clsx } from 'clsx';

/** The Companion mark: a rounded square C with a restrained gradient. */
export function CompanionMark({
  size = 28,
  className,
  monochrome = false,
}: {
  size?: number;
  className?: string;
  monochrome?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id="companion-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6879FF" />
          <stop offset="0.52" stopColor="#9B79FF" />
          <stop offset="1" stopColor="#69D4CA" />
        </linearGradient>
      </defs>
      <rect
        width="32"
        height="32"
        rx="9"
        fill={monochrome ? 'currentColor' : 'url(#companion-mark)'}
      />
      <path
        d="M21.4 12.3a6.2 6.2 0 0 0-5-2.4c-3.6 0-6.3 2.7-6.3 6.1s2.7 6.1 6.3 6.1a6.2 6.2 0 0 0 5-2.4"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function Wordmark({ className, size = 26 }: { className?: string; size?: number }) {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <CompanionMark size={size} />
      <span className="text-[15px] font-[560] tracking-[-0.02em] text-ink">Companion</span>
    </span>
  );
}

/** The sparkle that precedes every Ask affordance. Never a robot. */
export function AskGlyph({ className, size = 14 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M8 1.4l1.5 4.1 4.1 1.5-4.1 1.5L8 12.6 6.5 8.5 2.4 7l4.1-1.5L8 1.4Z"
        fill="currentColor"
      />
      <path d="M13.2 10.6l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9Z" fill="currentColor" opacity="0.55" />
    </svg>
  );
}
