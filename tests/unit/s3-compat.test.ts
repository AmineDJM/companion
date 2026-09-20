import { describe, expect, it } from 'vitest';
import { S3StorageDriver } from '../../packages/storage/src/s3-driver';

/**
 * Talking to an S3-compatible store that is not S3.
 *
 * Since v3.729 the AWS SDK computes a CRC32 for every upload and sends it as
 * a trailer, which makes the body an `aws-chunked` stream. AWS reads that;
 * several compatible stores reject it, Supabase Storage among them. The
 * failure is nasty because it is partial: HeadBucket and GetObject succeed, so
 * the configuration looks right and only writes fail.
 */
function clientConfigFor(endpoint?: string) {
  const driver = new S3StorageDriver({
    bucket: 'companion',
    region: 'eu-central-1',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    ...(endpoint ? { endpoint } : {}),
  });
  // Reaching into the driver on purpose: asserting the string appears in the
  // source would pass just as well if the option were misspelled or ignored.
  return (driver as unknown as { client: { config: Record<string, unknown> } }).client.config;
}

async function resolve(value: unknown): Promise<unknown> {
  return typeof value === 'function' ? await (value as () => unknown)() : value;
}

describe('a custom endpoint', () => {
  it('does not volunteer checksums the store may refuse', async () => {
    const config = clientConfigFor('https://abc.supabase.co/storage/v1/s3');

    expect(await resolve(config['requestChecksumCalculation'])).toBe('WHEN_REQUIRED');
    expect(await resolve(config['responseChecksumValidation'])).toBe('WHEN_REQUIRED');
  });

  it('addresses buckets by path, which is what such stores expect', async () => {
    expect(await resolve(clientConfigFor('https://abc.supabase.co/storage/v1/s3')['forcePathStyle'])).toBe(true);
  });
});

describe('AWS itself', () => {
  it('keeps the SDK default, because it can use the integrity check', async () => {
    const config = clientConfigFor();

    expect(await resolve(config['requestChecksumCalculation'])).toBe('WHEN_SUPPORTED');
    expect(await resolve(config['forcePathStyle'])).toBe(false);
  });
});
