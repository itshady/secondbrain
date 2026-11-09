#!/usr/bin/env bash
# Second Brain & BB Native Worktree Teardown Hook (`.bb-env-teardown.sh`)
# Unlinks symlinked dependency directories before BB removes the worktree so
# the primary checkout's dependencies are never modified or traversed during cleanup.
set -euo pipefail

WORKTREE_ROOT="$(pwd -P)"
for dep_dir in node_modules .venv; do
  if [[ -L "$WORKTREE_ROOT/$dep_dir" ]]; then
    rm -f "$WORKTREE_ROOT/$dep_dir"
  fi
done
