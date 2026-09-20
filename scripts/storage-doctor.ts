#!/usr/bin/env tsx
import { config as loadEnvFile } from 'dotenv';
import { resolve } from 'node:path';

/**
 * Tells you exactly why object storage is refusing you.
 *
 *   pnpm storage:doctor
 *
 * Run it from a shell on the service itself — on Render, the Shell tab of
 * companion-web — so it reads the same environment the app reads. That matters:
 * the most common cause of "the bucket is configured and uploads still fail" is
 * that the variable you corrected is not the one the process has.
 *
 * It runs the four operations an upload actually needs, one at a time, and
 * prints the provider's own answer for each rather than a summary. The
 * readiness page gives you the first failure; this gives you all of them, in
 * order, which is what distinguishes "the key cannot write" from "the key
 * cannot do anything".
 *
 * Nothing here prints a secret. Keys are shown as a short prefix, which is
 * enough to tell two credentials apart without disclosing either.
 */
loadEnvFile({ path: resolve(process.cwd(), '.env'), quiet: true });

interface StepResult {
  name: string;
  ok: boolean;
  ms: number;
  detail: string;
  skipped?: boolean;
}

function fingerprint(secret: string | undefined): string {
  if (!secret) return 'not set';
  if (secret.length <= 8) return `set (${secret.length} chars)`;
  return `${secret.slice(0, 4)}…${secret.slice(-2)} (${secret.length} chars)`;
}

/** Everything an operator needs to identify a fault, and nothing a credential could hide in. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const meta = (error as { $metadata?: { httpStatusCode?: number; requestId?: string } }).$metadata;
  const parts = [
    error.name && error.name !== 'Error' ? error.name : null,
    meta?.httpStatusCode ? `HTTP ${meta.httpStatusCode}` : null,
    error.message,
    meta?.requestId ? `requestId=${meta.requestId}` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

async function step(name: string, run: () => Promise<string>): Promise<StepResult> {
  const started = Date.now();
  try {
    const detail = await run();
    return { name, ok: true, ms: Date.now() - started, detail };
  } catch (error) {
    return { name, ok: false, ms: Date.now() - started, detail: describe(error) };
  }
}

async function main(): Promise<number> {
  const { loadEnv } = await import('../apps/web/src/server/env');
  const env = loadEnv(process.env);

  const {
    S3Client,
    HeadBucketCommand,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
  } = await import('@aws-sdk/client-s3');

  const endpoint = env.S3_ENDPOINT;
  const pathStyle = env.S3_FORCE_PATH_STYLE ?? Boolean(endpoint);

  console.log('Storage configuration, as this process sees it');
  console.log('──────────────────────────────────────────────');
  console.log(`  driver             ${env.STORAGE_DRIVER}`);
  console.log(`  bucket             ${env.S3_BUCKET ?? 'not set'}`);
  console.log(`  endpoint           ${endpoint ?? 'not set (requests go to AWS)'}`);
  console.log(`  region             ${env.S3_REGION}`);
  console.log(`  path style         ${pathStyle}${env.S3_FORCE_PATH_STYLE === undefined ? ' (derived)' : ''}`);
  console.log(`  access key id      ${fingerprint(env.S3_ACCESS_KEY_ID)}`);
  console.log(`  secret access key  ${fingerprint(env.S3_SECRET_ACCESS_KEY)}`);
  console.log();

  if (env.STORAGE_DRIVER !== 's3') {
    console.log(`STORAGE_DRIVER is "${env.STORAGE_DRIVER}", so there is no bucket to test.`);
    return 1;
  }
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    console.log('Bucket or credentials are missing. Nothing to test until they are set.');
    return 1;
  }
  if (endpoint && env.S3_REGION === 'auto' && !/\br2\.cloudflarestorage\.com/i.test(endpoint)) {
    console.log('⚠ S3_REGION is `auto` with a non-R2 endpoint. Only Cloudflare R2 accepts that;');
    console.log('  elsewhere the request is signed for the wrong region and refused like a bad key.');
    console.log();
  }

  const client = new S3Client({
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: pathStyle,
    // Mirrors the driver: several S3-compatible stores reject the checksum
    // trailer the SDK volunteers by default.
    ...(endpoint
      ? {
          requestChecksumCalculation: 'WHEN_REQUIRED' as const,
          responseChecksumValidation: 'WHEN_REQUIRED' as const,
        }
      : {}),
  });

  const bucket = env.S3_BUCKET;
  const key = `.companion-doctor/${Date.now()}.txt`;
  const probe = Buffer.from('companion storage doctor');

  const results: StepResult[] = [];

  results.push(
    await step('HeadBucket   (does the bucket answer at all)', async () => {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return 'reachable';
    }),
  );

  results.push(
    await step('ListObjectsV2 (can the key read the bucket)', async () => {
      const out = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
      return `${out.KeyCount ?? 0} object(s) visible`;
    }),
  );

  results.push(
    await step('PutObject    (can the key write — this is where uploads fail)', async () => {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: probe }));
      return `wrote ${probe.length} bytes`;
    }),
  );

  // Reading back an object that was never written reports a second, invented
  // failure and buries the real one. A diagnostic that adds noise is worse
  // than no diagnostic.
  const wrote = results[results.length - 1]?.ok === true;

  if (wrote) {
    results.push(
      await step('GetObject    (can it read back what it wrote)', async () => {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const body = Buffer.from(await out.Body!.transformToByteArray());
        if (!body.equals(probe)) throw new Error('read back different bytes than were written');
        return `read ${body.length} bytes, identical`;
      }),
    );

    results.push(
      await step('DeleteObject (can it clean up after itself)', async () => {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        return 'removed';
      }),
    );
  } else {
    for (const name of [
      'GetObject    (can it read back what it wrote)',
      'DeleteObject (can it clean up after itself)',
    ]) {
      results.push({ name, ok: true, skipped: true, ms: 0, detail: 'skipped — nothing was written to read' });
    }
  }

  console.log('Operations an upload needs');
  console.log('──────────────────────────');
  for (const result of results) {
    console.log(`  ${result.skipped ? '–' : result.ok ? '✓' : '✗'} ${result.name}`);
    console.log(`      ${result.detail}${result.skipped ? '' : `  [${result.ms}ms]`}`);
  }
  console.log();

  const failed = results.filter((result) => !result.ok);
  const skipped = results.filter((result) => result.skipped);
  if (failed.length === 0 && skipped.length === 0) {
    console.log('Storage works. If uploads still fail, the fault is not the bucket.');
    return 0;
  }

  // The probe may have been written before a later step failed.
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);

  const first = failed[0]!;
  console.log(`First failure: ${first.name.split('(')[0]?.trim()}`);
  console.log(`  ${first.detail}`);
  console.log();
  console.log('Paste the block above when asking for help — it names the operation, the');
  console.log('provider’s own word for the fault, and the request id it logged, which is');
  console.log('everything needed to tell a wrong key from a wrong endpoint from a wrong region.');
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('storage:doctor could not run:', error);
    process.exit(1);
  });
