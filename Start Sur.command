#!/bin/bash
# Sur — riyaz for your voice.
# Double-click this file. It starts the local server and opens Sur.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Sur needs Node.js 22.5 or newer — https://nodejs.org"
  echo "Press any key to close."; read -n 1; exit 1
fi

MAJOR=$(node -p "process.versions.node.split('.')[0]")
MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$MAJOR" -lt 22 ] || { [ "$MAJOR" -eq 22 ] && [ "$MINOR" -lt 5 ]; }; then
  echo "Sur needs Node 22.5+ for its built-in database. You have $(node -v)."
  echo "Press any key to close."; read -n 1; exit 1
fi

exec node server.mjs --open
