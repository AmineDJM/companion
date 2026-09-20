import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../apps/web/src/server/env';
import { loadWorkerEnv } from '../../apps/worker/src/env';

/**
 * A declared-but-empty environment variable.
 *
 * Render has no way to express "this variable exists so another service can
 * inherit it, but it has no value here". The blueprint declares S3_ENDPOINT
 * with an empty value for exactly that reason: the worker reads it from the
 * web service, and inheriting a variable that does not exist is not possible.
 *
 * So on every AWS deployment S3_ENDPOINT arrives as "". If the schema treated
 * that as a value it would fail `.url()` and take both services down at boot
 * — on the most common configuration there is. A blank field is an operator
 * saying "not this one", and must mean the same as never having typed it.
 */
const BASE = {
  DATABASE_URL: 'postgres://companion:companion@127.0.0.1:5432/companion',
  REDIS_URL: 'redis://127.0.0.1:6379',
  SESSION_SECRET: 'x'.repeat(48),
  STORAGE_DRIVER: 's3',
  S3_BUCKET: 'companion',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
};

describe('a variable declared empty so another service can inherit it', () => {
  it('reads an empty endpoint as unset rather than refusing to boot', () => {
    expect(loadEnv({ ...BASE, S3_ENDPOINT: '' }).S3_ENDPOINT).toBeUndefined();
    expect(loadWorkerEnv({ ...BASE, S3_ENDPOINT: '' }).S3_ENDPOINT).toBeUndefined();
  });

  it('treats whitespace the same way, since a pasted field often carries it', () => {
    expect(loadEnv({ ...BASE, S3_ENDPOINT: '   ' }).S3_ENDPOINT).toBeUndefined();
    expect(loadWorkerEnv({ ...BASE, S3_ENDPOINT: '  ' }).S3_ENDPOINT).toBeUndefined();
  });

  it('falls back to the default for an empty boolean', () => {
    expect(loadEnv({ ...BASE, S3_FORCE_PATH_STYLE: '' }).S3_FORCE_PATH_STYLE).toBe(false);
    expect(loadWorkerEnv({ ...BASE, S3_FORCE_PATH_STYLE: '' }).S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('still keeps a real endpoint, which is the case that matters for R2', () => {
    const endpoint = 'https://abc123.r2.cloudflarestorage.com';
    expect(loadEnv({ ...BASE, S3_ENDPOINT: endpoint }).S3_ENDPOINT).toBe(endpoint);
    expect(loadWorkerEnv({ ...BASE, S3_ENDPOINT: endpoint }).S3_ENDPOINT).toBe(endpoint);
  });

  it('still rejects a malformed endpoint rather than passing it to the SDK', () => {
    // A bucket name typed into the endpoint field is the likely mistake, and
    // failing at boot beats every upload failing with an opaque SDK error.
    expect(() => loadEnv({ ...BASE, S3_ENDPOINT: 'companion' })).toThrow();
    expect(() => loadWorkerEnv({ ...BASE, S3_ENDPOINT: 'companion' })).toThrow();
  });
});
