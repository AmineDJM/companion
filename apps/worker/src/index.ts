import { hostname } from 'node:os';
import { QUEUE_NAMES, Worker, type CompanionJob, type Job } from '@companion/queue';
import { eq, schema, sql } from '@companion/db';
import { container } from './container.js';
import { env } from './env.js';
import { alreadyCompleted, markFinished, markRetrying, markRunning } from './lib/jobs.js';
import { handleExtractArchive } from './pipeline/archive.js';
import { handleClusterQuestions, handleFinalize, handlePurgeCompanion } from './pipeline/finalize.js';
import { handleChunk, handleEmbed } from './pipeline/index-content.js';
import { handleExtractText, handleIngestUpload } from './pipeline/ingest.js';
import { runMaintenance } from './pipeline/maintenance.js';
import { libreOfficeAvailable, popplerAvailable } from './lib/convert.js';

/**
 * Worker entrypoint.
 *
 * Long-running document work never touches an HTTP request. Each job is
 * idempotent: a completed job record short-circuits, and every stage replaces
 * its own output rather than appending, so a retry after a crash is safe.
 */
const WORKER_ID = `${hostname()}-${process.pid}`;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;

let completedJobs = 0;
let failedJobs = 0;
let activeJobs = 0;

async function dispatch(job: Job<CompanionJob>): Promise<void> {
  const payload = job.data;
  const { logger } = container();
  const log = logger.child({
    jobId: job.id ?? payload.idempotencyKey,
    jobType: payload.type,
    companionId: payload.companionId,
  });

  if (await alreadyCompleted(payload.jobRecordId)) {
    log.info('job already completed; skipping');
    return;
  }

  await markRunning(payload.jobRecordId);
  activeJobs += 1;
  const started = Date.now();

  try {
    switch (payload.type) {
      case 'ingest_upload':
        await handleIngestUpload(payload);
        break;
      case 'extract_archive':
        await handleExtractArchive(payload);
        break;
      case 'extract_text':
        await handleExtractText(payload);
        break;
      case 'chunk':
        await handleChunk(payload);
        break;
      case 'embed':
        await handleEmbed(payload);
        break;
      case 'finalize_companion':
        await handleFinalize(payload);
        break;
      case 'cluster_questions':
        await handleClusterQuestions(payload);
        break;
      case 'purge_companion':
        await handlePurgeCompanion(payload);
        break;
      case 'reindex_file':
        await handleIngestUpload({ ...payload, type: 'ingest_upload' });
        break;
      case 'convert_preview':
      case 'ocr':
        // Both are performed inline by the ingestion stage; nothing to do.
        await markFinished(payload.jobRecordId, 'SKIPPED');
        return;
      default: {
        const exhaustive: never = payload;
        throw new Error(`Unhandled job type: ${JSON.stringify(exhaustive)}`);
      }
    }

    await markFinished(payload.jobRecordId, 'COMPLETED');
    completedJobs += 1;
    log.info('job completed', { durationMs: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const willRetry = (job.attemptsMade ?? 0) + 1 < (job.opts.attempts ?? 1);
    if (willRetry) await markRetrying(payload.jobRecordId, message);
    else await markFinished(payload.jobRecordId, 'FAILED', message);
    failedJobs += 1;
    log.error('job failed', { durationMs: Date.now() - started, willRetry, error });
    throw error;
  } finally {
    activeJobs -= 1;
  }
}

/**
 * The conversion tools this worker can actually reach.
 *
 * Reported in the heartbeat because they live in the worker's image: the web
 * service has no way to find out, and an image built without LibreOffice
 * silently stops converting Office files rather than failing loudly.
 * Probed once — a binary does not appear mid-process.
 */
let toolingTag: string | null = null;

async function describeTooling(): Promise<string> {
  if (toolingTag !== null) return toolingTag;
  const [libreOffice, poppler] = await Promise.all([
    libreOfficeAvailable().catch(() => false),
    popplerAvailable().catch(() => false),
  ]);
  const release = process.env['RENDER_GIT_COMMIT']?.slice(0, 7) ?? 'dev';
  toolingTag = [release, libreOffice ? 'soffice' : null, poppler ? 'poppler' : null]
    .filter(Boolean)
    .join('+');
  return toolingTag;
}

async function heartbeat(): Promise<void> {
  const { db, logger } = container();
  try {
    const version = await describeTooling();
    await db
      .insert(schema.workerHeartbeats)
      .values({
        id: WORKER_ID,
        hostname: hostname(),
        version,
        queues: Object.values(QUEUE_NAMES),
        activeJobs,
        completedJobs,
        failedJobs,
        startedAt: new Date(Date.now() - process.uptime() * 1000),
        lastBeatAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.workerHeartbeats.id,
        set: {
          version,
          activeJobs,
          completedJobs,
          failedJobs,
          lastBeatAt: new Date(),
        },
      });
  } catch (error) {
    logger.warn('heartbeat failed', { error });
  }
}

async function main(): Promise<void> {
  const config = env();
  const { redis, logger, db } = container();

  logger.info('worker starting', {
    workerId: WORKER_ID,
    concurrency: config.WORKER_CONCURRENCY,
    queues: Object.values(QUEUE_NAMES),
  });

  const workers = Object.values(QUEUE_NAMES).map(
    (queueName) =>
      new Worker<CompanionJob>(queueName, dispatch, {
        connection: redis,
        concurrency: config.WORKER_CONCURRENCY,
        // A stalled job is reclaimed rather than lost if an instance dies.
        stalledInterval: 30_000,
        maxStalledCount: 2,
      }),
  );

  for (const worker of workers) {
    worker.on('failed', (job, error) => {
      logger.warn('queue job failed', { jobId: job?.id, error: error.message });
    });
    worker.on('error', (error) => {
      logger.error('queue error', { error });
    });
  }

  await heartbeat();
  const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
  const maintenanceTimer = setInterval(() => {
    void runMaintenance().catch((error: unknown) => logger.error('maintenance failed', { error }));
  }, MAINTENANCE_INTERVAL_MS);

  // Run once at boot so a restarted worker catches up immediately.
  void runMaintenance().catch((error: unknown) => logger.error('maintenance failed', { error }));

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('worker shutting down', { signal });
    clearInterval(heartbeatTimer);
    clearInterval(maintenanceTimer);
    // Let in-flight jobs finish so no document is left half-processed.
    await Promise.all(workers.map((worker) => worker.close()));
    await db
      .update(schema.workerHeartbeats)
      .set({ activeJobs: 0, lastBeatAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.workerHeartbeats.id, WORKER_ID))
      .catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { error: reason });
  });

  void sql;
}

main().catch((error: unknown) => {
  process.stderr.write(`worker failed to start: ${(error as Error).message}\n`);
  process.exit(1);
});
