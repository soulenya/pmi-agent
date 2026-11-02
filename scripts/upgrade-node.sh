#!/bin/bash
# Little Gerry - bring Node.js up to the supported floor (macOS).
#
# Called by launcher.py when the installed Node is older than the floor
# (NODE_MIN there), and by scripts/install.sh. Installs Homebrew's node@24 -
# the same line the hub image builds on - and links it, leaving a newer major
# alone. No sudo.
#
#   $1  minimum version (default 24.22.1)
MIN="${1:-24.22.1}"
LINE="${MIN%%.*}"

vernum() { printf '%s\n' "$1" | sed -E 's/^v//' | awk -F. '{ printf "%d%03d%03d\n", $1, $2, $3 }'; }

have="$(node --version 2>/dev/null | head -1)"
if [ -n "$have" ]; then
  if [ "$(vernum "$have")" -ge "$(vernum "$MIN")" ]; then echo "Node $have is current (floor $MIN)."; exit 0; fi
  have_major="${have#v}"; have_major="${have_major%%.*}"
  if [ "$have_major" -gt "$LINE" ]; then echo "Node $have is a newer line than $MIN; leaving it."; exit 0; fi
fi

if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv)"; fi
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is not installed; install Node $MIN or newer from https://nodejs.org/"; exit 2
fi

echo "Installing Node.js ${LINE}.x via Homebrew (have: ${have:-none})..."
brew install "node@${LINE}" >/dev/null 2>&1 || brew upgrade "node@${LINE}" >/dev/null 2>&1
# Versioned formulae are keg-only; make this one the `node` on PATH.
for old in $(brew list --formula 2>/dev/null | grep -E '^node(@[0-9]+)?$' | grep -v "^node@${LINE}$"); do
  brew unlink "$old" >/dev/null 2>&1
done
brew link --overwrite --force "node@${LINE}" >/dev/null 2>&1

now="$("$(brew --prefix)/bin/node" --version 2>/dev/null | head -1)"
if [ -n "$now" ] && [ "$(vernum "$now")" -ge "$(vernum "$MIN")" ]; then echo "Node $now installed."; exit 0; fi
echo "Node upgrade did not complete (node is '${now:-missing}'). Install $MIN or newer from https://nodejs.org/"
exit 1
