#!/bin/sh
set -eu
cd "$(dirname "$0")"
PYTHON="${FLY_PYTHON:-$HOME/jevlike/.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  PYTHON="$PWD/.venv/bin/python"
fi
if [ ! -x "$PYTHON" ]; then
  echo "Install Python dependencies first (see README.md)."
  exit 1
fi
if [ ! -f dist/index.html ]; then
  npm install
  npm run build
fi
printf 'Fly Observatory: http://127.0.0.1:8932\nThe real connectome loads and calibrates before it moves.\n'
exec "$PYTHON" server.py
