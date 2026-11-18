#!/bin/sh
# Brings the brain's schema up to date, then serves MCP over HTTP.
set -eu

: "${GBRAIN_DATABASE_URL:?GBRAIN_DATABASE_URL is required, e.g. postgresql://gbrain:<password>@postgres:5432/gbrain?sslmode=disable}"

if [ ! -f "${GBRAIN_HOME}/.gbrain/config.json" ]; then
  gbrain init --non-interactive --no-embedding
fi

# The upgrade steps that follow a new GBrain version. Memory keeps working
# while one is pending, and upstream says not to re-run a failed one blindly,
# so a failure is reported here rather than turned into a restart loop.
gbrain apply-migrations --yes --no-autopilot-install \
  || echo "gbrain-entrypoint: apply-migrations did not finish; run 'gbrain doctor --json' in this container" >&2

# 0.0.0.0 inside the container; who can reach it is decided by what the
# compose file publishes (nothing).
exec gbrain serve --http --bind 0.0.0.0 --port "${GBRAIN_PORT:-3131}" "$@"
