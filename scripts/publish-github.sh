#!/usr/bin/env bash
# Publish this project using the locally authenticated GitHub CLI account.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

command -v gh >/dev/null || { echo 'GitHub CLI (gh) is required.' >&2; exit 1; }
command -v git >/dev/null || { echo 'Git is required.' >&2; exit 1; }

if ! gh auth status; then
  echo 'Run gh auth login --hostname github.com, then run this script again.' >&2
  exit 1
fi
GITHUB_LOGIN="$(gh api user --jq .login)"
GITHUB_USER_ID="$(gh api user --jq .id)"
REPOSITORY="$GITHUB_LOGIN/Sayrel"

if git rev-parse --show-toplevel >/dev/null 2>&1; then
  EXISTING_ROOT="$(git rev-parse --show-toplevel)"
  if [ "$EXISTING_ROOT" != "$PROJECT_ROOT" ]; then
    echo 'The project is inside another Git repository; stopping.' >&2
    exit 1
  fi
  if git remote get-url origin >/dev/null 2>&1; then
    echo 'An origin remote already exists; stopping without changing it.' >&2
    exit 1
  fi
else
  git init -b main
fi

git add --all
if ! git diff --cached --quiet; then
  COMMIT_NAME="$(git config user.name || true)"
  COMMIT_EMAIL="$(git config user.email || true)"
  COMMIT_NAME="${COMMIT_NAME:-$GITHUB_LOGIN}"
  COMMIT_EMAIL="${COMMIT_EMAIL:-$GITHUB_USER_ID+$GITHUB_LOGIN@users.noreply.github.com}"
  git -c user.name="$COMMIT_NAME" -c user.email="$COMMIT_EMAIL" \
    commit -m 'Initial commit: Sayrel desktop application'
fi

gh auth setup-git --hostname github.com
gh repo create "$REPOSITORY" --private --source "$PROJECT_ROOT" \
  --remote origin --push --description 'Sayrel desktop voice dictation application'

VISIBILITY="$(gh repo view "$REPOSITORY" --json visibility --jq .visibility)"
if [ "$VISIBILITY" != 'PRIVATE' ]; then
  echo 'Repository visibility verification failed.' >&2
  exit 1
fi
git fetch origin
test "$(git rev-parse HEAD)" = "$(git rev-parse '@{upstream}')"
gh repo view "$REPOSITORY" --json url,visibility --jq '"\(.url) (\(.visibility))"'
