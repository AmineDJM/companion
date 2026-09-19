/** Builds the short public link shown to senders and copied to clipboards. */
export function shareUrl(slug: string, baseUrl?: string): string {
  const base = (baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : '')).replace(
    /\/$/,
    '',
  );
  return `${base}/c/${slug}`;
}

/** The form shown in the UI: hostname plus slug, without the scheme. */
export function shareUrlDisplay(slug: string, baseUrl?: string): string {
  const full = shareUrl(slug, baseUrl);
  return full.replace(/^https?:\/\//, '');
}
