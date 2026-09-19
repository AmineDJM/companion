'use client';

import { shareUrl, shareUrlDisplay } from '../../lib/share-url';
import { useClipboard } from '../../lib/use-clipboard';
import { Button } from '../ui/button';
import { CheckIcon, CopyIcon } from '../ui/icons';
import { Mono } from '../ui/primitives';

/** Shown once, immediately after a Companion is ready. */
export function CreatedBanner({ slug }: { slug: string; companionId: string }) {
  const { copied, copy } = useClipboard();

  return (
    <div className="rounded-[18px] border border-accent-line bg-accent-soft px-5 py-5">
      <p className="text-[11px] font-[560] uppercase tracking-[0.13em] text-accent/80">
        Your Companion is ready
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-accent-line bg-surface px-3.5 py-2.5">
          <Mono className="truncate text-ink">{shareUrlDisplay(slug)}</Mono>
        </div>
        <Button
          onClick={() => void copy(shareUrl(slug))}
          icon={copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
        >
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
      <p className="mt-3 text-[13px] text-accent/90">
        Send this link to anyone. They will not need an account, and you can change the rules
        afterwards without ever changing the link.
      </p>
    </div>
  );
}
