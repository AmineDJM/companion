import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing with scrypt.
 *
 * scrypt is in Node's standard library, needs no native build step (which keeps
 * the Render image simple) and is memory-hard. Parameters are stored in the
 * hash string so they can be raised later without invalidating old hashes.
 */
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password.normalize('NFKC'), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1] as string, 'base64url');
  const expected = Buffer.from(parts[2] as string, 'base64url');
  try {
    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Opaque session/recipient tokens are stored only as a digest. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Salted, non-reversible hash of an IP address for rate limiting only. The raw
 * address is never persisted; the salt rotates daily so the value cannot be
 * used to track a visitor across days.
 */
export function hashIp(ip: string, secret: string, date: Date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return createHmac('sha256', secret).update(`${day}:${ip}`).digest('hex').slice(0, 32);
}

export function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = signPayload(payload, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
