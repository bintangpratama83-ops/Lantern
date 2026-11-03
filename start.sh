#!/usr/bin/env sh
# Lantern launcher (Linux, macOS, Android/Termux). No npm install needed.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. On Termux run: pkg install nodejs-lts"
  exit 1
fi
exec node server/server.js "$@"
