# Commit, Diff & PR Standards (`invariants/pr-standards.md`)

---

## 1. Git Diff as Single Source of Truth
* We do not run bureaucratic "Reviewer peer subagent committees" on every task.
* The combination of a green `Verify-Cmd` (`exit 0`) and a clean `git diff <base_branch>...HEAD` is the single source of truth.

## 2. Commit Hygiene
* Write atomic commits with clear prefixes (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
* Never commit `.worktrees/`, `.venv/`, `.cache/`, `.DS_Store`, or secrets/credentials.
* Never pass `--no-verify` to bypass Git hooks.

## 3. Local Fast-Forward vs. Protected Branch PRs
* **Local Integration Branch:** Fast-forward merge cleanly (`git merge --ff-only task/<slug>`) after rebasing and passing tests, then immediately delete the worktree and task branch.
* **Protected Remote Branch:** Push `task/<slug>` to origin, open a PR via `gh pr create --fill`, and remove the local worktree once pushed.
