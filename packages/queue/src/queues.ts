import { Queue, QueueEvents, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import type { JobType } from '@companion/shared';
import { JOB_ATTEMPTS, JOB_QUEUE, PRIORITY, QUEUE_NAMES, type CompanionJob, type QueueName } from './jobs.js';

export interface EnqueueOptions {
  priority?: number;
  delayMs?: number;
  /** Overrides the per-type default. */
  attempts?: number;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  removeOnComplete: { age: 24 * 60 * 60, count: 5_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
  backoff: { type: 'exponential', delay: 3_000 },
};

export class JobDispatcher {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly connection: Redis) {}

  queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
      this.queues.set(name, queue);
    }
    return queue;
  }

  /**
   * Enqueues a job using its idempotency key as the BullMQ job id, so an
   * accidental double-dispatch collapses into a single unit of work.
   */
  async enqueue(job: CompanionJob, options: EnqueueOptions = {}): Promise<string> {
    const queue = this.queue(JOB_QUEUE[job.type]);
    const added = await queue.add(job.type, job, {
      jobId: toJobId(job.idempotencyKey),
      attempts: options.attempts ?? JOB_ATTEMPTS[job.type],
      priority: options.priority ?? PRIORITY.normal,
      ...(options.delayMs ? { delay: options.delayMs } : {}),
    });
    return added.id ?? job.idempotencyKey;
  }

  async enqueueMany(jobs: CompanionJob[], options: EnqueueOptions = {}): Promise<string[]> {
    return Promise.all(jobs.map((job) => this.enqueue(job, options)));
  }

  async retryJob(queueName: QueueName, jobId: string): Promise<boolean> {
    const job = await this.queue(queueName).getJob(toJobId(jobId));
    if (!job) return false;
    const state = await job.getState();
    // Re-running a job that already succeeded would duplicate side effects.
    if (state === 'failed') {
      await job.retry('failed');
      return true;
    }
    // A delayed job just needs to be brought forward, not re-run.
    if (state === 'delayed') {
      await job.promote();
      return true;
    }
    return false;
  }

  async removeJob(queueName: QueueName, jobId: string): Promise<boolean> {
    const job = await this.queue(queueName).getJob(toJobId(jobId));
    if (!job) return false;
    const state = await job.getState();
    if (state === 'active') return false;
    await job.remove();
    return true;
  }

  async counts(): Promise<Record<QueueName, Record<string, number>>> {
    const entries = await Promise.all(
      Object.values(QUEUE_NAMES).map(async (name) => {
        const counts = await this.queue(name).getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed',
          'paused',
        );
        return [name, counts] as const;
      }),
    );
    return Object.fromEntries(entries) as Record<QueueName, Record<string, number>>;
  }

  /** Total jobs waiting across all queues, for the /admin backlog indicator. */
  async backlog(): Promise<number> {
    const counts = await this.counts();
    return Object.values(counts).reduce(
      (total, queue) => total + (queue.waiting ?? 0) + (queue.delayed ?? 0),
      0,
    );
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.queues.clear();
  }
}

export function createQueueEvents(name: QueueName, connection: Redis): QueueEvents {
  return new QueueEvents(name, { connection });
}

/** Deterministic idempotency key. Same inputs always produce the same key. */
export function idempotencyKey(type: JobType, ...parts: (string | number | null)[]): string {
  return [type, ...parts.filter((part) => part !== null)].join(':');
}

/**
 * BullMQ reserves ':' as its Redis key separator and rejects it in a job id.
 * The database keeps the readable colon-separated key; only the queue sees the
 * substituted form, and the mapping is one-to-one so it stays idempotent.
 */
export function toJobId(idempotencyKey: string): string {
  return idempotencyKey.replace(/:/g, '~');
}
