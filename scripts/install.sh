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

# Company line for the banner (brand/brand.json; PMI's when absent).
BRAND_LINE="$(python3 -c "import json
try: b=json.load(open('$PROJECT_ROOT/brand/brand.json'))
except Exception: b={}
c=b.get('company_name') or 'Precisian Medical Instruments'; p=(b.get('product') or {}).get('name') or ('VACTOR' if not b else '')
print(c + (' / ' + p if p else ''))" 2>/dev/null || echo 'Precisian Medical Instruments / VACTOR')"
echo
echo "================================================"
echo "  Little Gerry - AI Executive Assistant Installer"
echo "  $BRAND_LINE (macOS)"
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
# Database names from brand/brand.json (PMI's when absent): written to the root
# .env for docker-compose and the Start/Stop scripts, and into backend/.env below.
brand_db() { python3 -c "import json
try: d=json.load(open('$PROJECT_ROOT/brand/brand.json')).get('db',{})
except Exception: d={}
print(d.get('$1') or '$2')"; }
PG_NAME="$(brand_db name pmi_dev)"; PG_SUPER="$(brand_db superuser pmi)"
PG_APP="$(brand_db app_role pmi_app)"; PG_AUDIT="$(brand_db audit_role pmi_audit)"
PG_CONTAINER="$(brand_db postgres_container pmi_postgres)"
cat > "$PROJECT_ROOT/.env" <<EOF
# Written by scripts/install.sh from brand/brand.json - read by docker-compose.yml and the Start/Stop scripts.
POSTGRES_CONTAINER=$PG_CONTAINER
POSTGRES_USER=$PG_SUPER
POSTGRES_DB=$PG_NAME
DB_APP_ROLE=$PG_APP
DB_AUDIT_ROLE=$PG_AUDIT
EOF
docker compose up -d
wait_for "docker exec $PG_CONTAINER pg_isready -U $PG_SUPER -d $PG_NAME" 20 3 "PostgreSQL" || exit 1

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
# The env file wins over the brand defaults inside the app, so it must carry the brand's names.
sed -i.bak -E "s#^DATABASE_URL=.*#DATABASE_URL=postgresql+asyncpg://$PG_SUPER:pmi_dev_password@localhost:5432/$PG_NAME#; s#^DATABASE_URL_SYNC=.*#DATABASE_URL_SYNC=postgresql://$PG_SUPER:pmi_dev_password@localhost:5432/$PG_NAME#" "$BACKEND_DIR/.env" && rm -f "$BACKEND_DIR/.env.bak"
ok "Database names: $PG_NAME / $PG_SUPER / $PG_APP (container $PG_CONTAINER)"

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
