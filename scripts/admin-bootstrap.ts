#!/usr/bin/env tsx
import { config as loadEnvFile } from 'dotenv';
import { resolve } from 'node:path';

/**
 * Synchronises SUPER_ADMIN_EMAILS against the database.
 *
 *   pnpm admin:bootstrap             grant the role to every listed account
 *   pnpm admin:bootstrap --dry-run   report what would change, change nothing
 *
 * Idempotent: running it twice promotes nobody the second time. It only ever
 * grants — an address removed from the allowlist keeps its role, because a
 * typo in an environment variable must not be able to lock every operator out
 * of the console at once.
 *
 * The same reconciliation runs on each authenticated session, so this command
 * is for when you would rather not wait for the person to sign in again.
 */
loadEnvFile({ path: resolve(process.cwd(), '.env'), quiet: true });

async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry-run');
  const { syncSuperAdmins, activeSuperAdminCount } = await import(
    '../apps/web/src/server/auth/super-admin'
  );

  const result = await syncSuperAdmins({ dryRun });

  if (result.configured.length === 0) {
    console.error(
      'SUPER_ADMIN_EMAILS is not set. Nobody can reach /admin until it names an address.',
    );
    return 1;
  }

  console.log(`Allowlist: ${result.configured.join(', ')}`);

  for (const entry of result.promoted) {
    console.log(`${dryRun ? 'would promote' : 'promoted'}  ${entry.email}`);
  }
  for (const email of result.unchanged) {
    console.log(`already admin  ${email}`);
  }
  for (const email of result.pending) {
    console.log(`no account yet  ${email} — promoted automatically when they register`);
  }

  const active = await activeSuperAdminCount();
  console.log(`\n${active} account(s) can reach /admin.`);

  // A configured allowlist that leaves nobody able to sign in is the failure
  // this command exists to surface.
  return active === 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
