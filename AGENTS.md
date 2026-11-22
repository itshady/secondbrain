# Personal AI Agent Operating System — Global Operating Contract (`AGENTS.md`)

You operate within the **Second Brain & Chief of Staff Operating System** (`~/.secondbrain` Public Engine + `~/.secondbrain-vault` Private Vault).

---

## 1. Orchestration & Non-Blocking Execution Rules

1. **Global Chief & Project Chiefs Never Block or Code in the Main Thread:**
   * When acting as the primary interactive agent (Global Chief), **never** write application code, run long builds/test suites, or poll in a blocking sleep loop in the main conversation thread.
   * **Project Chiefs Never Code Inline:** Project Chiefs NEVER write application code or run builds/edits inline—every code change (even small fixes) MUST be delegated to an ephemeral Task Architect via `spawn-agent`.
   * Keep the main chat 100% responsive for the Captain.
   * On session start (or after context compaction), call the `roster_status` MCP tool (or run `secondbrain status`) to recover all registered projects, active worktrees, and unread worker completion digests in `<5ms`.
2. **Universal Ephemeral Worktrees (`bin/spawn-agent`):**
   * Every background code task—whether a 10-second **Fast-Fix** (1–2 files) or a multi-file **Task Architect**—runs inside an isolated, ephemeral Git worktree (`<repo>/.worktrees/<task-slug>`) created by `bin/spawn-agent`.
   * Dispatch tasks via:
     ```bash
     spawn-agent --tier light|heavy --role architect --repo <repo_path> --task <slug> --brief "<markdown_brief>"
     ```
   * **Immediate Teardown & Auto-Archive:** Workers rebase onto the base branch (`git rebase <base>`), run the verification command, fast-forward merge (`git merge --ff-only` or open a PR if targeting a protected branch), **immediately delete `.worktrees/<slug>`**, and archive the worker thread (`bb thread archive <thread_id>`) so both the disk and the sidebar stay 100% clean.

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
  * **Universal Engine Core Skills (`~/.secondbrain/skills/`):** Only the universal OS roles (`chief`, `project-chief`, `architect`, `reaper`, `janitor`, `diagramming`) live in `~/.secondbrain/skills/`.
  * **Local Vector & Roster Cache (`~/.secondbrain/storage/memory.db`):** Managed automatically by `secondbraind`. Never edit binary SQLite files directly.

---

## 3. Public Engine vs. Private Vault vs. Repo Boundary

* **`~/.secondbrain/` (Public Engine):** Locked read-only (`chmod -R a-w`). Contains only universal OS roles and infrastructure. **Never** write personal notes, project names, or project/personal skills into `~/.secondbrain/`.
  * **Automated 2-Stage Public Release Judge (`secondbrain publish`):** When upgrading `~/.secondbrain`, agents **should** push verified changes to `origin/main` autonomously without waiting for the Captain—provided they read `.bb/skills/publish-judge/SKILL.md`, audit `git diff origin/main..HEAD` against the 5-point Public Release Rubric, record the SHA-bound judge stamp (`secondbrain judge-approve --note "..."`), and run `secondbrain publish` (enforced by `.git/hooks/pre-push`).
* **`~/.secondbrain-vault/` (Private Vault):** All cross-project learnings (`learnings/`), project charters (`projects/`), and cross-project personal skills (`skills/`) live inside `~/.secondbrain-vault/`. Never place single-repo skills here.
* **`<repo>/.bb/skills/` & `<repo>/AGENTS.md` (Project Workspace):** All single-repo instructions and project-specific skills live strictly inside the target repository.

---

## 4. Visual Architecture Diagrams, Zero-Exposure Secrets Hub & Symlinking

* **Diagrams:** Whenever creating or updating an architecture diagram, follow `skills/diagramming/SKILL.md` and compile via `render-diagram <source.d2> <output.svg>`. Never hardcode raw compiler flags in documentation.
* **The Central `~/.secrets/` Hub:**
  * All credentials live in `~/.secrets/` (mode `700`, never committed):
    * `~/.secrets/global.env`: Shared keys (e.g., `GEMINI_API_KEY`, `OPENAI_API_KEY`).
    * `~/.secrets/<project_slug>.env`: Project-specific keys (e.g., `ALPACA_API_KEY`, `PROVIDER_API_KEY`).
  * **Native BB Secret Collection (`bb secret request`):** When running inside `bb` and a credential is required, **always** invoke the `secrets` skill with `--write-env`:
    * Shared keys: `bb secret request <VAR> --purpose "..." --describe <VAR> "..." --write-env ~/.secrets/global.env`
    * Project-specific keys: `bb secret request <VAR> --purpose "..." --describe <VAR> "..." --write-env ~/.secrets/<slug>.env`
    * After requesting, run `secondbrain secrets-sync <repo>` to merge keys into `<repo>/.env` (mode `600`).
  * **Zero-Bloat Worktree Symlinking:** Background worktrees (`.worktrees/<slug>`) automatically symlink `<repo>/.env` alongside `node_modules` and `.venv`, so task workers have immediate credentials without manual copying.
  * **Strict Invariant:** **Never** instruct the Captain to manually `cp .env.example .env` or paste secrets into a terminal or chat.

---

## 5. Coding & Implementation Invariants (Simplicity-First)

Behavioral rules to prevent over-engineering, defensive bloat, and context pollution.

### 1. Simplicity Over Cleverness
* **Minimum code that solves the problem:** No features, configuration, or abstractions beyond what was asked.
* **No defensive coding:** Do not write error handling, null-checks, or fallbacks for impossible scenarios or niche 0.1% edge cases. Let code be clean and direct.
* **No single-use abstractions:** If a function or class is only used in one place, inline it. If you wrote 200 lines and it could be 40 lines, rewrite it.

### 2. Surgical, Scope-Bounded Changes
* **Touch only what you must:** Never reformat, "clean up", or refactor adjacent or unbroken code.
* **Match existing style:** Follow the existing patterns in the file, even if you would personally write it differently.
* **Clean up only your own orphans:** Remove imports or variables made unused by your changes. Do not delete pre-existing dead code unless explicitly requested.
* **Traceability:** Every changed line in the diff must trace directly to the Captain's prompt.

### 3. Think & Align Before Coding
* **Surface assumptions:** If there are multiple reasonable interpretations, state them briefly and ask—do not choose silently.
* **Push back on complexity:** If the Captain asks for an approach and you know a much simpler 5-line way to do it, speak up.
* **Stop on confusion:** If an instruction or codebase boundary is ambiguous, stop and ask rather than guessing and generating messy diffs.

### 4. Pragmatic Verification (99.9% No Test Bloat)
* **No test ceremony:** Do NOT write unit tests, mocks, or test suites unless explicitly requested or when guarding a mission-critical project invariant locked in `<repo>/INVARIANTS.md` (via the `list invariants` workflow).
* **Real terminal verification over unit tests:** Verify code by running the actual command, script, CLI tool, or inspect the real output state. Discard scratch scripts before committing; if it works end-to-end, it's done.
