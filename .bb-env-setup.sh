#!/usr/bin/env bash
# Second Brain & BB Native Worktree Setup Hook (`.bb-env-setup.sh`)
# Automatically symlinks large dependency directories (`node_modules`, `.venv`)
# from the primary repository checkout into fresh BB managed worktrees (0 MB bloat).
set -euo pipefail

WORKTREE_ROOT="$(pwd -P)"
COMMON_GIT_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"

if [[ -n "$COMMON_GIT_DIR" && "$(basename "$COMMON_GIT_DIR")" == ".git" ]]; then
  MAIN_REPO_ROOT="$(dirname "$COMMON_GIT_DIR")"
  if [[ "$MAIN_REPO_ROOT" != "$WORKTREE_ROOT" ]]; then
    for dep_dir in node_modules .venv; do
      if [[ -d "$MAIN_REPO_ROOT/$dep_dir" && ! -e "$WORKTREE_ROOT/$dep_dir" ]]; then
        ln -s "$MAIN_REPO_ROOT/$dep_dir" "$WORKTREE_ROOT/$dep_dir"
      fi
    done
  fi
fi
