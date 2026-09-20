import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../apps/web/src/server/env';
import { loadWorkerEnv } from '../../apps/worker/src/env';

/**
 * A variable an operator left blank.
 *
 * The blueprint prompts for S3_ENDPOINT because a bucket outside AWS needs
 * one, and an AWS deployment answers that prompt by leaving it empty. Whatever
 * a platform then stores — an absent variable or an empty string — has to mean
 * the same thing here, or the most common configuration there is fails
 * `.url()` and takes both services down at boot.
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

  it('leaves an empty boolean undefined, so the driver derives it', () => {
    // Path style is not a preference with a sensible global default: MinIO
    // requires it and AWS refuses it. Undefined lets the driver decide from
    // whether an endpoint is set; a default would decide wrongly for someone.
    expect(loadEnv({ ...BASE, S3_FORCE_PATH_STYLE: '' }).S3_FORCE_PATH_STYLE).toBeUndefined();
    expect(loadWorkerEnv({ ...BASE, S3_FORCE_PATH_STYLE: '' }).S3_FORCE_PATH_STYLE).toBeUndefined();
    expect(loadEnv(BASE).S3_FORCE_PATH_STYLE).toBeUndefined();
  });

  it('still honours an explicit path-style override', () => {
    expect(loadEnv({ ...BASE, S3_FORCE_PATH_STYLE: 'true' }).S3_FORCE_PATH_STYLE).toBe(true);
    expect(loadWorkerEnv({ ...BASE, S3_FORCE_PATH_STYLE: 'false' }).S3_FORCE_PATH_STYLE).toBe(false);
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
