import { randomUUID } from 'node:crypto';

/**
 * Structured logging.
 *
 * One JSON object per line, so Render's log drain and any downstream collector
 * can parse it. Document content is never logged: `redact` strips anything that
 * looks like uploaded material before it reaches a transport.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogContext {
  requestId?: string;
  jobId?: string;
  companionId?: string;
  workspaceId?: string;
  userId?: string;
  [key: string]: unknown;
}

/** Keys that must never be serialised, whatever the caller passes. */
const FORBIDDEN_KEYS = new Set([
  'text',
  'content',
  'body',
  'quote',
  'question',
  'answer',
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'apiKey',
  'secret',
  'authorization',
  'cookie',
  'email',
  'selection',
  'excerpt',
]);

const MAX_STRING = 500;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.split('\n').slice(0, 5),
      // Driver errors carry the actionable detail on `cause`; without it a
      // failed query is unreadable in production logs.
      ...(value.cause ? { cause: redact(value.cause, depth + 1) } : {}),
    };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = FORBIDDEN_KEYS.has(key) ? '[redacted]' : redact(item, depth + 1);
    }
    return out;
  }
  return '[unserialisable]';
}

export class Logger {
  constructor(
    private readonly level: LogLevel = 'info',
    private readonly base: LogContext = {},
  ) {}

  child(context: LogContext): Logger {
    return new Logger(this.level, { ...this.base, ...context });
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;
    const payload = {
      level,
      time: new Date().toISOString(),
      msg: message,
      ...(redact({ ...this.base, ...context }) as Record<string, unknown>),
    };
    const line = `${JSON.stringify(payload)}\n`;
    if (level === 'error' || level === 'warn') process.stderr.write(line);
    else process.stdout.write(line);
  }

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }
  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }
  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }
}

export function createLogger(level: LogLevel = 'info', base: LogContext = {}): Logger {
  return new Logger(level, base);
}

export function newRequestId(): string {
  return randomUUID();
}
