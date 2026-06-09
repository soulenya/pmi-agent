#!/bin/bash
# ============================================================
#  Little Gerry - Pull latest code from GitHub and refresh (macOS)
#  Developer-checkout updater (mirrors scripts/update.ps1).
#
#  Usage:
#     bash scripts/update.sh            # update + restart
#     bash scripts/update.sh --no-restart
# ============================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

RESTART=1
[ "${1:-}" = "--no-restart" ] && RESTART=0

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

step() { printf '\n== %s ==\n' "$1"; }
ok()   { printf '  [OK] %s\n' "$1"; }
info() { printf '       %s\n' "$1"; }
fail() { printf '  [XX] %s\n' "$1" >&2; }

echo
echo "================================================"
echo "  Little Gerry -- Update (macOS)"
echo "================================================"

cd "$PROJECT_ROOT"
before="$(git rev-parse --short HEAD 2>/dev/null)"
info "Current version : $before"

step "Step 1 of 4 - Pulling latest code from GitHub"
git fetch origin
git reset --hard origin/master || { fail "git pull failed."; exit 1; }
after="$(git rev-parse --short HEAD 2>/dev/null)"
ok "Updated : $before -> $after"

step "Step 2 of 4 - Updating Python dependencies"
( cd "$BACKEND_DIR" && uv sync ) || { fail "uv sync failed."; exit 1; }
ok "Python dependencies up to date"

step "Step 3 of 4 - Running database migrations"
if ! docker info >/dev/null 2>&1; then
  info "Starting Docker Desktop..."
  open -a Docker || true
  for i in $(seq 1 15); do docker info >/dev/null 2>&1 && break; sleep 3; done
fi
( cd "$PROJECT_ROOT" && docker compose up -d ) >/dev/null 2>&1 || true
for i in $(seq 1 20); do
  docker exec pmi_postgres pg_isready -U pmi -d pmi_dev >/dev/null 2>&1 && break
  sleep 3
done
( cd "$BACKEND_DIR" && uv run alembic upgrade head ) || { fail "migrations failed."; exit 1; }
ok "Database schema is up to date"

step "Step 4 of 4 - Updating frontend dependencies"
( cd "$FRONTEND_DIR" && npm install ) || { fail "npm install failed."; exit 1; }
ok "Frontend dependencies up to date"

if [ "$RESTART" -eq 1 ]; then
  info "Restarting Little Gerry..."
  /bin/bash "$PROJECT_ROOT/Stop Little Gerry.command" >/dev/null 2>&1 || true
  nohup "$PROJECT_ROOT/Start Little Gerry.command" >/dev/null 2>&1 &
fi

echo
echo "  Update complete."
echo
