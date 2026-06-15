#!/bin/bash
# ============================================================
#  Little Gerry - Start All Services (macOS)
#  Precisian Medical Instruments / VACTOR Program
#
#  Double-click in Finder to launch. First run does a one-time
#  setup (Python deps, database, migrations, frontend deps);
#  later runs start straight away.
#
#  If double-clicking is blocked, make it executable once:
#     chmod +x "Start Little Gerry.command"
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# If anything fails, keep the Terminal window open so the error is readable
# instead of the window vanishing instantly.
pause_on_fail() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    echo
    echo "  ===================================================="
    echo "   Little Gerry stopped (exit code $rc)."
    echo "   Logs: $DIR/backend/logs/"
    echo "  ===================================================="
    echo "  Press Return to close this window..."
    read -r _ || true
  fi
}
trap pause_on_fail EXIT

# Put Homebrew + user tools on PATH (Apple Silicon brew lives in /opt/homebrew).
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

VENV_PY="$DIR/backend/.venv/bin/python"
mkdir -p "$DIR/backend/logs"

wait_for() {  # wait_for "<command>" <attempts> <sleep_seconds> "<label>"
  local cmd="$1" attempts="$2" delay="$3" label="$4" i
  for ((i = 1; i <= attempts; i++)); do
    if eval "$cmd" >/dev/null 2>&1; then return 0; fi
    sleep "$delay"
  done
  echo "  [ERROR] $label did not become ready in time." >&2
  return 1
}

start_database() {
  if ! docker info >/dev/null 2>&1; then
    echo "  Launching Docker Desktop..."
    open -a Docker || true
    wait_for "docker info" 30 3 "Docker Desktop" || exit 1
  fi
  # Self-heal: drop a stray pmi_postgres container this project doesn't own.
  if [ -z "$(docker compose ps -q postgres 2>/dev/null)" ]; then
    docker rm -f pmi_postgres >/dev/null 2>&1 || true
  fi
  docker compose up -d --remove-orphans
  wait_for "docker exec pmi_postgres pg_isready -U pmi -d pmi_dev" 20 3 "PostgreSQL" || exit 1
}

# ── First-run setup (runs only if the venv is missing) ──────────────────────
if [ ! -x "$VENV_PY" ]; then
  echo
  echo "  ===================================================="
  echo "   Little Gerry - First Run Setup"
  echo "   Installing prerequisites (Homebrew, Docker, Node, uv),"
  echo "   the database, and app dependencies."
  echo "   This can take several minutes the first time. Please wait..."
  echo "  ===================================================="
  echo

  if [ ! -f "$DIR/scripts/install.sh" ]; then
    echo "  [ERROR] scripts/install.sh is missing — cannot complete setup." >&2
    exit 1
  fi

  # install.sh installs any missing prerequisites (Homebrew, Docker Desktop,
  # Node, uv), brings up PostgreSQL, runs migrations, seeds the admin user, and
  # installs frontend deps. It is idempotent, so re-running it is safe.
  bash "$DIR/scripts/install.sh"

  echo
  echo "  ===================================================="
  echo "   Setup complete! Little Gerry is launching..."
  echo "  ===================================================="
  echo
fi

# ── Launch Little Gerry (splash screen + native window) ─────────────────────
cd "$DIR"
nohup "$VENV_PY" launcher.py >> "$DIR/backend/logs/launcher_stdout.log" 2>&1 &
disown
sleep 2
