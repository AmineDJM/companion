import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageError, type PutObjectInput, type SignedUrlOptions, type StorageDriver, type StoredObject } from './types.js';

export interface S3DriverConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Set for R2, MinIO, Backblaze and other S3-compatible endpoints. */
  endpoint?: string;
  /** Required by MinIO and most self-hosted gateways. */
  forcePathStyle?: boolean;
  defaultSignedUrlSeconds?: number;
}

const DEFAULT_SIGNED_SECONDS = 300;

export class S3StorageDriver implements StorageDriver {
  readonly name = 's3';
  readonly supportsDirectUpload = true;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly defaultExpiry: number;

  constructor(config: S3DriverConfig) {
    this.bucket = config.bucket;
    this.defaultExpiry = config.defaultSignedUrlSeconds ?? DEFAULT_SIGNED_SECONDS;
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
    });
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const body = input.body instanceof Readable ? await streamToBuffer(input.body) : input.body;
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: body,
        ContentType: input.contentType,
        ContentLength: input.contentLength ?? body.byteLength,
        ...(input.downloadFilename
          ? { ContentDisposition: contentDisposition(input.downloadFilename) }
          : {}),
        ...(input.metadata ? { Metadata: input.metadata } : {}),
      }),
    );
    return {
      key: input.key,
      size: body.byteLength,
      contentType: input.contentType,
      etag: result.ETag,
    };
  }

  async get(key: string): Promise<Buffer> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) throw new StorageError('Empty object body', key);
      return await streamToBuffer(result.Body as Readable);
    } catch (error) {
      throw new StorageError(`Unable to read object`, key, { cause: error });
    }
  }

  async getStream(key: string): Promise<Readable> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new StorageError('Empty object body', key);
    return result.Body as Readable;
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        size: result.ContentLength ?? 0,
        contentType: result.ContentType ?? 'application/octet-stream',
        etag: result.ETag,
        lastModified: result.LastModified,
      };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    // S3 caps a single delete request at 1000 objects.
    for (let index = 0; index < keys.length; index += 1000) {
      const batch = keys.slice(index, index + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }

  async list(prefix: string, limit = 1000): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let token: string | undefined;
    do {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          MaxKeys: Math.min(limit - out.length, 1000),
          ContinuationToken: token,
        }),
      );
      for (const item of result.Contents ?? []) {
        if (!item.Key) continue;
        out.push({
          key: item.Key,
          size: item.Size ?? 0,
          contentType: 'application/octet-stream',
          etag: item.ETag,
          lastModified: item.LastModified,
        });
      }
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (token && out.length < limit);
    return out;
  }

  async signedDownloadUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(options.downloadFilename
          ? { ResponseContentDisposition: contentDisposition(options.downloadFilename) }
          : {}),
        ...(options.contentType ? { ResponseContentType: options.contentType } : {}),
      }),
      { expiresIn: options.expiresIn ?? this.defaultExpiry },
    );
  }

  async signedUploadUrl(
    key: string,
    contentType: string,
    options: SignedUrlOptions = {},
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: options.expiresIn ?? 900 },
    );
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; message?: string }> {
    const started = Date.now();
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { healthy: true, latencyMs: Date.now() - started };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - started,
        // Only the error name is surfaced; provider payloads can carry credentials.
        message: error instanceof Error ? error.name : 'unknown error',
      };
    }
  }
}

export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
