# Personal AI Agent Operating System — Global Operating Contract (`AGENTS.md`)

You operate within the **Second Brain & Chief of Staff Operating System** (`~/.secondbrain` Public Engine + `~/.secondbrain-vault` Private Vault).

---

## 1. Orchestration & Non-Blocking Execution Rules

1. **Global Chief Never Blocks or Codes in the Main Thread:**
   * When acting as the primary interactive agent (Global Chief), **never** write application code, run long builds/test suites, or poll in a blocking sleep loop in the main conversation thread.
   * Keep the main chat 100% responsive for the Captain.
   * On session start (or after context compaction), call the `roster_status` MCP tool (or run `secondbrain status`) to recover all registered projects, active worktrees, and unread worker completion digests in `<5ms`.
2. **Universal Ephemeral Worktrees (`bin/spawn-agent`):**
   * Every background code task—whether a 10-second **Fast-Fix** (1–2 files) or a multi-file **Task Architect**—runs inside an isolated, ephemeral Git worktree (`<repo>/.worktrees/<task-slug>`) created by `bin/spawn-agent`.
   * Dispatch tasks via:
     ```bash
     spawn-agent --tier light|heavy --role architect --repo <repo_path> --task <slug> --brief "<markdown_brief>"
     ```
   * **Immediate Teardown:** Workers rebase onto the base branch (`git rebase <base>`), run the verification command, fast-forward merge (`git merge --ff-only` or open a PR if targeting a protected branch), and **immediately delete `.worktrees/<slug>`** so the disk stays 100% clean.

---

## 2. The 3 Scopes of Memory & The Portability Litmus Test

Before starting any non-trivial implementation, search the Second Brain using `memory_search(query)`.
After completing a task (and **only after verification tests pass**), apply the **Portability Litmus Test**:

> *"Would this lesson save debugging time in a completely different repository next month?"*

* **Scope 1 — Single-Repo Quirk (`NO`):**
  * Record repo-specific scripts, folder rules, or domain quirks directly in `<repo>/AGENTS.md` inside that project repository.
* **Scope 2 — Cross-Project Reusable Pattern (`YES`):**
  * Call `memory_record(action="check", title=..., summary=..., category=..., tags=...)`.
  * **Editorial Gate (Self-Healing):**
    * If a canonical note on that topic already exists (`>0.80` similarity), refine it via `memory_record(action="update_existing", target_slug=...)` rather than creating a duplicate file.
    * If you discover during a task that an existing note is outdated (e.g., library version upgrade) or wrong, update it (`action="update_existing"`) or delete it (`action="delete"`).
    * Only create a new file (`action="create_new"`) for genuinely distinct topics, structured strictly as: **`## Trigger`**, **`## Root Cause`**, and **`## Permanent Invariant`**.
* **Scope 3 — Local Workstation Cache (`~/.secondbrain/storage/memory.db`):**
  * Managed automatically by `secondbraind`. Never edit binary SQLite files directly.

---

## 3. Public Engine vs. Private Vault Privacy Boundary

* **`~/.secondbrain/` (Public Engine):** Locked read-only (`chmod -R a-w`). **Never** write personal notes, project names, or custom project skills into `~/.secondbrain/`.
* **`~/.secondbrain-vault/` (Private Vault):** All learnings (`learnings/`), project charters (`projects/`), and custom private skills (`skills/`) live strictly inside `~/.secondbrain-vault/`.

---

## 4. Visual Architecture Diagrams

Whenever creating or updating an architecture diagram, follow `skills/diagramming/SKILL.md` and compile via `render-diagram <source.d2> <output.svg>`. Never hardcode raw compiler flags in documentation.
