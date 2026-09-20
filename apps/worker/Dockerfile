# Companion worker.
#
# Document conversion is the reason this is a container rather than a Node
# service: LibreOffice normalises Office formats to PDF so every recipient sees
# the same layout, and Poppler rasterises pages so a view-only link can serve
# pictures instead of the source file. There is no Tesseract — pages without
# usable embedded text are read by the vision model and scored before they
# reach the index.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# ─── Dependencies ────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/ai/package.json ./packages/ai/
COPY packages/storage/package.json ./packages/storage/
COPY packages/queue/package.json ./packages/queue/
COPY packages/quality/package.json ./packages/quality/
# Listed in pnpm-workspace.yaml, so its manifest has to be present for the
# lockfile check even though the filter below installs none of its packages.
COPY e2e/package.json ./e2e/
# Nothing in this image runs a browser; Playwright must not fetch one.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# An image build is unattended. Set on this stage rather than the base one so
# it reaches the build and not the running worker.
ENV CI=true
RUN pnpm install --frozen-lockfile --filter @companion/worker...

# ─── Build ───────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm --filter @companion/worker... build

# There is deliberately no `pnpm prune --prod` here.
#
# It used to be, and it made the image unbuildable:
#
#   ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
#     Aborted removal of modules directory due to no TTY
#
# The install above is filtered to this one app, which leaves a partial
# workspace on disk; an unfiltered prune sees that and wants to purge the whole
# modules directory, which it will not do without a terminal to ask.
#
# The obvious fix — CI=true, which the error itself suggests — is worse than
# the failure. It lets the purge proceed, and the unfiltered prune that follows
# restores nothing for the workspace packages: the worker's own production
# dependencies are deleted along with the dev ones. That trades a build that
# fails loudly for an image that builds green and then dies on the first
# require. Measured, not assumed: a scratch workspace reproducing this exact
# sequence lost its production dependency to `CI=true pnpm prune --prod`.
#
# So the image keeps its dev dependencies. It is larger than it needs to be —
# TypeScript and the test runner ride along for nothing. The fix that both
# builds and stays small is `pnpm deploy --legacy --filter @companion/worker
# --prod`, which produces a self-contained production tree; it changes the
# layout the runtime stage copies, so it wants a real image build to confirm
# rather than a reasoned guess.

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-impress \
        poppler-utils \
        fonts-liberation \
        fonts-dejavu-core \
        fonts-noto-core \
        fonts-noto-cjk \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# LibreOffice writes a profile on first run; give it a writable home.
ENV HOME=/tmp

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/worker ./apps/worker
COPY --from=build /app/package.json ./package.json

USER node

# No HTTP surface: liveness is the heartbeat row this process writes, which the
# quality engine reports as performance.worker_liveness.
CMD ["node", "apps/worker/dist/index.js"]
