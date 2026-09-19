# Architecture

## The shape of it

```
 visitor            sender                recipient
    │                  │                      │
    ▼                  ▼                      ▼
┌──────────────────────────────────────────────────────┐
│                    apps/web  (Next.js)               │
│  marketing + dropzone │ sender app │ viewer │ /admin │
└──────────┬──────────────────┬───────────────┬────────┘
           │ enqueue          │ read/write    │ read
           ▼                  ▼               ▼
      ┌─────────┐      ┌─────────────┐   ┌─────────┐
      │  Redis  │      │  Postgres   │   │   S3    │
      │ BullMQ  │      │ + pgvector  │   │ private │
      └────┬────┘      └──────┬──────┘   └────┬────┘
           │ consume          │               │
           ▼                  │               │
┌──────────────────────────────────────────────────────┐
│                  apps/worker                         │
│  archive → ingest → extract → chunk → embed → final  │
│  LibreOffice · Poppler · vision reads · measurement   │
└──────────────────────────────────────────────────────┘
```

No HTTP request ever waits on LibreOffice. The web service accepts an upload,
writes the bytes and a job row, and returns; everything after that is the
worker's.

## The ingestion pipeline

Each stage replaces its own output rather than appending, and each job carries
an idempotency key, so a retry after a crash produces the same result.

1. **`extract_archive`** — ZIPs are streamed with `yauzl`. Entry names are
   decoded by Companion rather than by the library, because one hostile name
   must not abort a hundred-file upload. Traversal (`../`), absolute paths,
   symlinks, executables and declared-size lies are each rejected individually,
   and the compression ratio is budgeted so a zip bomb runs out of allowance
   instead of memory.
2. **`ingest_upload`** — the bytes are re-digested against the upload hash
   before anything is derived from them. Every Office format — legacy binary,
   OOXML, macro-enabled, template, OpenDocument — is normalised to PDF with
   LibreOffice, which is why a 2003 deck and a 2024 one reach the recipient as
   the same thing. PDFs are then rasterised to WebP page images with Poppler at
   200 DPI (A4 lands at 1654px, a widescreen slide at the 2400px cap), which is
   what makes "downloads disabled" mean something and what keeps text crisp on
   a retina or 27-inch display. A sample of pages is compared against a
   lossless reference render.
3. **`extract_text`** — one document unit per page, slide or sheet, carrying
   enough locator detail to navigate to. A page with no usable embedded text is
   handed to the vision reader at 300 then 400 DPI; the result is scored for
   legibility and only accepted above the threshold.
4. **`chunk`** — semantic chunks that never straddle a page boundary, each
   denormalised with its citation metadata so retrieval needs no joins. Chunks
   whose text is unchanged keep their embedding, so replacing one page of a
   200-page document re-embeds one page.
5. **`embed`** — `text-embedding-3-small`, 1536 dimensions, batched, with the
   real token usage written to the ledger. Index coverage is then measured
   against the extracted text.
6. **`finalize_companion`** — flips the Companion to ACTIVE once nothing is in
   flight. One malformed file in a bundle of a hundred never fails the whole
   Companion.

## Answering a question

```
access → rate limit → quota → spend cap → protection classifier →
retrieval → bounded context → Luna → citation resolution →
outbound quote enforcement → persistence → verification
```

The order is enforced in `apps/web/src/server/services/ask.ts`, not in a route
handler. A refusal produced before the model is called costs nothing and does
not consume the customer's allowance.

Retrieval runs two searches — `websearch_to_tsquery` with `ts_rank_cd`, and
pgvector cosine — and fuses them with Reciprocal Rank Fusion. Results are
boosted toward the page the reader is looking at, diversified so one file
cannot monopolise the context, and cut to a token budget. Four to eight
passages reach the model.

Citations come back as source ids. An id the model invented is dropped; a quote
that does not appear in the passage it claims is discarded; what survives is
trimmed to the session's remaining verbatim budget. Protection is enforced on
the way out, independently of whatever the model decided to do.

Verification runs after the answer is durable, so gathering evidence can never
delay a reader's reply.

## Distribution

Companion produces a link and stops. It has no address book, no send queue and
no delivery reputation to manage, because the sender already has all three in
whatever they use every day. The link is the product's entire distribution
mechanism, which is why the core path never touches a mail provider:

```
Upload -> Attach Companion -> Copy link
```

Email appears only where Companion has to reach someone *it* has no other
channel to: a magic-link sign-in (a password works instead) and the two access
modes where a recipient confirms their own address. Those are optional
features, and without a provider the UI marks them unavailable and says why
rather than letting a sender publish a link nobody can open.

## Access control

Availability is derived from the clock, not from a status a sweep has to write.
`evaluateCompanionAvailability` reads `expiresAt` on every request, so a link
expires the instant it should and extending one revives it with no job in
between. Revocation and pause are the same: a status change closes the link on
the next request.

Recipient sessions are opaque tokens hashed in the database. The cookie is
minted in `middleware.ts`, because a Server Component cannot set one, and
handed to the request through a header.

## Multi-tenancy

Every tenant-scoped query filters on `workspaceId` or `companionId`, and no
endpoint trusts an id without checking ownership. `workspaceId = undefined` is
never used to mean "platform-wide": platform queries live in admin services
that require a Super Admin and say so in their own names.

## Plans and entitlements

`PLAN_DEFINITIONS` describes what each plan includes. Product code asks the
resolved entitlements — `entitlements.customBranding`, not `plan === 'pro'` —
and an ESLint rule fails the build on the latter. A Super Admin can change a
plan's entitlements, or grant one workspace an override, without a deploy.

## Quality

`packages/quality` holds the versioned specification and the pure functions
that implement each measurement: SSIM, perceptual hashing, coverage by probe
reachability, numeric consistency, groundedness, legibility, and the standard
IR measures. Both the worker and the web app record evidence through the same
`measure()` call into `quality_evaluations`, each row tagged with the spec
version that judged it and the release that produced it.

The gate is not a weighted average. One `CRITICAL` or `HARD_FAIL` blocks,
however good everything else looks.
