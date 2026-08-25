#!/usr/bin/env bash
# Sync master from upstream, then rebase the patch branch on top and verify
# the build. Mirrors .github/workflows/sync-upstream.yml but runs locally.
#
# Usage:
#   ./scripts/sync-upstream.sh
#
# Env overrides:
#   UPSTREAM_URL   default: https://github.com/rudra496/StealthHumanizer.git
#   PATCH_BRANCH   default: my-patches
#   BASE_BRANCH    default: master

set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/rudra496/StealthHumanizer.git}"
PATCH_BRANCH="${PATCH_BRANCH:-my-patches}"
BASE_BRANCH="${BASE_BRANCH:-master}"

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "Adding upstream remote: $UPSTREAM_URL"
  git remote add upstream "$UPSTREAM_URL"
fi

echo "==> Fetching upstream + origin"
git fetch upstream
git fetch origin

echo "==> Fast-forwarding $BASE_BRANCH from upstream/$BASE_BRANCH"
git checkout "$BASE_BRANCH"
git merge --ff-only "upstream/$BASE_BRANCH"
git push origin "$BASE_BRANCH"

echo "==> Checking $PATCH_BRANCH"
git checkout "$PATCH_BRANCH"

if git merge-base --is-ancestor "$BASE_BRANCH" "$PATCH_BRANCH"; then
  echo "$PATCH_BRANCH is already up to date with $BASE_BRANCH. Nothing to do."
  exit 0
fi

echo "==> Rebasing $PATCH_BRANCH onto $BASE_BRANCH"
if ! git rebase "$BASE_BRANCH"; then
  cat <<'EOF'

!! Rebase conflict.

Resolve it manually:
  1. Fix the conflicting file(s) shown above (git status)
  2. git add <file>
  3. git rebase --continue
  (repeat until the rebase finishes)

Or abort with: git rebase --abort

See CHANGES.md for what each patch commit does — that tells you which
side of the conflict is "your" intentional change vs. upstream's.
EOF
  exit 1
fi

echo "==> Rebase clean. Verifying build..."
npm install --no-audit --no-fund
npx tsc --noEmit -p tsconfig.json
npm run build

echo "==> Build clean. Pushing $PATCH_BRANCH"
git push --force-with-lease origin "$PATCH_BRANCH"

echo "==> Done. $PATCH_BRANCH is now rebased on latest upstream and pushed."
