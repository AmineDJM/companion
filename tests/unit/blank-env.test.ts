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

describe('a leftover platform variable', () => {
  it('does not take the worker down, which is what actually happened', () => {
    // The worker carried a fromService link to a variable the web service no
    // longer declared. Render resolved it to "", .url() refused it, and the
    // process died in a restart loop:
    //
    //   worker failed to start: Invalid worker environment:
    //     - RENDER_EXTERNAL_URL: Invalid URL
    //
    // Nothing needed that variable. A blank must never be the difference
    // between a service that boots and one that does not.
    expect(() => loadWorkerEnv({ ...BASE, RENDER_EXTERNAL_URL: '' })).not.toThrow();
    expect(loadWorkerEnv({ ...BASE, RENDER_EXTERNAL_URL: '' }).RENDER_EXTERNAL_URL).toBeUndefined();

    expect(() => loadEnv({ ...BASE, RENDER_EXTERNAL_URL: '', APP_URL: '' })).not.toThrow();
  });

  it('applies to every optional variable, not the handful anyone thought of', () => {
    const blanks = {
      ...BASE,
      APP_URL: '',
      RENDER_EXTERNAL_URL: '',
      RENDER_EXTERNAL_HOSTNAME: '  ',
      OPENAI_API_KEY: '',
      OPENAI_BASE_URL: '',
      STRIPE_SECRET_KEY: '',
      SUPER_ADMIN_EMAILS: '',
      S3_ENDPOINT: '',
    };

    const env = loadEnv(blanks);
    expect(env.APP_URL).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.S3_ENDPOINT).toBeUndefined();
  });

  it('still refuses a required variable that is blank rather than pretending', () => {
    // Stripping blanks must not turn a missing DATABASE_URL into a default.
    expect(() => loadWorkerEnv({ ...BASE, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });
});
