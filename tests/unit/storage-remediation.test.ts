import { describe, expect, it } from 'vitest';
import { storageRemediation } from '../../apps/web/src/server/services/readiness';

/**
 * What the readiness page tells an operator to do next.
 *
 * This page exists to end an outage, and it failed at that: a real deployment
 * showed "Storage round trip — CRITICAL — Error", with a remediation naming
 * three possible causes. The provider had already said which one it was.
 *
 * Every branch below is a different fix. Collapsing them into one sentence
 * means trying all of them.
 */
describe('storageRemediation', () => {
  it('points at a missing endpoint when the bucket is not found', () => {
    const advice = storageRemediation('Could not reach the bucket: NoSuchBucket · HTTP 404');
    expect(advice).toContain('S3_ENDPOINT');
    expect(advice).toContain('never a URL');
  });

  it('points at the credentials and the region when a signature is rejected', () => {
    // A request signed for the wrong region fails identically to a wrong key,
    // and Supabase and Backblaze both need storage-specific keys rather than
    // the project's API keys. Naming only the keys sends an operator to
    // re-check the one thing that was already correct.
    for (const error of ['InvalidAccessKeyId · HTTP 403', 'SignatureDoesNotMatch · HTTP 403']) {
      const advice = storageRemediation(error);
      expect(advice).toContain('S3_SECRET_ACCESS_KEY');
      expect(advice).toContain('S3_REGION');
    }
  });

  it('points at the key’s rights when it is valid but not allowed', () => {
    // The distinction that matters: nothing about the configuration is wrong,
    // so re-checking the keys would waste the whole investigation.
    const advice = storageRemediation('Could not write to the bucket: AccessDenied · HTTP 403');
    expect(advice).toContain('read, write and delete');
    expect(advice).not.toContain('S3_ENDPOINT');
  });

  it('points at the region on a redirect', () => {
    expect(storageRemediation('PermanentRedirect · HTTP 301')).toContain('S3_REGION');
  });

  it('points at the endpoint URL when the hostname does not resolve', () => {
    const advice = storageRemediation('Error · getaddrinfo ENOTFOUND abc.r2.cloudflarestorage.com');
    expect(advice).toContain('S3_ENDPOINT');
    expect(advice).toContain('not the bucket');
  });

  it('falls back to the general advice rather than guessing', () => {
    expect(storageRemediation('something nobody has seen before')).toContain('Check the bucket name');
    expect(storageRemediation(undefined)).toContain('Check the bucket name');
  });
});

describe('a TLS failure, which is not what it looks like', () => {
  it('names bucket addressing rather than sending anyone back to the credentials', () => {
    // This is the error a real deployment hit. Nothing in it mentions S3, a
    // bucket or addressing, so it reads like a network fault — and the generic
    // "check the bucket name, credentials and that the bucket is writable"
    // pointed at all three of the wrong things.
    const advice = storageRemediation(
      'Could not reach the bucket: write EPROTO 00:error:0A000410:SSL routines:' +
        'ssl3_read_bytes:ssl/tls alert handshake failure:SSL alert number 40',
    );

    expect(advice).toContain('S3_FORCE_PATH_STYLE');
    expect(advice).toContain('not a credentials problem');
  });

  it('says the same when the certificate simply does not cover the host', () => {
    const advice = storageRemediation(
      'Hostname/IP does not match certificate’s altnames: Host: companion.abc.supabase.co',
    );
    expect(advice).toContain('S3_FORCE_PATH_STYLE');
  });
});
