#!/usr/bin/env bash
# Auto-bump package.json version on every build.
# Uses git commit count for the patch number — always increasing, never manual.
# Format: 1.1.<commit-count>  (e.g., 1.1.847)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$REPO_DIR/package.json"

# Count total commits on current branch
COMMIT_COUNT=$(cd "$REPO_DIR" && git rev-list --count HEAD 2>/dev/null || echo "0")

# Major.Minor is manually controlled, patch is auto from commit count
MAJOR=1
MINOR=1
NEW_VERSION="${MAJOR}.${MINOR}.${COMMIT_COUNT}"

# Read current version
CURRENT=$(python3 -c "import json; print(json.load(open('$PKG')).get('version','0.0.0'))" 2>/dev/null || echo "0.0.0")

if [ "$CURRENT" != "$NEW_VERSION" ]; then
  # Update package.json in-place
  python3 -c "
import json
with open('$PKG', 'r') as f:
    d = json.load(f)
d['version'] = '$NEW_VERSION'
with open('$PKG', 'w') as f:
    json.dump(d, f, indent=2)
    f.write('\n')
"
  echo "[bump-version] $CURRENT → $NEW_VERSION (commit #$COMMIT_COUNT)"
else
  echo "[bump-version] Already at $NEW_VERSION"
fi
