#!/usr/bin/env bash
# Local development helper: loads .env and starts a service with the
# environment Node needs behind an outbound proxy (if one is configured).
set -euo pipefail
cd "$(dirname "$0")"
set -a
[ -f .env ] && . ./.env
set +a
export NODE_USE_ENV_PROXY="${NODE_USE_ENV_PROXY:-1}"
[ -f /root/.ccr/ca-bundle.crt ] && export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
exec "$@"
