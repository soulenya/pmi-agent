#!/bin/bash
# ============================================================
#  Little Gerry - Full automated setup for macOS (Apple Silicon)
#  Precisian Medical Instruments / VACTOR program
#
#  Installs prerequisites via Homebrew, brings up the database,
#  runs migrations, and installs frontend dependencies.
#
#  Prerequisites installed automatically:
#    - Homebrew (if missing)
#    - Docker Desktop  (runs the PostgreSQL + pgvector database)
#    - Node.js 20 LTS
#    - uv  (Python package manager; uv installs Python 3.14 itself)
#
#  Run from the project root:
#       bash scripts/install.sh
# ============================================================
set -euo pipefail

# ── Resolve project root ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

step() { printf '\n== %s ==\n' "$1"; }
ok()   { printf '  [OK] %s\n' "$1"; }
info() { printf '       %s\n' "$1"; }
warn() { printf '  [!!] %s\n' "$1"; }
fail() { printf '  [XX] %s\n' "$1" >&2; }

wait_for() {  # wait_for "<command>" <attempts> <sleep_seconds> "<label>"
  local cmd="$1" attempts="$2" delay="$3" label="$4" i
  info "Waiting for $label..."
  for ((i = 1; i <= attempts; i++)); do
    if eval "$cmd" >/dev/null 2>&1; then ok "$label is ready"; return 0; fi
    sleep "$delay"
  done
  fail "$label did not become ready in time."
  return 1
}

echo
echo "================================================"
echo "  Little Gerry - AI Executive Assistant Installer"
echo "  Precisian Medical Instruments / VACTOR (macOS)"
echo "================================================"
echo
info "Project root : $PROJECT_ROOT"

# ────────────────────────────────────────────────────────────────────────────
step "Step 1 of 7 - Installing prerequisites (Homebrew)"
# ────────────────────────────────────────────────────────────────────────────
if ! command -v brew >/dev/null 2>&1; then
  info "Homebrew not found - installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
# Put brew on PATH for this session (Apple Silicon default location).
if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

brew_cask_if_missing() {  # brew_cask_if_missing <cask> <check-cmd> <label>
  if command -v "$2" >/dev/null 2>&1 || [ -d "/Applications/Docker.app" ]; then
    ok "$3 already installed"
  else
    info "Installing $3 via Homebrew..."
    brew install --cask "$1"
  fi
}
brew_if_missing() {  # brew_if_missing <formula> <check-cmd> <label>
  if command -v "$2" >/dev/null 2>&1; then
    ok "$3 already installed"
  else
    info "Installing $3 via Homebrew..."
    brew install "$1"
  fi
}

brew_cask_if_missing "docker"   "docker" "Docker Desktop"
brew_if_missing      "node@20"   "node"   "Node.js 20 LTS"
brew_if_missing      "uv"        "uv"     "uv (Python package manager)"
# Python itself is managed by uv (backend/.python-version pins 3.14, matching
# the Windows build) — `uv sync` downloads a native arm64 interpreter as needed.

# ────────────────────────────────────────────────────────────────────────────
step "Step 2 of 7 - Starting Docker Desktop"
# ────────────────────────────────────────────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
  info "Docker Desktop is not running - starting it..."
  open -a Docker || { fail "Could not launch Docker Desktop. Install it and re-run."; exit 1; }
  wait_for "docker info" 30 3 "Docker Desktop" || exit 1
else
  ok "Docker Desktop is already running"
fi

# ────────────────────────────────────────────────────────────────────────────
step "Step 3 of 7 - Starting PostgreSQL (Docker Compose)"
# ────────────────────────────────────────────────────────────────────────────
cd "$PROJECT_ROOT"
docker compose up -d
wait_for "docker exec pmi_postgres pg_isready -U pmi -d pmi_dev" 20 3 "PostgreSQL" || exit 1

# ────────────────────────────────────────────────────────────────────────────
step "Step 4 of 7 - Configuring backend environment"
# ────────────────────────────────────────────────────────────────────────────
if [ ! -f "$BACKEND_DIR/.env" ]; then
  if [ -f "$BACKEND_DIR/.env.example" ]; then
    cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
    ok ".env created from .env.example"
  else
    cat > "$BACKEND_DIR/.env" <<'EOF'
DATABASE_URL=postgresql+asyncpg://pmi:pmi_dev_password@localhost:5432/pmi_dev
DATABASE_URL_SYNC=postgresql://pmi:pmi_dev_password@localhost:5432/pmi_dev
HOST=127.0.0.1
PORT=8000
DEBUG=false
OLLAMA_BASE_URL=
DEFAULT_EMBEDDING_MODEL=nomic-embed-text
CHUNK_SIZE_TOKENS=512
CHUNK_OVERLAP_TOKENS=64
RAG_TOP_K=5
APPROVAL_EXPIRY_HOURS=48
EOF
    ok ".env created with defaults"
  fi
else
  ok ".env already exists - skipping"
fi

# ────────────────────────────────────────────────────────────────────────────
step "Step 5 of 7 - Installing Python backend dependencies"
# ────────────────────────────────────────────────────────────────────────────
cd "$BACKEND_DIR"
uv sync
ok "Python dependencies installed"

# ────────────────────────────────────────────────────────────────────────────
step "Step 6 of 7 - Running database migrations"
# ────────────────────────────────────────────────────────────────────────────
uv run alembic upgrade head
ok "Database schema is up to date"
info "Seeding admin user (admin@precisian.local / Admin1234!)..."
uv run python scripts/seed_admin.py || warn "Admin seed skipped (may already exist)"

# ────────────────────────────────────────────────────────────────────────────
step "Step 7 of 7 - Installing frontend dependencies"
# ────────────────────────────────────────────────────────────────────────────
cd "$FRONTEND_DIR"
npm install
if [ ! -f "$FRONTEND_DIR/.env" ]; then
  printf 'VITE_API_BASE=http://127.0.0.1:8000\nVITE_WS_BASE=ws://127.0.0.1:8000\n' \
    > "$FRONTEND_DIR/.env"
  ok "frontend/.env created"
fi

# Make the launcher scripts double-clickable in Finder.
chmod +x "$PROJECT_ROOT/Start Little Gerry.command" \
         "$PROJECT_ROOT/Stop Little Gerry.command" \
         "$SCRIPT_DIR/apply_update.sh" 2>/dev/null || true

echo
echo "================================================"
echo "  Setup complete!"
echo "  Double-click 'Start Little Gerry.command' to launch."
echo "================================================"
echo
