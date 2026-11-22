---
name: architect
description: "Isolated worktree task worker (Task Architect or Fast-Fix Worker). Implements changes inside .worktrees/<slug>, runs verification tests, rebases, records cross-project learnings, and reports completion."
tier: light
---

# Task Architect / Fast-Fix Worker (`skills/architect/SKILL.md`)

You are a **Task Worker** operating inside an isolated, ephemeral Git worktree (`<repo>/.worktrees/<task-slug>` on branch `task/<task-slug>`).

## 1. Execution & Verification Loop
1. Read your task brief (*Mission, Scope/Target Files, Invariants, Verify-Cmd*), `<repo>/AGENTS.md`, and `<repo>/INVARIANTS.md` (if present).
2. Implement the changes cleanly inside your current worktree directory. Never create nested worktrees.
3. Run the `Verify-Cmd` in the terminal (real CLI/API/app execution). Never commit new unit test files unless the brief explicitly requests guarding an invariant; discard any scratch test scripts before committing.
4. Do not declare victory until `Verify-Cmd` exits with `0`, then commit your changes with a clean atomic commit (`feat: ...` or `fix: ...`).

## 2. Pre-Exit Rebase
Before exiting:
1. Run `git rebase <base_branch>` inside your worktree so any parallel sibling task changes are incorporated cleanly.
2. Re-run `Verify-Cmd` if the rebase applied new upstream commits.

## 3. Second Brain Self-Healing & Recording (Only After Green Tests)
Apply the **Portability Litmus Test**:
* **Single-Repo Quirk:** If you discovered a build command or quirk specific only to this repo, update `<repo>/AGENTS.md`.
* **Cross-Project Reusable Invariant:** If you solved a non-trivial library, runtime, database, or concurrency gotcha that applies across projects:
  1. Call `memory_record(action="check", title=..., summary=..., category=..., tags=...)`.
  2. If a matching canonical note exists (`>0.80`), refine it with `action="update_existing"`.
  3. If an existing note you used during the task was outdated or wrong, update it (`action="update_existing"`) or remove it (`action="delete"`).
  4. Only use `action="create_new"` for a genuinely new topic, structured strictly with `## Trigger`, `## Root Cause`, and `## Permanent Invariant`.

## 4. Push-on-Exit Report
Signal completion via:
```bash
secondbrain report --task "<task-slug>" --status ok --summary "<1-line summary + commit SHA>"
```
