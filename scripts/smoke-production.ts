#!/usr/bin/env tsx
import { config as loadEnvFile } from 'dotenv';
import { resolve } from 'node:path';

/**
 * Non-destructive verification of a deployed instance.
 *
 *   BASE=https://companion.app pnpm smoke:production
 *   BASE=... ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm smoke:production
 *
 * Safe to run against production. It creates no Companion, charges nothing,
 * sends no email, and the one object it writes — a storage probe — is deleted
 * by the same request that wrote it, server-side.
 *
 * Without admin credentials it checks what is public: the health endpoint and
 * the headers on a share link. With them it reads the readiness report, which
 * is where storage, providers, migrations and worker liveness are verified.
 *
 * Exits non-zero when anything CRITICAL fails.
 */
loadEnvFile({ path: resolve(process.cwd(), '.env'), quiet: true });

const BASE = (process.env['BASE'] ?? process.env['APP_URL'] ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);
const ADMIN_EMAIL = process.env['ADMIN_EMAIL'];
const ADMIN_PASSWORD = process.env['ADMIN_PASSWORD'];
const TIMEOUT_MS = 30_000;

type Status = 'PASS' | 'WARNING' | 'CRITICAL';

interface Line {
  label: string;
  status: Status;
  detail: string;
  remediation?: string;
}

const results: Line[] = [];
const record = (label: string, status: Status, detail: string, remediation?: string): void => {
  results.push({ label, status, detail, ...(remediation ? { remediation } : {}) });
};

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE}${path}`, { ...init, signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timeout);
  }
}

/** Reachability and the dependency summary the health endpoint already reports. */
async function checkHealth(): Promise<void> {
  try {
    const response = await request('/api/health?deep=1');
    if (!response.ok) {
      record('Health endpoint', 'CRITICAL', `HTTP ${response.status}`, 'The service is not serving.');
      return;
    }
    const body = (await response.json()) as {
      status: string;
      version: string;
      checks: Record<string, { healthy: boolean; message?: string }>;
    };

    record('Health endpoint', 'PASS', `${body.status}, build ${body.version}`);

    for (const [name, check] of Object.entries(body.checks)) {
      record(
        `  ${name}`,
        check.healthy ? 'PASS' : 'CRITICAL',
        check.healthy ? 'reachable' : (check.message ?? 'unreachable'),
        check.healthy ? undefined : `Check the ${name} configuration for this service.`,
      );
    }
  } catch (error) {
    record(
      'Health endpoint',
      'CRITICAL',
      error instanceof Error ? error.message : 'unreachable',
      `Confirm ${BASE} resolves and the service is running.`,
    );
  }
}

/** A share link must never be indexable or cacheable, deployed or not. */
async function checkShareLinkHeaders(): Promise<void> {
  try {
    const response = await request('/c/zzzzzz');
    const robots = response.headers.get('x-robots-tag') ?? '';
    const cache = response.headers.get('cache-control') ?? '';

    record(
      'Share link headers',
      robots.includes('noindex') && cache.includes('no-store') ? 'PASS' : 'CRITICAL',
      `x-robots-tag: ${robots || 'absent'}; cache-control: ${cache || 'absent'}`,
      'Recipient documents must be noindex and no-store.',
    );

    const powered = response.headers.get('x-powered-by');
    record(
      'Framework banner',
      powered ? 'WARNING' : 'PASS',
      powered ? `x-powered-by: ${powered}` : 'absent',
      powered ? 'Disable poweredByHeader.' : undefined,
    );
  } catch (error) {
    record('Share link headers', 'CRITICAL', error instanceof Error ? error.message : 'failed');
  }
}

/** The admin console must not be discoverable without a session. */
async function checkAdminIsClosed(): Promise<void> {
  try {
    const response = await request('/api/admin/readiness');
    record(
      'Admin API is closed',
      response.status >= 400 && response.status < 500 ? 'PASS' : 'CRITICAL',
      `HTTP ${response.status} without a session`,
      'An unauthenticated caller must not read the readiness report.',
    );
  } catch (error) {
    record('Admin API is closed', 'CRITICAL', error instanceof Error ? error.message : 'failed');
  }
}

/**
 * The deep checks. Storage, providers, migrations, pgvector and worker
 * liveness are all server-side facts, so they are read from the report rather
 * than re-implemented here.
 */
async function checkReadiness(): Promise<void> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    record(
      'Readiness report',
      'WARNING',
      'skipped — no admin credentials',
      'Set ADMIN_EMAIL and ADMIN_PASSWORD to verify storage, providers and migrations.',
    );
    return;
  }

  let cookie: string;
  try {
    const login = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    if (!login.ok) {
      record('Admin sign-in', 'CRITICAL', `HTTP ${login.status}`, 'Check ADMIN_EMAIL and ADMIN_PASSWORD.');
      return;
    }
    const setCookie = login.headers.getSetCookie?.() ?? [];
    cookie = setCookie.map((entry) => entry.split(';')[0]).join('; ');
    if (!cookie) {
      record('Admin sign-in', 'CRITICAL', 'no session cookie returned');
      return;
    }
    record('Admin sign-in', 'PASS', 'session established');
  } catch (error) {
    record('Admin sign-in', 'CRITICAL', error instanceof Error ? error.message : 'failed');
    return;
  }

  try {
    const response = await request('/api/admin/readiness', { headers: { cookie } });
    if (!response.ok) {
      record(
        'Readiness report',
        'CRITICAL',
        `HTTP ${response.status}`,
        response.status === 404
          ? 'The account signed in is not a Super Admin. Run: pnpm admin:bootstrap'
          : 'The readiness endpoint failed.',
      );
      return;
    }

    const report = (await response.json()) as {
      passed: number;
      total: number;
      environment: string;
      release: string;
      checks: { label: string; status: Status; detail: string; remediation?: string }[];
    };

    record(
      'Readiness report',
      'PASS',
      `${report.passed}/${report.total} checks, ${report.environment}, build ${report.release}`,
    );
    for (const check of report.checks) {
      record(`  ${check.label}`, check.status, check.detail, check.remediation);
    }
  } catch (error) {
    record('Readiness report', 'CRITICAL', error instanceof Error ? error.message : 'failed');
  }
}

function render(): number {
  const symbol: Record<Status, string> = { PASS: '✓', WARNING: '!', CRITICAL: '✗' };
  const colour: Record<Status, string> = {
    PASS: '\u001B[32m',
    WARNING: '\u001B[33m',
    CRITICAL: '\u001B[31m',
  };

  console.log(`\nCompanion deployment smoke — ${BASE}\n`);
  for (const line of results) {
    const pad = line.label.startsWith('  ') ? '' : '';
    console.log(
      `${pad}${colour[line.status]}${symbol[line.status]}\u001B[0m ${line.label.padEnd(34)} ${line.detail}`,
    );
    if (line.remediation && line.status !== 'PASS') {
      console.log(`  ${' '.repeat(35)}→ ${line.remediation}`);
    }
  }

  const critical = results.filter((line) => line.status === 'CRITICAL').length;
  const warnings = results.filter((line) => line.status === 'WARNING').length;
  const passed = results.filter((line) => line.status === 'PASS').length;

  console.log(
    `\n${passed} passed, ${warnings} warning(s), ${critical} critical\n`,
  );
  return critical > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  await checkHealth();
  await checkShareLinkHeaders();
  await checkAdminIsClosed();
  await checkReadiness();
  return render();
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
