import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

/**
 * Plain SQL migration runner.
 *
 * Deliberately not drizzle-kit's runner: deployments on Render execute this at
 * release time and it must (a) create the pgvector extension before any schema
 * touches a vector column, (b) be idempotent, and (c) never drop anything.
 */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const ssl = !/@(localhost|127\.0\.0\.1|::1)/.test(databaseUrl) && !/sslmode=disable/.test(databaseUrl);
  const sql = postgres(databaseUrl, { max: 1, ssl: ssl ? 'require' : false, onnotice: () => {} });
  const applied: string[] = [];

  try {
    await sql.unsafe('CREATE EXTENSION IF NOT EXISTS vector');
    await sql.unsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const entries = (await readdir(MIGRATIONS_DIR))
      .filter((name) => name.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    const done = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((row) => row.name),
    );

    for (const entry of entries) {
      if (done.has(entry)) continue;
      const contents = await readFile(join(MIGRATIONS_DIR, entry), 'utf8');
      // Each migration runs in its own transaction so a failure leaves the
      // database on the last complete migration rather than half-applied.
      await sql.begin(async (tx) => {
        await tx.unsafe(contents);
        await tx`INSERT INTO schema_migrations (name) VALUES (${entry})`;
      });
      applied.push(entry);
      process.stdout.write(`applied ${entry}\n`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  return applied;
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL is required\n');
    process.exit(1);
  }
  runMigrations(url)
    .then((applied) => {
      process.stdout.write(
        applied.length ? `${applied.length} migration(s) applied\n` : 'database up to date\n',
      );
      process.exit(0);
    })
    .catch((error: unknown) => {
      process.stderr.write(`migration failed: ${(error as Error).message}\n`);
      process.exit(1);
    });
}
