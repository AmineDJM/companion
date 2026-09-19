# Deploying Companion

## What you need first

| Thing | Why |
| --- | --- |
| PostgreSQL 16 with `pgvector` | Semantic search. The migrator creates the extension, so the role needs `CREATE EXTENSION` on first run. |
| Redis | The job queue. Without it uploads are accepted and never processed. |
| A private S3-compatible bucket | Canonical document storage. Not optional — see below. |
| An OpenAI key | Answers and reading scanned pages. Everything else works without it. |
| A Stripe account (optional) | Checkout and the customer portal. No Connect. |
| An email provider (optional) | Only for magic-link sign-in and the two access modes that confirm a recipient's address. Sharing a link never needs it. |

## Storage must be shared, not just durable

A platform disk *does* persist across restarts and redeploys. That is not the
problem. The problem is that it belongs to **one service instance**, and
Companion runs two services:

- the web service accepts the upload and writes the bytes;
- the worker reads them, converts, renders and indexes.

With a disk, the worker cannot see what the web service wrote. Every document
would upload successfully and then sit in processing forever. A disk also rules
out running more than one instance of that service, and rules out zero-downtime
deploys for it.

So production requires shared object storage — S3, Cloudflare R2, Backblaze B2
or any S3-compatible provider, behind the same `StorageDriver` interface. No
domain logic knows which one you chose.

This is enforced, not merely documented: with `NODE_ENV=production` and
`STORAGE_DRIVER=local`, both services refuse to start and say why. If you need
to boot a production build against local disk to diagnose something, set
`ALLOW_UNSAFE_LOCAL_STORAGE=true` — and expect the readiness report to mark it
CRITICAL until you remove it.

The bucket must be private. Originals are never addressable by a browser: the
viewer is given a route on this app, and a signed URL — when one is used at all
— lives for 120 seconds and is minted only after an access decision.

## On Render

`render.yaml` provisions Postgres 16, a Key Value instance, the web service and
the Docker worker. Migrations run as the web service's pre-deploy command, so
they happen once per release, before the new version takes traffic.

Four things it cannot do for you, because they are secrets or decisions:

Migrations run **once per deploy, from the web service only**. The worker has
no migration step: it expects the schema to be there. Two services migrating
the same database concurrently is a race, so the blueprint gives the job one
owner, and a test asserts it stays that way.

1. **Create the blueprint.** Push the repository, then New → Blueprint from it.
2. **Fill in the `sync: false` variables** in the dashboard. The ones that
   change whether the product works at all:

   | Variable | Without it |
   | --- | --- |
   | `APP_URL` | *Optional.* Until it is set, Render's own URL is used, so share links work on the first deploy. Set it when you attach a custom domain; it is resolved per request, so no rebuild is needed. |
   | `S3_BUCKET` and its credentials | Nothing can be stored. Uploads fail. |
   | `OPENAI_API_KEY` | Documents open and index for keyword search; questions are unavailable and scanned pages are not read. |
   | `SUPER_ADMIN_EMAILS` | `/admin` is unreachable. See below. |
   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Checkout answers 503 with a clear message rather than failing oddly. Without the webhook secret, every Stripe event is rejected and subscriptions never activate. |
   | `EMAIL_PROVIDER` + `RESEND_API_KEY` | *Optional.* Companion never sends share links — you copy the link and share it yourself. Without a provider, magic-link sign-in and the two confirm-by-email access modes are unavailable; everything else works. |

3. **Set `SUPER_ADMIN_EMAILS`, then sign up with a listed address.** Order does
   not matter. The allowlist is reconciled at registration *and* on every
   authenticated session, so adding the variable after you already registered
   takes effect on your next request — no SQL, no support ticket. To apply it
   immediately, run `pnpm admin:bootstrap` from a shell on the service
   (`--dry-run` shows what it would change). It is idempotent and it never
   demotes: removing an address does not revoke anyone, because a typo in an
   environment variable must not be able to lock every operator out at once.
4. **Point Stripe at the webhook endpoint** (`{APP_URL}/api/stripe/webhook`) and
   paste its signing secret into `STRIPE_WEBHOOK_SECRET`. Without it every event
   is rejected, so subscriptions never activate.

Optionally run `pnpm db:seed` once from a shell. It writes the plan catalogue,
the question packs and the platform limits into the database so a Super Admin
can edit them without a deploy. Skipping it is safe — plans fall back to the
definitions in code — but `/admin/plans` will have nothing to edit until it has
run.

`SESSION_SECRET` is generated by Render and shared with the worker through
`fromService`, so both processes sign and verify the same cookies. Rotating it
signs every recipient out and invalidates open preview URLs.

The worker is a Docker service because conversion needs LibreOffice and
Poppler, which are system packages rather than npm dependencies. Its first
build is slow — it installs LibreOffice — and later builds reuse the layer.

## Elsewhere

