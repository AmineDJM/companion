# Companion

**Share documents that can answer questions.**

You drop files in. You get one link. Whoever opens it sees the document
immediately — no account, no signup wall, no landing page — and can ask it
anything.

The document is the interface. The intelligence is attached to it, quietly, as
a single line at the bottom of the page: *✦ Ask anything…*

---

## What it does

- **One dropzone, one link.** Files, folders and ZIPs in any mix produce one
  permanent URL (`/c/x8K2pz`). Adding or replacing content later keeps the same
  link.
- **The recipient needs nothing.** No account, no install. The first page is
  visible before anything else loads.
- **Answers cite their source.** Every claim points at a file and a page, and
  clicking it navigates there. A citation the model invented is dropped before
  the answer is sent.
- **The sender stays in control.** Public, password, invited-addresses or
  identified access; expiry that is always extendable; pause and revoke that
  take effect on the next request; downloads on or off.
- **Downloads off means off.** With downloads disabled the recipient receives
  rendered page images and there is no route that returns the original bytes.
  Screenshots and photographs remain possible — that is stated plainly rather
  than claimed away.
- **You learn what people asked.** Views, readers, time per page, which files
  mattered, and the questions the documents could not answer.

## How it is built

```
apps/
  web/        Next.js 16 — marketing, sender app, recipient viewer, /admin
  worker/     BullMQ worker — extraction, conversion, chunking, embedding
packages/
  shared/     Domain rules with no I/O: access, entitlements, pricing, protection
  db/         Drizzle schema, plain-SQL migrations, seed
  ai/         Provider abstraction, prompts, chunking, retrieval fusion
  storage/    S3 and local drivers behind one interface
  queue/      Durable, idempotent job dispatch
  quality/    The measurement engine and its versioned specification
e2e/          Playwright
tests/        Unit and integration suites
```

**Retrieval** is hybrid. Postgres full-text search and pgvector cosine search
each produce a ranked list; the two are fused with Reciprocal Rank Fusion,
nudged toward the page the reader is currently looking at, diversified across
files and trimmed to a token budget. Four to eight passages reach the model.

**Answering** goes through `DocumentAnswerProvider`. V1 has one implementation,
`gpt-5.6-luna` over the Responses API, with a stable prompt prefix so the shared
instructions are cached. The model is never named in the interface.

**Reading scanned pages** uses the vision model, not OCR. Classical OCR
produces confidently wrong text that poisons retrieval invisibly; a vision read
is scored by a deterministic legibility check before it is allowed into the
index, and a page that scores badly is recorded as such rather than quietly
accepted.

**Costs** come from one table. `packages/shared/src/ai-pricing.ts` holds every
price, versioned; no price literal appears anywhere else. Every provider call
writes a ledger row with real token counts, the computed cost and the pricing
version that computed it. The ledger is append-only by database trigger:
granting a customer credit adds an adjustment row, it never edits history.

## Quality is measured, not asserted

`packages/quality/spec/*.json` defines sixty metrics. Each one states what is
measured, how, the unit, the target, the warning and failure thresholds, the
severity, **where the threshold came from**, and how to repair it.

```
MEASURE → COMPARE → FAIL → REPAIR → REMEASURE
```

Nothing in the engine asks a model whether its own output looks right.

- **Ingestion.** The worker re-digests the bytes it reads against the upload
  digest and refuses to build anything from a file that did not survive
  storage. Parsed pages are counted against what the container declares.
  Delivered page images are compared to a lossless reference render with SSIM,
  aspect ratio and a perceptual hash, so a stretched, blank or misnumbered page
  is caught. Index coverage is measured against the extracted text: if a
  paragraph is unreachable through search, that is a failure with the missing
  run attached.
- **Answers.** Citation ids must resolve, quotes must appear verbatim in the
  passage they claim, every material figure must exist in the evidence — a
  €50,000 fee reported as €500,000 is a hard failure, not a rounding note — and
  every factual sentence is classified SUPPORTED, INFERRED or UNSUPPORTED by
  lexical overlap and numeric agreement.
