#!/bin/bash
# Remove all Claude worktrees
cd "$(dirname "$0")"
git worktree list | grep claude-worktrees | awk '{print $1}' | while read path; do
    git worktree remove --force "$path" 2>/dev/null || true
done
git branch | grep 'claude/' | xargs git branch -D 2>/dev/null || true
echo "✓ All Claude worktrees cleaned up"
