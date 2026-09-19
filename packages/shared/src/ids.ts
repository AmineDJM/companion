import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Public share slugs use a short, non-sequential, mixed-case alphabet so links
 * look like `companion.app/x8K2pz`. Ambiguous characters are excluded.
 */
const SLUG_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
export const DEFAULT_SLUG_LENGTH = 6;

export function generateSlug(length: number = DEFAULT_SLUG_LENGTH): string {
  const alphabetLength = SLUG_ALPHABET.length;
  // Rejection sampling keeps the distribution uniform across the alphabet.
  const max = 256 - (256 % alphabetLength);
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= max) continue;
      out += SLUG_ALPHABET[byte % alphabetLength];
      if (out.length === length) break;
    }
  }
  return out;
}

const SLUG_PATTERN = new RegExp(`^[${SLUG_ALPHABET}]{4,24}$`);

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function newId(): string {
  return randomUUID();
}

/** Constant-time comparison for opaque tokens. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so the timing does not reveal length mismatches.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function generateNumericCode(digits = 6): string {
  const buf = randomBytes(4).readUInt32BE(0);
  return (buf % 10 ** digits).toString().padStart(digits, '0');
}
