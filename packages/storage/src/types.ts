import type { Readable } from 'node:stream';

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array | Readable;
  contentType: string;
  contentLength?: number;
  /** Sets Content-Disposition so a signed download restores the real filename. */
  downloadFilename?: string;
  metadata?: Record<string, string>;
}

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
  etag?: string;
  lastModified?: Date;
}

export interface SignedUrlOptions {
  /** Seconds the URL stays valid. Keep short: these point at private originals. */
  expiresIn?: number;
  downloadFilename?: string;
  contentType?: string;
}

/**
 * Object storage abstraction.
 *
 * Originals live in a private bucket and are never addressable by a browser;
 * everything the viewer sees is either streamed through an authorising route
 * handler or fetched with a short-lived signed URL minted after an access check.
 */
export interface StorageDriver {
  readonly name: string;
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  getStream(key: string): Promise<Readable>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
  list(prefix: string, limit?: number): Promise<StoredObject[]>;
  /** Presigned GET. Only ever minted after an access decision has been made. */
  signedDownloadUrl(key: string, options?: SignedUrlOptions): Promise<string>;
  /** Presigned PUT for direct browser uploads, bypassing the app's body limit. */
  signedUploadUrl(key: string, contentType: string, options?: SignedUrlOptions): Promise<string>;
  /** True when the driver can mint presigned upload URLs. */
  readonly supportsDirectUpload: boolean;
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number; message?: string }>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly key?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'StorageError';
  }
}
