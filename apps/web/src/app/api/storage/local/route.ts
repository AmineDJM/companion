import { AppError } from '@companion/shared';
import { LocalStorageDriver } from '@companion/storage';
import { getContainer } from '@/server/container';
import { route } from '@/server/http';

export const runtime = 'nodejs';

/**
 * Serves objects for the filesystem storage driver used in development and
 * tests. It honours the same HMAC-signed, expiring URLs the S3 driver would
 * presign, so the code path the app exercises locally matches production.
 * Refused outright when the production S3 driver is configured.
 */
export const GET = route(async (request) => {
  const { storage } = getContainer();
  if (!(storage instanceof LocalStorageDriver)) {
    throw new AppError('not_found', 'Not found.');
  }

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  const expires = Number.parseInt(url.searchParams.get('expires') ?? '', 10);
  const signature = url.searchParams.get('signature');
  const filename = url.searchParams.get('filename');

  if (!key || !signature || !Number.isFinite(expires)) {
    throw new AppError('validation_failed', 'Invalid request.');
  }
  if (!storage.verify(key, expires, signature)) {
    throw new AppError('forbidden', 'This link has expired.');
  }

  const head = await storage.head(key);
  if (!head) throw new AppError('not_found', 'Not found.');
  const bytes = await storage.get(key);

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': head.contentType,
      'content-length': String(bytes.byteLength),
      ...(filename
        ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` }
        : {}),
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
});
