import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

/**
 * Integration test environment.
 *
 * These tests run against a real Postgres with pgvector, because the things
 * they verify — cross-tenant isolation, revocation timing, expiry precision —
 * are properties of the queries, not of the TypeScript around them. A mock
 * database would agree with whatever the code did and prove nothing.
 *
 * The test database is required to be a separate one: pointing this at a
 * development database would truncate it.
 */
loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
loadEnv({ path: resolve(process.cwd(), '.env.test'), override: true, quiet: true });

const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '';
if (!/_test(\b|$)/.test(new URL(url).pathname)) {
  throw new Error(
    'Integration tests require TEST_DATABASE_URL to name a database ending in _test. ' +
      'Refusing to run against ' + (new URL(url).pathname || 'an unnamed database') + '.',
  );
}

process.env['DATABASE_URL'] = url;
// Storage is exercised for real, but into a throwaway directory.
process.env['STORAGE_DRIVER'] = 'local';
process.env['STORAGE_LOCAL_ROOT'] = resolve(process.cwd(), '.storage-test');
process.env['NODE_ENV'] = 'test';
process.env['SESSION_SECRET'] ??= 'test-session-secret-at-least-32-characters-long';
process.env['APP_URL'] ??= 'http://127.0.0.1:3000';
// No provider calls from integration tests: the model is not what is on trial.
delete process.env['OPENAI_API_KEY'];