Any platform that can run two Node 22 processes works. The worker image is the
only part with system requirements:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @companion/db exec node dist/migrate.js
pnpm --filter @companion/web start     # web
node apps/worker/dist/index.js          # worker
```

## Migrations

Migrations are plain SQL in `packages/db/migrations`, applied in filename order,
one transaction each, recorded in `schema_migrations`. Re-running is safe.

On Render they run as the web service's `preDeployCommand`, so they complete
before the new release serves traffic. Every migration so far is additive or a
rename, so the previous release keeps working while the new one rolls out.

They are deliberately not a background worker: a Render worker that exits is
restarted, so a migration job written that way would run in a loop forever.

## First run

```bash
pnpm db:seed
```

Seeding writes the plan catalogue, the question packs and the platform limits,
and promotes the addresses in `SUPER_ADMIN_EMAILS` to Super Admin. That is the
only bootstrap path to `/admin`; the role is never inferred from an email
domain. It seeds no customers and no metrics.

## Health and liveness

- `GET /api/health` — used by Render's health check. Reports the database,
  Redis and storage.
- The worker has no HTTP surface. It writes a heartbeat row, and the quality
  engine reports `performance.worker_liveness` from it. A worker that stops
  beating shows up on `/admin/quality` and `/admin/jobs`.

## After a release

Two commands and one page.

```bash
BASE=https://your-domain \
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... \
pnpm smoke:production
```

Non-destructive and safe against production: it creates no Companion, charges
nothing, sends no email, and the one object it writes is deleted by the same
request. It checks reachability, the headers on a share link, that the admin
API is closed to anonymous callers, and then reads the readiness report — which
is where storage, providers, migrations, pgvector and worker liveness are
verified. It exits non-zero if anything is CRITICAL, so it drops straight into
a deploy pipeline.

Without admin credentials it still runs, and reports the deep checks as skipped
rather than passed.

Then open **`/admin/quality`**. The page leads with **Production readiness**:
every check, its status, and one line of remediation for each failure.

```
Production readiness                                   21 / 24

Infrastructure
  Database              PASS      Reachable in 3ms
  pgvector extension    PASS      Installed
  Migrations            PASS      5 applied, latest 0004_analytics_key_required.sql
  Queue backend         PASS      Reachable in 1ms
  Worker heartbeat      PASS      Last beat 8s ago, 0 active
  Document conversion   PASS      LibreOffice and Poppler available
Storage
  Object storage        CRITICAL  STORAGE_DRIVER is local in production
                                  Configure an S3-compatible object store. A disk is
                                  attached to one instance, so the worker cannot read
                                  what the web service wrote.
```

Below it, the quality metrics. The two are deliberately separate: readiness
asks whether the deployment is plugged in, the metrics ask how well it
performs. A perfect recall score on an instance with no object storage is not
a healthy deployment.

Worth reading first:

- **CRITICAL readiness checks.** Something a customer would hit today.
- **Blocking quality failures.** A `CRITICAL` or `HARD_FAIL` with its evidence
  attached — the storage keys that did not verify, the pages that went missing,
  the citation ids that did not resolve.
- **Never measured.** A metric with no evidence in the window is reported as
  unmeasured rather than as passing. If a whole domain is unmeasured after a
  release, something is not running.

Then press **Run golden corpus** to re-measure retrieval against known answers
and compare it with the previous release.

## First deployment acceptance test

Run this once, by hand, against the real deployment. It is the test that
exercises the product rather than its parts — and the only one that proves the
web service and the worker are looking at the same storage.

| # | Step | What proves it |
| --- | --- | --- |
| 1 | Sign up with the address in `SUPER_ADMIN_EMAILS` | Account created |
| 2 | Open `/admin` | The console loads rather than 404s |
| 3 | Upload a small real PDF | Upload accepted |
| 4 | Watch `/admin/jobs` | `ingest_upload` moves to RUNNING — the worker sees the file the web service wrote |
| 5 | Wait for the build screen | Page images appear |
| 6 | `/admin/companions` → the Companion | Units extracted, count is non-zero |
| 7 | Same page | Indexed chunks non-zero |
| 8 | Same page | Status ACTIVE |
| 9 | Open `/c/<slug>` in a private window | Loads with no account |
| 10 | Look at it | The document renders |
| 11 | Ask a question about its content | Answer arrives |
| 12 | Read the answer | Grounded, no invented figures |
| 13 | Click a citation | Navigates to that page |
| 14 | Sender's Analytics tab | The visit and the question are recorded |
| 15 | Turn downloads off | Setting saves |
| 16 | Retry the download in the private window | 403, and no original URL anywhere in the network tab |
| 17 | Revoke the Companion | Setting saves |
| 18 | Reload the private window | Access refused immediately, no cached copy |
| 19 | `/admin/usage` | Tokens and cost recorded for the question |
| 20 | `/admin/audit` | Every action above is listed with an actor |
| 21 | `/admin/quality` | Readiness green; ingestion, viewer and answer metrics recorded for this document |

Step 4 is the one that catches a storage misconfiguration, and step 16 the one
that catches a leaked original. If the first eight steps pass, the two services
share storage and the queue works — which is most of what a first deploy can
get wrong.

## Backups

Postgres holds everything except the document bytes. Both need backing up:
Render's managed Postgres does daily backups and point-in-time recovery; the
bucket needs versioning enabled, because a deleted object is not recoverable
from the database.

## Rotating secrets

| Secret | Effect of rotating |
| --- | --- |
| `SESSION_SECRET` | Every recipient session ends; open preview URLs stop resolving. Senders stay signed in. |
| `OPENAI_API_KEY` | None, beyond in-flight requests. |
| `S3_SECRET_ACCESS_KEY` | None, if the new key reaches both services together. |
| `STRIPE_WEBHOOK_SECRET` | Events signed with the old secret are rejected. Stripe retries; add the new endpoint before removing the old one. |
