import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * The deployment blueprint, checked for the things YAML parsing cannot see.
 *
 * Every assertion here corresponds to a way the file can be syntactically
 * valid and semantically impossible: a worker that restarts forever, a
 * database an ocean away from the service reading it, a secret committed by
 * accident, or a variable the application no longer reads.
 */
interface EnvVar {
  key: string;
  value?: string | number | boolean;
  sync?: boolean;
  generateValue?: boolean;
  fromService?: { type: string; name: string; envVarKey?: string; property?: string };
  fromDatabase?: { name: string; property: string };
}

interface Service {
  type: string;
  name: string;
  runtime?: string;
  plan?: string;
  region?: string;
  branch?: string;
  buildCommand?: string;
  startCommand?: string;
  preDeployCommand?: string;
  dockerfilePath?: string;
  dockerContext?: string;
  healthCheckPath?: string;
  envVars?: EnvVar[];
}

interface Blueprint {
  databases?: { name: string; region?: string; plan?: string; postgresMajorVersion?: string }[];
  services: Service[];
}

/**
 * Plan names Render has retired for new Postgres instances.
 *
 * These are not merely deprecated: the blueprint validator refuses the file
 * outright, which is a deploy that never starts rather than one that starts
 * degraded. The names overlap with the service instance types, where
 * `standard` is still perfectly valid — which is exactly how one ends up in
 * the database block by habit.
 */
const RETIRED_POSTGRES_PLANS = ['starter', 'standard', 'standard plus', 'pro', 'pro plus'];

const ROOT = resolve(import.meta.dirname, '../..');
const blueprint = parse(readFileSync(resolve(ROOT, 'render.yaml'), 'utf8')) as Blueprint;

const service = (name: string): Service => {
  const found = blueprint.services.find((entry) => entry.name === name);
  if (!found) throw new Error(`render.yaml has no service named ${name}`);
  return found;
};

const keys = (name: string): string[] => (service(name).envVars ?? []).map((entry) => entry.key);

describe('service shapes', () => {
  it('declares exactly the services the product needs', () => {
    expect(blueprint.services.map((entry) => entry.name).sort()).toEqual([
      'companion-redis',
      'companion-web',
      'companion-worker',
    ]);
  });

  it('serves the app from a web service with a health check', () => {
    const web = service('companion-web');
    expect(web.type).toBe('web');
    expect(web.runtime).toBe('node');
    expect(web.healthCheckPath).toBe('/api/health');
    expect(web.startCommand).toContain('@companion/web');
  });

  it('builds the worker from its Dockerfile at the repository root', () => {
    const worker = service('companion-worker');
    expect(worker.type).toBe('worker');
    expect(worker.runtime).toBe('docker');
    // Conversion needs LibreOffice and Poppler, which are system packages.
    expect(worker.dockerfilePath).toBe('./apps/worker/Dockerfile');
    expect(worker.dockerContext).toBe('.');
    // A Docker service builds from the image; a build command would be ignored.
    expect(worker.buildCommand).toBeUndefined();
  });

  it('uses a key-value service for the queue', () => {
    const redis = service('companion-redis');
    expect(redis.type).toBe('keyvalue');
    // Jobs are durable in Postgres too, but evicting one still loses throughput.
    expect(redis).toMatchObject({ maxmemoryPolicy: 'noeviction' });
  });
});

describe('migrations', () => {
  it('runs them from the web service, before the release takes traffic', () => {
    const web = service('companion-web');
    expect(web.preDeployCommand).toContain('migrate');
  });

  it('runs them from exactly one service, so two deploys cannot race', () => {
    const withMigrations = blueprint.services.filter(
      (entry) =>
        entry.preDeployCommand?.includes('migrate') || entry.startCommand?.includes('migrate'),
    );
    expect(withMigrations.map((entry) => entry.name)).toEqual(['companion-web']);
  });

  it('never runs them as a service that would be restarted after exiting', () => {
    for (const entry of blueprint.services) {
      // A Render worker that exits is restarted, so a migration job written
      // as one would re-run forever instead of once.
      expect(entry.startCommand ?? '', entry.name).not.toContain('migrate');
    }
  });
});

describe('branch tracking', () => {
  it('names no branch, so every service follows the repository default', () => {
    // A hardcoded branch is a blueprint that only validates in the repository
    // it was written in: Render refuses the whole file for a branch that does
    // not exist, and the name changes on a fork, a rename or a merge.
    for (const entry of blueprint.services) {
      expect(entry.branch, `${entry.name} should not pin a branch`).toBeUndefined();
    }
  });
});

describe('region consistency', () => {
  it('colocates everything that talks privately', () => {
    const regions = new Set<string>();
    for (const database of blueprint.databases ?? []) {
      expect(database.region, database.name).toBeDefined();
      regions.add(database.region as string);
    }
    for (const entry of blueprint.services) {
      expect(entry.region, entry.name).toBeDefined();
      regions.add(entry.region as string);
    }
    // One region, or every query and job dispatch crosses an ocean.
    expect([...regions]).toHaveLength(1);
  });
});

