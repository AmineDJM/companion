/** Brand tokens shared between the app, emails and Open Graph images. */
export const BRAND = {
  name: 'Companion',
  tagline: 'Share documents that can answer questions.',
  description:
    'Share PDFs, documents and ZIPs through one intelligent link. Let recipients read, ask questions, and stay in control with expiration, revocation and download restrictions.',
  colors: {
    background: '#F7F7F8',
    surface: '#FFFFFF',
    text: '#15161A',
    muted: '#767983',
    border: '#E4E5E9',
    accent: '#6374FF',
    accentSoft: '#EEF0FF',
    success: '#2FA36B',
    danger: '#BA4C58',
    gradient: ['#6879FF', '#9B79FF', '#69D4CA'] as const,
  },
} as const;

export const ASK_PLACEHOLDER_SINGLE = 'Ask anything…';
export const ASK_PLACEHOLDER_MULTI = 'Ask anything across these files…';

/** The five steps shown while a Companion is being built. Deliberately non-technical. */
export const PROCESSING_STEPS = [
  { key: 'reading', label: 'Reading files' },
  { key: 'structure', label: 'Extracting structure' },
  { key: 'understanding', label: 'Understanding content' },
  { key: 'index', label: 'Building search index' },
  { key: 'ready', label: 'Preparing Companion' },
] as const;

export type ProcessingStepKey = (typeof PROCESSING_STEPS)[number]['key'];
