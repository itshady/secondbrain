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

## 2. The 3 Scopes of Memory & Skills (The Portability Litmus Test)

Before starting any non-trivial implementation, search the Second Brain using `memory_search(query)`.
After completing a task (and **only after verification tests pass**), or whenever creating/updating a **Skill**, apply the **Portability Litmus Test** automatically (never ask the Captain where to place a note or skill):

> *"Would this lesson or skill be used in a completely different, unrelated repository next month?"*

* **Scope 1 — Single-Repo Quirk or Project-Specific Skill (`NO`):**
  * **Repo Rules:** Record repo-specific scripts, folder rules, or domain quirks directly in `<repo>/AGENTS.md` (and `<repo>/.bb/AGENTS.md` if used) inside that project repository.
  * **Project-Specific Skills:** Domain, API, or platform skills only relevant to one repository **MUST** live inside `<repo>/.bb/skills/<name>/SKILL.md` (never in `~/.secondbrain-vault/skills/`, which would pollute global threads across all projects).
* **Scope 2 — Cross-Project Personal Pattern or Skill (`YES`):**
  * **Cross-Project Learnings (`~/.secondbrain-vault/learnings/`):**
    * Call `memory_record(action="check", title=..., summary=..., category=..., tags=...)`.
    * **Editorial Gate (Self-Healing):**
      * If a canonical note on that topic already exists (`>0.80` similarity), refine it via `memory_record(action="update_existing", target_slug=...)` rather than creating a duplicate file.
      * If you discover during a task that an existing note is outdated (e.g., library version upgrade) or wrong, update it (`action="update_existing"`) or delete it (`action="delete"`).
      * Only create a new file (`action="create_new"`) for genuinely distinct topics, structured strictly as: **`## Trigger`**, **`## Root Cause`**, and **`## Permanent Invariant`**.
  * **Cross-Project Personal Skills (`~/.secondbrain-vault/skills/<name>/SKILL.md`):**
    * Reusable personal workflow skills that apply across multiple unrelated repositories live in `~/.secondbrain-vault/skills/<name>/SKILL.md` (symlinked globally by `setup.sh`) and are rerun via `setup.sh`.
* **Scope 3 — Universal Engine Core & Local Workstation Cache (`~/.secondbrain/`):**
  * **Universal Engine Core Skills (`~/.secondbrain/skills/`):** Only the universal OS roles (`chief`, `project-chief`, `architect`, `janitor`, `diagramming`) live in `~/.secondbrain/skills/`.
  * **Local Vector & Roster Cache (`~/.secondbrain/storage/memory.db`):** Managed automatically by `secondbraind`. Never edit binary SQLite files directly.

---

## 3. Public Engine vs. Private Vault vs. Repo Boundary

* **`~/.secondbrain/` (Public Engine):** Locked read-only (`chmod -R a-w`). Contains only universal OS roles and infrastructure. **Never** write personal notes, project names, or project/personal skills into `~/.secondbrain/`.
  * **Automated 2-Stage Public Release Judge (`secondbrain publish`):** When upgrading `~/.secondbrain`, agents **should** push verified changes to `origin/main` autonomously without waiting for the Captain—provided they read `.bb/skills/publish-judge/SKILL.md`, audit `git diff origin/main..HEAD` against the 5-point Public Release Rubric, record the SHA-bound judge stamp (`secondbrain judge-approve --note "..."`), and run `secondbrain publish` (enforced by `.git/hooks/pre-push`).
* **`~/.secondbrain-vault/` (Private Vault):** All cross-project learnings (`learnings/`), project charters (`projects/`), and cross-project personal skills (`skills/`) live inside `~/.secondbrain-vault/`. Never place single-repo skills here.
* **`<repo>/.bb/skills/` & `<repo>/AGENTS.md` (Project Workspace):** All single-repo instructions and project-specific skills live strictly inside the target repository.

---

## 4. Visual Architecture Diagrams & Zero-Exposure Secret Collection

* **Diagrams:** Whenever creating or updating an architecture diagram, follow `skills/diagramming/SKILL.md` and compile via `render-diagram <source.d2> <output.svg>`. Never hardcode raw compiler flags in documentation.
* **Native BB Secret Collection (`bb secret request`):** When running inside `bb` and a user credential or API key is required for a `.env` file, **always** invoke the `secrets` skill (`bb secret request <VAR_NAME> --purpose "..." --describe <VAR_NAME> "..." --write-env <path/.env>`) to pop up a secure masked UI form that writes `.env` directly. **Never** instruct the Captain to manually `cp .env.example .env` and paste secrets into a terminal or chat.
