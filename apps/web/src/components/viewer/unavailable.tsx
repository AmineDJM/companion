import Link from 'next/link';
import type { ErrorCode } from '@companion/shared';
import { CompanionMark } from '../ui/logo';

/**
 * What a recipient sees when a link is dead.
 *
 * One plain sentence, no diagnostics and no hint about what the document was.
 * A revoked and a never-existed link are deliberately indistinguishable.
 */
export function UnavailableScreen({
  title,
  description,
  code,
}: {
  title: string;
  description?: string;
  code: ErrorCode;
}) {
  const supporting =
    description ??
    (code === 'companion_expired'
      ? 'Ask the person who shared it to extend or resend the link.'
      : code === 'companion_paused'
        ? 'The sender has paused access. Try again later.'
        : 'If you think this is a mistake, contact the person who shared it with you.');

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-5 py-12">
      <div className="w-full max-w-sm text-center">
        <div className="card px-7 py-10">
          <h1 className="text-[19px] text-ink text-balance">{title}</h1>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-muted text-pretty">
            {supporting}
          </p>
        </div>
        <Link
          href="/"
          className="mt-5 inline-flex items-center justify-center gap-1.5 text-[11.5px] text-ink-subtle transition-colors hover:text-ink-muted"
        >
          <CompanionMark size={12} />
          Companion
        </Link>
      </div>
    </div>
  );
}
