# Delegation & Worktree Lifecycle Contract (`invariants/delegation.md`)

---

## 1. The 4-Line Plain Markdown Task Brief
We never use bloated JSON task schemas. Every task dispatched by Global Chief or a Project Chief uses a clean 4-line Markdown header:

```markdown
# Task: <Concise Title>
- **Repo / Base:** `<repo_path>` (`<base_branch>`)
- **Scope / Target Files:** `<files or module>`
- **Verify-Cmd:** `<exact test/lint command that must exit 0>`

## Mission & Acceptance Criteria
<Clear, bounded description of what to build/fix and any retrieved Second Brain invariants>
```

---

## 2. Ephemeral Worktree Lifecycle
1. **Creation (`bin/spawn-agent`):**
   * `spawn-agent` creates `<repo>/.worktrees/<task-slug>` on branch `task/<task-slug>` before the worker wakes up.
   * Unchanged dependency directories (`node_modules`, `.venv`) are symlinked or copy-on-write cloned (`cp -c` on APFS) so startup takes `<100ms` and `0 MB` extra disk space.
2. **Execution:**
   * The worker edits code, runs `Verify-Cmd`, and commits inside `.worktrees/<task-slug>`.
   * Workers never create nested worktrees inside worktrees.
3. **Pre-Exit Rebase & Teardown:**
   * Worker runs `git rebase <base_branch>` and re-runs `Verify-Cmd`.
   * On green exit, the branch is fast-forward merged (`git merge --ff-only task/<task-slug>`) or pushed as a PR (if targeting a protected branch), and the worktree is **immediately removed**:
     ```bash
     git worktree remove --force .worktrees/<task-slug> && git branch -d task/<task-slug>
     ```
4. **Push-on-Exit Notification (Zero Polling):**
   * Workers notify their parent on exit via `secondbrain report --task <slug> --status ok|blocked --summary "..."` (which uses `bb thread tell` inside BB or pushes to `~/.secondbrain/daemon.sock` in CLI mode).
