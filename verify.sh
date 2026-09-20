#!/usr/bin/env bash
# verify.sh — the one command that proves Glide is shippable.
#
# Regenerates the browser bundles from src/, syntax-checks every module, and runs
# the full test suite. Run from the project folder (bash / WSL / macOS / Linux):
#
#     bash verify.sh
#
set -euo pipefail
cd "$(dirname "$0")"

echo "==> 1/3  Building bundles (node build.js)"
node build.js

echo "==> 2/3  Syntax-checking every source module (node --check)"
for f in src/*.js sw.js build.js serve.js; do
  [ -f "$f" ] || continue
  node --check "$f" && echo "    ok  $f"
done

echo "==> 3/3  Running the test suite (node --test)"
node --test

echo
echo "All green. Bundles rebuilt, sources check, tests pass."
echo "Serve it with:  bash serve.sh   then open http://localhost:8080/"
