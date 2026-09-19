import { json, route } from '@/server/http';
import { conversionToolingCheck, productionReadiness } from '@/server/services/readiness';
import { adminContext } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The readiness report, for the deploy smoke command.
 *
 * Super Admin only: the checks name which providers are configured, which is
 * more than an anonymous caller should learn about a deployment. It reports
 * whether a credential is present and whether it last worked — never the
 * credential, and never a connection string.
 */
export const GET = route(async () => {
  await adminContext();
  const [report, conversion] = await Promise.all([
    productionReadiness(),
    conversionToolingCheck(),
  ]);

  const checks = [...report.checks, conversion];
  return json({
    environment: report.environment,
    release: report.release,
    serviceName: report.serviceName,
    generatedAt: report.generatedAt.toISOString(),
    passed: checks.filter((check) => check.status === 'PASS').length,
    total: checks.length,
    critical: checks.filter((check) => check.status === 'CRITICAL').length,
    warnings: checks.filter((check) => check.status === 'WARNING').length,
    checks,
  });
});
