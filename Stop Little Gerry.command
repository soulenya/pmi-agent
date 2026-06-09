#!/bin/bash
# ============================================================
#  Little Gerry - Stop All Services (macOS)
#  Gracefully shuts down backend, frontend, and PostgreSQL.
#  (Docker Desktop itself is left running.)
# ============================================================
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo
echo "  Stopping Little Gerry services..."
echo

echo "  [1/3] Stopping frontend and backend..."
for port in 5173 8000; do
  for pid in $(lsof -ti "tcp:$port" 2>/dev/null); do
    kill -9 "$pid" 2>/dev/null || true
  done
done

echo "  [2/3] Stopping the launcher..."
pkill -f "launcher.py" 2>/dev/null || true

echo "  [3/3] Stopping PostgreSQL..."
docker stop pmi_postgres >/dev/null 2>&1 || true
docker compose stop >/dev/null 2>&1 || true

echo
echo "  All services stopped. Goodbye!"
echo
sleep 1