- **Retrieval.** A golden corpus with known answers, scored with Recall@K,
  Precision@K, MRR and nDCG. These targets are Companion's own; they are
  labelled `COMPANION_HOUSE_STANDARD`, not dressed up as an industry standard.
- **Security.** The access matrix, cross-tenant isolation, revocation latency,
  expiry precision, password brute force and a corpus of adversarial questions
  are all tested against a real database. A case counts as a successful attack
  only when a string it declares forbidden comes back.
- **Storage.** A sweep re-HEADs stored objects, deep-verifies a sample against
  their digests, and writes and re-reads a probe object to prove the bucket
  still round-trips. Ephemeral disk fails this by construction.

One `CRITICAL` or `HARD_FAIL` blocks a release outright. There is deliberately
no overall score: a single number lets good latency average away a cross-tenant
leak.

`/admin/quality` shows every metric, its live value, the evidence behind its
last failure, and which release changed it. A metric that has never been
measured is reported as unmeasured — not as passing.

## Running it locally

**You need** Node 22, pnpm 10, PostgreSQL 16 with pgvector, Redis, and — for
Office conversion and page rendering — LibreOffice and Poppler.

```bash
# Debian/Ubuntu
sudo apt-get install libreoffice poppler-utils
# macOS
brew install --cask libreoffice && brew install poppler
```

```bash
pnpm install
cp .env.example .env          # fill in SESSION_SECRET and OPENAI_API_KEY
createdb companion_dev
pnpm db:migrate
pnpm db:seed
pnpm dev                      # web on :3000, worker alongside it
```

Without `OPENAI_API_KEY` everything still works except questions: documents
open, render and index for keyword search, and the quality engine records that
semantic indexing did not run rather than pretending it did.

## Verifying it

```bash
pnpm verify            # typecheck, lint, unit and integration tests
pnpm test:unit         # pure logic: access, protection, quotas, measurement
pnpm test:integration  # real Postgres: authorisation, isolation, timing
pnpm test:e2e          # Playwright, against a running app
```

The integration suite truncates every table, so it refuses to start unless
`TEST_DATABASE_URL` names a database whose name ends in `_test`.

```bash
createdb companion_test
pnpm test:integration
```

## Deploying

`render.yaml` provisions a web service, a Docker worker (Docker because
LibreOffice and Poppler are system packages), Postgres 16 and a Key Value
instance. Migrations run as the web service's pre-deploy command. Every secret
is `sync:false`, so it is entered once in the Render dashboard and never
appears in this repository.

The blueprint is not a one-click product: `APP_URL`, the S3 credentials, the
OpenAI key and `SUPER_ADMIN_EMAILS` have to be filled in before the first
deploy, and `SUPER_ADMIN_EMAILS` specifically has to be set *before* you
register, because the role is granted at account creation.

One thing is not optional: **object storage must be S3-compatible**. A Render
disk belongs to one instance and does not survive a redeploy, so it cannot hold
a customer's documents. Point `STORAGE_DRIVER=s3` at a private bucket — S3, R2
or B2 — and the durability probe will confirm it round-trips. Leave it on
`local` in production and the same probe reports a `CRITICAL` failure, by
design.

See [`docs/deployment.md`](docs/deployment.md) for the full sequence and
[`docs/architecture.md`](docs/architecture.md) for how the pieces fit together.

## Where things live

| I want to… | Look at |
| --- | --- |
| change who can open a link | `packages/shared/src/access.ts` |
| change what a plan includes | `packages/shared/src/entitlements.ts` |
| change a model price | `packages/shared/src/ai-pricing.ts` |
| change how much may be quoted | `packages/shared/src/source-protection.ts` |
| change how passages are chosen | `packages/shared/src/retrieval.ts`, `apps/web/src/server/services/retrieval.ts` |
| add or retune a quality metric | `packages/quality/spec/*.json` |
| change how a file is read | `apps/worker/src/extractors/` |

Product capability is never decided by a plan name. Asking
`entitlements.customBranding` is the only supported way; an ESLint rule fails
the build on `plan === 'pro'`.
