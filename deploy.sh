#!/usr/bin/env bash
# deploy.sh — build, test, commit and push Glide so GitHub Pages can serve it.
#
# What it does (all safe / non-destructive):
#   1. Rebuilds the bundles and runs the tests as a gate (won't ship red).
#   2. Initializes a git repo here if there isn't one.
#   3. Stages and commits the project.
#   4. Pushes to your 'origin' remote if one is set (else prints how to add it).
#
# It NEVER force-pushes, resets, or rewrites history, and it does not change your
# global git config.
#
# Usage:
#     bash deploy.sh                 # commit + push current branch
#     bash deploy.sh -m "message"    # custom commit message
#     bash deploy.sh --no-push       # commit only, don't push
#
# Author identity: uses your existing git config. If none is set, it commits as
# "Pal Ghevariya" for this one commit only (override with GIT_AUTHOR_NAME /
# GIT_AUTHOR_EMAIL environment variables).

set -euo pipefail
cd "$(dirname "$0")"

MSG="Deploy Glide: hands-free webcam control (assistive tech)"
PUSH=1
while [ $# -gt 0 ]; do
  case "$1" in
    -m|--message) MSG="$2"; shift 2 ;;
    --no-push)    PUSH=0; shift ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done

command -v node >/dev/null 2>&1 || { echo "Node.js not found on PATH."; exit 1; }
command -v git  >/dev/null 2>&1 || { echo "git not found on PATH.";     exit 1; }

echo "==> Verifying (build + tests) before deploy"
node build.js
node --test

if [ ! -d .git ]; then
  echo "==> Initializing git repo"
  git init -q
  git branch -M main
fi

# Resolve a commit author without touching stored config.
AUTHOR_ARGS=()
if ! git config user.name >/dev/null 2>&1 && [ -z "${GIT_AUTHOR_NAME:-}" ]; then
  NAME="${GIT_AUTHOR_NAME:-Pal Ghevariya}"
  EMAIL="${GIT_AUTHOR_EMAIL:-pal.ghevariya@users.noreply.github.com}"
  echo "==> No git identity configured; committing as \"$NAME\" <$EMAIL>"
  echo "    (set your own with: git config user.name / user.email, or GIT_AUTHOR_* env vars)"
  AUTHOR_ARGS=(--author="$NAME <$EMAIL>")
  # -c keeps this local to the commit, not persisted to config
  GIT_COMMITTER_NAME="$NAME" GIT_COMMITTER_EMAIL="$EMAIL" export GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL
fi

echo "==> Staging + committing"
git add -A
if git diff --cached --quiet; then
  echo "    Nothing to commit — working tree matches the last commit."
else
  git commit -q "${AUTHOR_ARGS[@]}" -m "$MSG"
  echo "    Committed: $MSG"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ "$PUSH" -eq 0 ]; then
  echo "==> --no-push set; done. Current branch: $BRANCH"
  exit 0
fi

if git remote get-url origin >/dev/null 2>&1; then
  echo "==> Pushing '$BRANCH' to origin"
  git push -u origin "$BRANCH"
  echo
  echo "Pushed. Final step (one time): on GitHub, open"
  echo "  Settings -> Pages -> Build and deployment -> Source: \"GitHub Actions\""
  echo "The included workflow (.github/workflows/pages.yml) will build + deploy on each push."
else
  cat <<'EOF'

No 'origin' remote is set yet. Create an empty repo on GitHub, then:

    git remote add origin https://github.com/<you>/<repo>.git
    git push -u origin main

Then on GitHub: Settings -> Pages -> Source: "GitHub Actions".
The workflow at .github/workflows/pages.yml handles build + deploy from there.
EOF
fi
