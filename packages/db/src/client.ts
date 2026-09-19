import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;
export type Sql = ReturnType<typeof postgres>;

export interface DatabaseOptions {
  url: string;
  /** Pool size. The web app needs far fewer connections than the worker. */
  max?: number;
  /** Seconds before an idle connection is released. */
  idleTimeout?: number;
  /** Seconds to wait for a connection before failing. */
  connectTimeout?: number;
  ssl?: boolean;
  debug?: boolean;
}

let cached: { db: Database; sql: Sql; url: string } | null = null;

function requiresSsl(url: string): boolean {
  if (/sslmode=disable/.test(url)) return false;
  if (/sslmode=(require|verify-full|verify-ca)/.test(url)) return true;
  // Render's managed Postgres always terminates TLS; localhost never does.
  return !/@(localhost|127\.0\.0\.1|::1|host\.docker\.internal)/.test(url);
}

export function createDatabase(options: DatabaseOptions): { db: Database; sql: Sql } {
  const ssl = options.ssl ?? requiresSsl(options.url);
  const sql = postgres(options.url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeout ?? 30,
    connect_timeout: options.connectTimeout ?? 15,
    // Render terminates TLS with its own CA; certificate pinning is handled by
    // the platform, so `require` is the correct posture here.
    ssl: ssl ? 'require' : false,
    prepare: false,
    onnotice: () => {},
    transform: { undefined: null },
  });
  const db = drizzle(sql, { schema, logger: options.debug ?? false });
  return { db, sql };
}

/**
 * Process-wide singleton. Next.js route handlers and the worker both reuse one
 * pool; hot reload in development would otherwise leak connections.
 */
export function getDatabase(options: DatabaseOptions): Database {
  if (cached && cached.url === options.url) return cached.db;
  const created = createDatabase(options);
  cached = { ...created, url: options.url };
  return created.db;
}

export function getSql(options: DatabaseOptions): Sql {
  if (cached && cached.url === options.url) return cached.sql;
  const created = createDatabase(options);
  cached = { ...created, url: options.url };
  return created.sql;
}

export async function closeDatabase(): Promise<void> {
  if (!cached) return;
  await cached.sql.end({ timeout: 5 });
  cached = null;
}
