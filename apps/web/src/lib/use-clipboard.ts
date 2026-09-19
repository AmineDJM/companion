'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Copy-to-clipboard with a short confirmation state, and a legacy fallback. */
export function useClipboard(resetMs = 2_000): {
  copied: boolean;
  copy: (value: string) => Promise<boolean>;
} {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(
    async (value: string) => {
      let success = false;
      try {
        await navigator.clipboard.writeText(value);
        success = true;
      } catch {
        // Clipboard API needs a secure context; fall back for http:// dev hosts.
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try {
          success = document.execCommand('copy');
        } catch {
          success = false;
        }
        document.body.removeChild(area);
      }

      if (success) {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), resetMs);
      }
      return success;
    },
    [resetMs],
  );

  return { copied, copy };
}
