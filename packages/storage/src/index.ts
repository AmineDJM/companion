export * from './types.js';
export * from './keys.js';
export { S3StorageDriver, streamToBuffer, type S3DriverConfig } from './s3-driver.js';
export { LocalStorageDriver, type LocalDriverConfig } from './local-driver.js';

import { LocalStorageDriver } from './local-driver.js';
import { S3StorageDriver } from './s3-driver.js';
import type { StorageDriver } from './types.js';

export interface StorageFactoryConfig {
  driver: 's3' | 'local';
  publicBaseUrl: string;
  signingSecret: string;
  localRoot?: string;
  s3?: {
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint?: string;
    forcePathStyle?: boolean;
  };
}

/**
 * Chooses the driver from configuration. Production always uses S3-compatible
 * private object storage; `local` exists for development and tests only.
 */
export function createStorage(config: StorageFactoryConfig): StorageDriver {
  if (config.driver === 's3') {
    if (!config.s3) {
      throw new Error('STORAGE_DRIVER=s3 requires bucket and credential configuration');
    }
    return new S3StorageDriver(config.s3);
  }
  return new LocalStorageDriver({
    // Resolved against the process cwd by the driver. Callers should pass an
    // absolute path so the web service and the worker share one root even
    // though they start from different working directories.
    root: config.localRoot ?? '.storage',
    publicBaseUrl: config.publicBaseUrl,
    signingSecret: config.signingSecret,
  });
}
