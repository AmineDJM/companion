import { createHmac, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { StorageError, type PutObjectInput, type SignedUrlOptions, type StorageDriver, type StoredObject } from './types.js';
import { streamToBuffer } from './s3-driver.js';

export interface LocalDriverConfig {
  /** Directory that backs the bucket. Must not be inside the served web root. */
  root: string;
  /** Base URL of the app, used to build the signed-URL redirect path. */
  publicBaseUrl: string;
  /** Secret used to sign local URLs so they behave like real presigned URLs. */
  signingSecret: string;
  defaultSignedUrlSeconds?: number;
}

/**
 * Filesystem-backed driver for local development and integration tests.
 *
 * It intentionally mimics the security posture of S3: objects are not reachable
 * by path, and `signedDownloadUrl` returns an HMAC-signed, expiring URL that
 * only the app's storage route will honour.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  readonly supportsDirectUpload = false;
  private readonly root: string;
  private readonly publicBaseUrl: string;
  private readonly signingSecret: string;
  private readonly defaultExpiry: number;

  constructor(config: LocalDriverConfig) {
    this.root = resolve(config.root);
    this.publicBaseUrl = config.publicBaseUrl.replace(/\/$/, '');
    this.signingSecret = config.signingSecret;
    this.defaultExpiry = config.defaultSignedUrlSeconds ?? 300;
  }

  /** Resolves a key to a path and refuses anything that escapes the root. */
  private pathFor(key: string): string {
    const target = resolve(this.root, key);
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new StorageError('Refusing to access a path outside the storage root', key);
    }
    return target;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const body =
      typeof (input.body as Readable).pipe === 'function'
        ? await streamToBuffer(input.body as Readable)
        : Buffer.from(input.body as Uint8Array);
    const path = this.pathFor(input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    await writeFile(
      `${path}.meta.json`,
      JSON.stringify({
        contentType: input.contentType,
        downloadFilename: input.downloadFilename ?? null,
        metadata: input.metadata ?? {},
      }),
    );
    return { key: input.key, size: body.byteLength, contentType: input.contentType };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error) {
      throw new StorageError('Unable to read object', key, { cause: error });
    }
  }

  async getStream(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    await stat(path);
    return createReadStream(path);
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const path = this.pathFor(key);
      const info = await stat(path);
      let contentType = 'application/octet-stream';
      try {
        const meta = JSON.parse(await readFile(`${path}.meta.json`, 'utf8')) as {
          contentType?: string;
        };
        contentType = meta.contentType ?? contentType;
      } catch {
        // Metadata sidecar is optional.
      }
      return { key, size: info.size, contentType, lastModified: info.mtime };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);
    await rm(path, { force: true });
    await rm(`${path}.meta.json`, { force: true });
  }

  async deleteMany(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.delete(key)));
  }

  async list(prefix: string, limit = 1000): Promise<StoredObject[]> {
    const base = this.pathFor(prefix);
    const results: StoredObject[] = [];
    const walk = async (dir: string, relative: string): Promise<void> => {
      if (results.length >= limit) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= limit) return;
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(join(dir, entry.name), childRelative);
        } else if (!entry.name.endsWith('.meta.json')) {
          const info = await stat(join(dir, entry.name));
          results.push({
            key: prefix.endsWith('/') ? `${prefix}${childRelative}` : `${prefix}/${childRelative}`,
            size: info.size,
            contentType: 'application/octet-stream',
            lastModified: info.mtime,
          });
        }
      }
    };
    const info = await stat(base).catch(() => null);
    if (info?.isDirectory()) await walk(base, '');
    else if (info) results.push({ key: prefix, size: info.size, contentType: 'application/octet-stream' });
    return results;
  }

  async signedDownloadUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + (options.expiresIn ?? this.defaultExpiry);
    const signature = this.sign(key, expires);
    const params = new URLSearchParams({ key, expires: String(expires), signature });
    if (options.downloadFilename) params.set('filename', options.downloadFilename);
    return `${this.publicBaseUrl}/api/storage/local?${params.toString()}`;
  }

  async signedUploadUrl(): Promise<string> {
    throw new StorageError('The local driver does not support direct browser uploads');
  }

  sign(key: string, expiresAtSeconds: number): string {
    return createHmac('sha256', this.signingSecret)
      .update(`${key}:${expiresAtSeconds}`)
      .digest('hex');
  }

  verify(key: string, expiresAtSeconds: number, signature: string): boolean {
    if (expiresAtSeconds * 1000 < Date.now()) return false;
    const expected = this.sign(key, expiresAtSeconds);
    return expected.length === signature.length && expected === signature;
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; message?: string }> {
    const started = Date.now();
    try {
      const probe = join(this.root, `.health-${randomUUID()}`);
      await mkdir(this.root, { recursive: true });
      await writeFile(probe, 'ok');
      await rm(probe, { force: true });
      return { healthy: true, latencyMs: Date.now() - started };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - started,
        message: error instanceof Error ? error.name : 'unknown error',
      };
    }
  }
}
