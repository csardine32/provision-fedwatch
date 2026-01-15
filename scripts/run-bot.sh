#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Load repo .env if present
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Ensure fixture mode is OFF
unset SAM_FIXTURE_PATH

node bot/cli.js run --verbose
