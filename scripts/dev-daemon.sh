#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

export RAMBLA_LISTEN="${RAMBLA_LISTEN:-127.0.0.1:6768}"
configure_dev_rambla_home

if [ -z "${RAMBLA_LOCAL_MODELS_DIR}" ]; then
  export RAMBLA_LOCAL_MODELS_DIR="$HOME/.rambla/models/local-speech"
  mkdir -p "$RAMBLA_LOCAL_MODELS_DIR"
fi

echo "══════════════════════════════════════════════════════"
echo "  Rambla Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${RAMBLA_HOME}"
echo "  Models:  ${RAMBLA_LOCAL_MODELS_DIR}"
echo "  Listen:  ${RAMBLA_LISTEN}"
echo "══════════════════════════════════════════════════════"

export RAMBLA_CORS_ORIGINS="${RAMBLA_CORS_ORIGINS:-*}"
export RAMBLA_NODE_INSPECT="${RAMBLA_NODE_INSPECT:---inspect=0}"

if [ "${RAMBLA_SKIP_DEV_SERVER_BUILD:-0}" = "1" ]; then
  exec npm run dev:server:watch
fi

exec sh -c 'npm run build:server-deps && npm run dev:server:watch'
