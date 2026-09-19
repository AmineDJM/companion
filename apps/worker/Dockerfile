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
RUN pnpm install --frozen-lockfile --filter @companion/worker...

# ─── Build ───────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm --filter @companion/worker... build

# Production dependency tree only, so the image carries no compiler.
RUN pnpm prune --prod

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
