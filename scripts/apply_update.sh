#!/bin/bash
# ============================================================
#  Little Gerry - apply a downloaded update (macOS)
#
#  Launched (detached, via setsid) by launcher.py when a newer
#  signed .pkg is found in GitHub Releases. Stops the running
#  app, installs the update silently into the user's home
#  domain (no sudo), then relaunches.
#
#  Args:
#    $1  Installer  - full path to the downloaded LittleGerry.pkg; its
#                     Developer ID signature is checked against brand.json
#                     before it runs
#    $2  AppDir     - the application install directory (project root)
#
#  Mirrors scripts/apply_update.ps1 on Windows.
# ============================================================
INSTALLER="$1"
APPDIR="$2"

LOGDIR="$APPDIR/backend/logs"
mkdir -p "$LOGDIR" 2>/dev/null
LOGFILE="$LOGDIR/apply_update.log"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOGFILE" 2>/dev/null; }

start_app() {
  local start_cmd="$APPDIR/Start Little Gerry.command"
  if [ -f "$start_cmd" ]; then
    log "Relaunching via: $start_cmd"
    chmod +x "$start_cmd" 2>/dev/null
    nohup "$start_cmd" >/dev/null 2>&1 &
  else
    log "ERROR: Start command not found at $start_cmd"
  fi
}

# Always relaunch on exit so the user is never left with the app down.
trap 'start_app; log "=== apply_update finished ==="' EXIT

log "=== apply_update started ==="
log "Installer: $INSTALLER"
log "AppDir:    $APPDIR"

# ── Signature gate ──────────────────────────────────────────────────────────
# The launcher has already verified the file; check again here because this
# script installs it. Mirrors update_verify.py: pkgutil must report an
# Apple-issued developer signature with a Developer ID Installer identity, and
# the Team ID must be one pinned in brand/brand.json (macos.team_ids). Without
# pins any Apple-issued Developer ID is accepted.
verify_installer() {
  local out status team pins
  out="$(/usr/sbin/pkgutil --check-signature "$1" 2>&1)"
  status="$(printf '%s\n' "$out" | sed -n 's/^ *Status: *//p' | head -1)"
  log "Signature: status=$status"
  case "$status" in
    "signed by a developer certificate issued by Apple"*) ;;
    *) echo "pkgutil status: ${status:-no signature}"; return ;;
  esac
  team="$(printf '%s\n' "$out" | sed -nE 's/.*Developer ID Installer: .*\(([A-Z0-9]{10})\).*/\1/p' | head -1)"
  if [ -z "$team" ]; then echo "signed, but not with a Developer ID Installer certificate"; return; fi
  pins="$(/usr/bin/python3 -c 'import json,sys; b=json.load(open(sys.argv[1])); print(" ".join(str(t).strip().upper() for t in (b.get("macos") or {}).get("team_ids") or [] if str(t).strip()))' "$APPDIR/brand/brand.json" 2>/dev/null)"
  if [ -n "$pins" ]; then
    for p in $pins; do [ "$p" = "$team" ] && return; done
    echo "Developer ID team $team is not pinned in brand.json ($pins)"; return
  fi
  log "No pinned team id in brand.json; accepting Apple Developer ID $team"
}

if [ -f "$INSTALLER" ]; then
  problem="$(verify_installer "$INSTALLER")"
  if [ -n "$problem" ]; then
    log "REFUSED: $problem"
    rm -f "$INSTALLER" 2>/dev/null
    marker="$LOGDIR/update_attempt.json"
    if [ -f "$marker" ]; then
      /usr/bin/python3 - "$marker" "$problem" <<'PY' 2>/dev/null
import json, sys
p, why = sys.argv[1], sys.argv[2]
m = json.load(open(p)); m["last_error"] = "signature: " + why
json.dump(m, open(p, "w"))
PY
    fi
    exit 1   # EXIT trap relaunches the current version
  fi
  log "Signature OK."
fi

# 1. Give the launcher a moment to exit and release file locks.
sleep 2

# 2. Stop all running services so the installer can replace files.
STOP_CMD="$APPDIR/Stop Little Gerry.command"
if [ -f "$STOP_CMD" ]; then
  log "Stopping services via: $STOP_CMD"
  chmod +x "$STOP_CMD" 2>/dev/null
  /bin/bash "$STOP_CMD" >/dev/null 2>&1
else
  log "WARN: Stop command not found at $STOP_CMD"
fi

# Make sure the launcher process is gone so files can be overwritten.
pkill -f "launcher.py" 2>/dev/null
sleep 2

# 3. Install the update silently into the current user's home domain (no sudo).
#    The .pkg is signed/notarized (once an Apple Developer ID is configured), so
#    Gatekeeper accepts it without prompting.
if [ -f "$INSTALLER" ]; then
  log "Running installer (silent, CurrentUserHomeDirectory)..."
  if installer -pkg "$INSTALLER" -target CurrentUserHomeDirectory >> "$LOGFILE" 2>&1; then
    log "Installer completed (exit 0)."
    # Success: clear the failed-attempt marker so the launcher's retry guard
    # resets (see launcher.py UPDATE_MARKER_FILE).
    rm -f "$APPDIR/backend/logs/update_attempt.json" 2>/dev/null
  else
    code=$?
    log "Installer exit code: $code"
  fi
  rm -f "$INSTALLER" 2>/dev/null
else
  log "ERROR: Installer not found at $INSTALLER"
fi
# start_app runs from the EXIT trap.
