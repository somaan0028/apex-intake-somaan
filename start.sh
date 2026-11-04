#!/usr/bin/env bash
# One-command setup and production start for a clean clone.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node 20 or newer, then try again." >&2
  exit 1
fi

echo "Installing dependencies..."
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo "Preparing the environment and database..."
npm run setup

echo "Building the app..."
npm run build

echo "Starting on http://localhost:8080"
exec npm start