describe('secrets', () => {
  it('never inlines one', () => {
    const raw = readFileSync(resolve(ROOT, 'render.yaml'), 'utf8');
    for (const pattern of [/sk_live_/, /sk_test_/, /rk_live_/, /whsec_/, /\bre_[A-Za-z0-9]{10,}/]) {
      expect(raw).not.toMatch(pattern);
    }
  });

  it('marks every credential sync:false so it is entered once, in the dashboard', () => {
    const secretish =
      /(_KEY|_SECRET|_TOKEN|_PASSWORD|SMTP_URL|S3_BUCKET|S3_ENDPOINT|S3_REGION|SUPER_ADMIN_EMAILS|EMAIL_FROM|APP_URL)$/;
    for (const entry of blueprint.services) {
      for (const variable of entry.envVars ?? []) {
        if (!secretish.test(variable.key)) continue;
        if (variable.fromService || variable.fromDatabase || variable.generateValue) continue;
        expect(variable.sync, `${entry.name}.${variable.key}`).toBe(false);
      }
    }
  });

  it('generates the session secret rather than asking for one', () => {
    const secret = (service('companion-web').envVars ?? []).find(
      (entry) => entry.key === 'SESSION_SECRET',
    );
    expect(secret?.generateValue).toBe(true);
  });

  it('gives the worker the same session secret, so both verify the same cookies', () => {
    const secret = (service('companion-worker').envVars ?? []).find(
      (entry) => entry.key === 'SESSION_SECRET',
    );
    expect(secret?.fromService).toMatchObject({
      type: 'web',
      name: 'companion-web',
      envVarKey: 'SESSION_SECRET',
    });
  });
});

describe('configuration the application actually reads', () => {
  it('requires object storage on both services', () => {
    for (const name of ['companion-web', 'companion-worker']) {
      const driver = (service(name).envVars ?? []).find((entry) => entry.key === 'STORAGE_DRIVER');
      // A disk belongs to one instance; the worker could not read what the web
      // service wrote, so documents would upload and never process.
      expect(driver?.value, name).toBe('s3');
    }
  });

  it('never ships the diagnostic storage escape hatch', () => {
    for (const entry of blueprint.services) {
      expect(keys(entry.name), entry.name).not.toContain('ALLOW_UNSAFE_LOCAL_STORAGE');
    }
  });

  it('declares no variable the application stopped reading', () => {
    // Checkout is a server-side redirect, so no publishable key reaches a browser.
    const retired = [
      'STRIPE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_APP_URL',
    ];
    for (const entry of blueprint.services) {
      for (const key of retired) {
        expect(keys(entry.name), `${entry.name}.${key}`).not.toContain(key);
      }
    }
  });

  it('gives the worker an origin to resolve, having none of its own', () => {
    // A worker is not a web service, so Render sets no external URL for it.
    expect(keys('companion-worker')).toContain('APP_URL');
    expect(keys('companion-worker')).toContain('RENDER_EXTERNAL_URL');
  });

  it('keeps Playwright from downloading a browser into a server build', () => {
    expect(keys('companion-web')).toContain('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD');
  });

  it('names an email provider explicitly', () => {
    const provider = (service('companion-web').envVars ?? []).find(
      (entry) => entry.key === 'EMAIL_PROVIDER',
    );
    expect(provider).toBeDefined();
    expect(['resend', 'smtp', 'none']).toContain(String(provider?.value));
  });

  it('wires the database and queue by reference, never by hand', () => {
    for (const name of ['companion-web', 'companion-worker']) {
      const vars = service(name).envVars ?? [];
      expect(vars.find((entry) => entry.key === 'DATABASE_URL')?.fromDatabase, name).toMatchObject({
        name: 'companion-postgres',
        property: 'connectionString',
      });
      expect(vars.find((entry) => entry.key === 'REDIS_URL')?.fromService, name).toMatchObject({
        type: 'keyvalue',
        name: 'companion-redis',
      });
    }
  });

  it('references only services the blueprint defines', () => {
    const defined = new Set(blueprint.services.map((entry) => entry.name));
    const databases = new Set((blueprint.databases ?? []).map((entry) => entry.name));
    for (const entry of blueprint.services) {
      for (const variable of entry.envVars ?? []) {
        if (variable.fromService) expect(defined).toContain(variable.fromService.name);
        if (variable.fromDatabase) expect(databases).toContain(variable.fromDatabase.name);
      }
    }
  });

  it('never has a service resolve a value from itself', () => {
    for (const entry of blueprint.services) {
      for (const variable of entry.envVars ?? []) {
        expect(variable.fromService?.name, `${entry.name}.${variable.key}`).not.toBe(entry.name);
      }
    }
  });
});

describe('database', () => {
  it('does not use a plan Render has retired', () => {
    const plan = (blueprint.databases ?? [])[0]?.plan ?? '';
    expect(plan).not.toBe('');
    expect(RETIRED_POSTGRES_PLANS, `plan: ${plan}`).not.toContain(plan.toLowerCase());
  });

  it('runs a Postgres version pgvector is available for', () => {
    const database = (blueprint.databases ?? [])[0];
    expect(database?.postgresMajorVersion).toBe('16');
  });

  it('is reachable only from inside the private network', () => {
    const database = (blueprint.databases ?? [])[0] as { ipAllowList?: unknown[] };
    expect(database.ipAllowList).toEqual([]);
  });
});
