#!/usr/bin/env bash
# serve.sh — start a local web server for Glide (macOS / Linux / WSL).
#
# Glide uses ES modules, which browsers block over file:// . This serves the
# folder over http:// so every button works. Run from this folder:
#
#     bash serve.sh          # http://localhost:8080/
#     bash serve.sh 3000     # a different port
#
# Then open the printed URL in Chrome.
set -e
cd "$(dirname "$0")"
PORT="${1:-8080}"

echo ""
echo "  Starting Glide on http://localhost:$PORT/"
echo "  Landing page: http://localhost:$PORT/"
echo "  The app:      http://localhost:$PORT/app.html"
echo "  (Ctrl+C to stop)"
echo ""

if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then exec python -m http.server "$PORT"
elif command -v node >/dev/null 2>&1; then exec node serve.js "$PORT"
else
  echo "  Could not find Python or Node. Install either to serve the site." >&2
  exit 1
fi
