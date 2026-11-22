# Personal AI Agent Operating System & Second Brain
**Architecture & System Design Document**

---

## 1. Vision & Core Objectives

1. **Chief of Staff Orchestration:** A single high-level coordinator ("Chief") manages execution across multiple projects, preserving context windows by delegating implementation details to isolated task workers.
2. **Transferability & Harness Independence:** The entire operating system (rules, skills, memory, and orchestration) is **100% harness-agnostic**. Switching between **BB**, **Codex**, **Pi**, **Claude Code**, or **Antigravity** requires zero rewriting of business logic.
3. **Cross-Project Second Brain:** Lessons, architectural patterns, and solutions learned in Project A are automatically discoverable and reusable by Project C via local semantic search (embeddings) with zero human maintenance chores.
4. **Design by Invariants:** Permanent operating principles, coding standards, and verification contracts are upheld by every agent across all projects.

---

## 2. Orchestration Hierarchy (The "Chief of Staff" Pattern)

Inspired by Tobi Lütke's executive agent model at Shopify and the workflow principles of `bb-plugin-chief-nav`, execution follows a strict separation of concerns where **Chief never blocks the main chat**:

```text
                             [Captain] (You, the Human)
                                         │
                                         ▼
                            [Chief] (Global Coordinator)
                            (Lives in ~/.secondbrain — NEVER codes or blocks)
                                         │
            ┌────────────────────────────┼────────────────────────────┐
            │ (Quick 1-2 file fix)       │ (Project Initiative)       │ (Project Initiative)
            ▼                            ▼                            ▼
   [Fast-Fix Worker]          [Project Chief: Repo A]      [Project Chief: Repo B]
   (Ephemeral Worktree)       (Lives in Repo A main)       (Lives in Repo B main)
   (Tier: light)                         │                            │
                                   ┌─────┴─────┐                ┌─────┴─────┐
                                   ▼           ▼                ▼           ▼
                              [Architect] [Architect]      [Architect] [Architect]
                              (Worktree)  (Worktree)       (Worktree)  (Worktree)
```

### Roles & Boundaries
* **Captain (Human):** Talks to Chief. Sets goals, makes high-level tradeoff decisions, and approves PRs on protected branches.
* **Chief (Global Coordinator):**
  * **Does:** Triages requests, dispatches Fast-Fix workers for small edits, routes multi-task initiatives to Project Chiefs, monitors cross-project status via `roster_status()`, and synthesizes concise digests.
  * **Never:** Writes application code, runs builds/tests in the main thread, or polls in a blocking loop.
* **Project Chief (Repo-Level Orchestrator):**
  * Stood up with a persistent charter (`~/.secondbrain/projects/<slug>.md`) and operates in the main checkout of one repository (`~/code/<repo>`).
  * Queries the Second Brain (`memory_search`) before planning tasks.
  * Breaks initiatives into bounded tasks, dispatches Task Architects via `bin/spawn-agent`, verifies diffs, merges completed worktree branches, and tears down finished worktrees.
* **Task Worker (`Fast-Fix Worker` or `Task Architect`):**
  * Operates inside a dedicated, ephemeral Git worktree (`<repo>/.worktrees/<task-slug>`).
  * Writes code, runs the verification test command, commits cleanly, and exits.

### Universal Ephemeral Worktrees (Zero WIP Collisions, Zero SSD Bloat)
Instead of mixing "in-place" edits with worktrees (which risks clobbering uncommitted WIP or hitting `.git/index.lock` races), **every background task worker gets its own ephemeral worktree**:

1. **Where Worktrees Are Created (Only at the Task Worker Level):**
   * **Global Chief & Project Chiefs** never create worktrees for themselves.
   * **Every Task Worker (whether a 10-second Fast-Fix or a larger Task Architect)** gets exactly **1 worktree** (`<repo>/.worktrees/<task-slug>` on branch `task/<task-slug>`). Workers never create nested worktrees inside worktrees.
2. **Who Spins It Up (`bin/spawn-agent`):**
   * Agents do not manually run `git worktree add`. When Chief or Project Chief invokes `bin/spawn-agent --repo <path> --task <slug> ...`, the script automatically:
     1. Runs `git worktree add .worktrees/<slug> -b task/<slug>` (`~50ms`, `0 MB` extra Git object storage).
     2. Symlinks unchanged dependency folders (`node_modules`, `.venv`) from the main checkout—or uses macOS APFS copy-on-write (`cp -c`)—so workers start instantly with **zero dependency install delay** and **zero hard-drive bloat**.
     3. Boots the worker agent directly inside `.worktrees/<slug>`.
3. **Who Merges & Tears It Down (Immediate Cleanup + Crash Safety Net):**
   * **Step 1 — Pre-Exit Rebase:** Before finishing, the worker runs `git rebase <base_branch>` and re-runs tests inside its worktree so parallel task drift is resolved automatically.
   * **Step 2 — Immediate Merge & Teardown (99% of cases):** On green exit, the `spawn-agent` exit hook (for Fast-Fix) or Project Chief (for multi-task features) fast-forwards the base branch (`git merge --ff-only task/<slug>`, or opens a PR via `gh pr create --fill` if targeting a protected branch) and **immediately deletes the worktree**:
     ```bash
     git worktree remove --force .worktrees/<slug> && git branch -d task/<slug>
     ```
     A worktree only exists on your SSD for the few seconds or minutes the agent is actively coding.
   * **Step 3 — Crash Safety Net (`secondbrain prune`):** If an agent crashes or your laptop sleeps mid-task, `secondbrain prune` scans `.worktrees/` for folders with no live PID. It checks `git merge-base --is-ancestor <worktree_HEAD> <base_branch>`: if already merged (or clean), it deletes the folder automatically; if it contains unmerged commits, it flags Chief in `roster_status()` so work is never silently lost.

### Harness-Aware Spawning & Push-on-Exit Wakeup (Zero Polling)
* **Spawning:**
  * **Inside BB (Visual IDE Mode):** `bin/spawn-agent` spawns workers as native BB threads (`bb thread spawn --model <model> --title "..." --message "..."`) or BB workflows so you see live pulsing status dots and clickable threads in the BB Left Sidebar.
  * **Inside Claude Code, Codex, Pi, or Terminal (Headless Mode):** `bin/spawn-agent` spawns background CLI workers tracked in `secondbraind` (`secondbrain ps`).
* **Upward Async Completion (Push-on-Exit):**
  * **In BB:** Child thread completion natively wakes the parent thread (or the worker's exit trap runs `bb thread tell <parent_id> "<status> | <commit> | <diff_stat>"`).
  * **In CLI / Headless:** The worker's exit trap pushes a completion event to `~/.secondbrain/daemon.sock`. Chief drains unread completion events in `<1ms` at the start of any turn (and `secondbraind` triggers an OS desktop notification/bell when idle). Chief **never** runs a blocking sleep/poll loop.

### Lean Task Contracts & Git Diff Verification
* **Plain Markdown Briefs:** No bloated JSON contract schemas. Briefs use 4 clean Markdown lines (*Mission, Target Files/Scope, Invariants, Verify Command*).
* **Git Diff as Single Source of Truth:** No redundant "Reviewer peer" subagent committees. The worker runs real tests and commits; `git diff` against the base branch is the unalterable proof of work.

---

## 3. The Second Brain & Memory Architecture (2-Repo Engine + Vault Split)

### Public Engine Repo vs. Private Vault Repo
To make the operating system **100% shareable publicly** while keeping your personal notes, project paths, and learnings strictly private—and making it physically impossible to accidentally `git push` private notes to a public remote—the system is split into **two separate Git repositories**:

1. **Repo 1 — Public Engine (`github.com/<you>/secondbrain` $\rightarrow$ `~/.secondbrain/`):**
   * **100% Open & Shareable:** Contains all code (`mcp-server/`, `bin/`), the 5 universal OS role skills (`skills/*/SKILL.md`), universal engineering invariants (`invariants/*.md`), default model routing (`config/models.default.yaml`), and `setup.sh`.
   * **Strictly Read-Only (`chmod -R a-w`) During Normal Work:** Contains **zero** personal notes, project names, or local paths, and is locked read-only at the OS level so agents cannot accidentally write to it.
2. **Repo 2 — Private Vault (`github.com/<you>/secondbrain-vault` $\rightarrow$ `~/.secondbrain-vault/`):**
   * **100% Private to You:** Contains your personal cross-project knowledge (`learnings/<category>/<topic-slug>.md`), your registered project charters (`projects/<slug>.md`), your **custom private skills & invariants** (`skills/*/SKILL.md`, `invariants/*.md`), and your optional personal model overrides (`config/models.yaml`).
   * All automated writes commit and push strictly inside `~/.secondbrain-vault/`.

### 4 Hard Privacy Guardrails (Preventing Accidental Leaks to the Public Repo)
1. **OS-Level Read-Only Lock (`chmod -R a-w`):** `setup.sh` locks `~/.secondbrain/skills`, `invariants`, `mcp-server`, and `bin` as read-only (`r-x`). Any accidental agent attempt to edit a file inside the Public Repo fails immediately with `Permission denied`.
2. **Private Skills Default to the Private Vault (`~/.secondbrain-vault/skills/`):** Whenever you or an agent create a new custom skill or rule for your workflow, it is saved in `~/.secondbrain-vault/skills/` (or `~/.secondbrain-vault/invariants/`). `setup.sh` symlinks both Public Engine skills and Private Vault skills into your harnesses seamlessly.
3. **Zero Auto-Push on Public Repo:** `secondbraind` only has code to commit and push inside `~/.secondbrain-vault`. Nothing in the system ever auto-commits or auto-pushes to `~/.secondbrain`.
4. **Explicit `secondbrain publish` + Vault-Aware Pre-Push Scanner:** Updating the Public Repo only happens when you explicitly run `secondbrain publish`. A Git `pre-commit` / `pre-push` hook in `~/.secondbrain/.git/hooks/` dynamically reads all private project names/domains from `~/.secondbrain-vault/projects/*.md` and blocks any commit to the Public Repo that contains a private project name, `/Users/<username>` path, or secret token.

### The 3 Scopes of Memory & The Portability Litmus Test
To prevent single-repo quirks from polluting your global knowledge base, memory is separated into **three distinct scopes**:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ SCOPE 1: Project-Local Memory (<repo>/AGENTS.md & CLAUDE.md)            │
│ • Lives inside each individual project repository                       │
│ • Stores repo-specific build scripts, folder quirks, and domain rules   │
├─────────────────────────────────────────────────────────────────────────┤
│ SCOPE 2: Global Git-Backed Truth (Public Engine + Private Vault)        │
│ • Public Engine (~/.secondbrain/): invariants/*.md & skills/*/SKILL.md  │
│ • Private Vault (~/.secondbrain-vault/):                                │
│   - learnings/<category>/<topic-slug>.md (Your cross-project notes)     │
│   - projects/<slug>.md (Your project charters, repo paths, test cmds)   │
├─────────────────────────────────────────────────────────────────────────┤
│ SCOPE 3: Local Workstation Cache (~/.secondbrain/storage/memory.db)     │
│ • Git-ignored SQLite WAL database managed by `secondbraind`             │
│ • Stores distilled Index-Card vector embeddings + live agent roster     │
│ • 100% rebuildable from Scope 2 Markdown files in <3 seconds            │
└─────────────────────────────────────────────────────────────────────────┘
```

> **The Portability Litmus Test:**  
> Before calling `memory_record`, an agent asks: *"Would this lesson save debugging time in a completely different repository next month?"*  
> * **NO** (e.g., *"In `my-app`, run `pnpm db:generate` before tests"*): Update `<repo>/AGENTS.md` in that project.  
> * **YES** (e.g., *"SQLite in WAL mode still throws `SQLITE_BUSY` under concurrent writes unless `busy_timeout >= 5000` is set"*): Record it to the global Second Brain (`learnings/database/sqlite-wal-concurrency.md`).

### What Gets Embedded: Distilled "Index Cards" vs. Full Markdown Files
Local embedding models (`bge-small-en-v1.5` via `fastembed`) have a **512-token window** (~350 words). Dumping raw Markdown files and code blocks into the embedding model truncates long files and dilutes semantic search accuracy.

Instead, `indexer.py` separates **what is embedded** from **what is returned**:

1. **Markdown File on Disk (`learnings/database/sqlite-wal-concurrency.md`):**
   ```markdown
   ---
   title: "SQLite WAL Mode Concurrency"
   category: "database"
   tags: ["sqlite", "wal", "locking", "busy-timeout"]
   summary: "Prevent 'database is locked' errors under multi-process concurrency using WAL + busy_timeout."
   updated_at: "2026-11-08"
   ---
   ## Trigger
   When multiple processes read and write to a SQLite database concurrently...

   ## Root Cause
   `PRAGMA journal_mode = WAL` allows concurrent readers with one writer, but concurrent writers still fail immediately with `SQLITE_BUSY` unless a lock wait timeout is configured.

   ## Permanent Invariant
   Always pair `PRAGMA journal_mode = WAL;` with `PRAGMA busy_timeout = 5000;` on every connection initialization.
   ```
2. **What `indexer.py` Embeds into `storage/memory.db` (~100–250 Tokens per Vector):**
   It constructs and embeds a high-signal **Index Card** string:
   ```text
   database | SQLite WAL Mode Concurrency | Tags: sqlite, wal, locking, busy-timeout
   Summary: Prevent 'database is locked' errors under multi-process concurrency using WAL + busy_timeout.
   Trigger & Invariant: When multiple processes read and write to a SQLite database concurrently... Always pair PRAGMA journal_mode = WAL with PRAGMA busy_timeout = 5000.
   ```
   *(If a canonical file covers multiple distinct sub-topics under `## ` H2 headings, `indexer.py` embeds one Index Card vector per section so no vector ever hits the 512-token ceiling.)*
3. **What `memory_search` Returns to the Agent:**
   When a search query matches an Index Card vector in `<5ms`, `secondbraind` reads and returns the **complete Markdown file** from disk so the agent gets the full explanation and code examples.

### Simple, Self-Healing Memory Hygiene (Zero Fake Grading Ceremony)
There are **no** `provisional`, `verified`, or `quarantined` status badges or complex scoring formulas. Every file in `learnings/` is active truth, kept clean by **three practical mechanisms**:

```text
[Agent calls memory_record(action="check", title, summary, tags)]
                              │
                              ▼
         1. Fast Vector Scan (<5ms in secondbraind)
         Surfaces any existing notes with >80% similarity
                              │
                              ▼
         2. Agent Editorial Decision (Self-Healing)
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
  [UPDATE EXISTING]     [CREATE NEW]        [DELETE / DISCARD]
  Refines canonical     Creates new slug    Deletes obsolete note
  file (or updates it   if genuinely        or discards duplicate
  for new lib version)  distinct topic      discovery
```

1. **Write-Time Editorial Gate & Safety Linter:**
   * **Only After Green Tests:** Agents only record learnings after their task's verification tests pass.
   * **Check-Before-Write:** Calling `memory_record(action="check")` scans existing notes first. If a canonical note on that topic already exists (e.g., `learnings/database/sqlite-wal-concurrency.md`), the agent updates that file (`action="update_existing"`) instead of creating a duplicate file.
   * **Deterministic Safety Linter (`<1ms`):** Before committing to Git, `secondbraind` runs a fast regex/entropy check that blocks dangerous anti-patterns (e.g., `NODE_TLS_REJECT_UNAUTHORIZED=0`, `verify=False`, `--no-verify`, or leaked API keys).
2. **Self-Healing on Read:**
   * If a future agent retrieves a note via `memory_search` and discovers while working that a library upgrade changed the behavior (e.g., Next.js 14 vs. 16) or that the note was wrong, the agent updates the note in-place (`action="update_existing"`) or removes it (`action="delete"`, which runs `git rm`) as soon as its tests pass.
3. **Two-Stage Scheduled Janitor (`janitor.py` + `skills/janitor/SKILL.md`):**
   * **Stage 1 (Deterministic Clustering in Python, Zero LLM):** `memory_compact()` inside `janitor.py` scans all vectors in `storage/memory.db` and outputs clusters of notes with cosine similarity `>0.85`.
   * **Stage 2 (Agent Prose Synthesis):** A `tier: light` subagent running `skills/janitor/SKILL.md` reads any flagged duplicate clusters, merges them into a single clean canonical note, deletes the redundant file, and commits to Git.

### The Local Daemon (`secondbraind`), Lazy Autostart & Vault Sync Protocol
* **Single Shared Process (`~/.secondbrain/daemon.sock`):** Holds the 67MB `bge-small-en-v1.5` ONNX model in RAM once (~120MB total) and serializes SQLite WAL writes across all harnesses.
* **Zero-Ops Lazy Autostart:** You never have to start or manage `secondbraind` manually. When any harness invokes `bin/secondbrain-mcp`, if `daemon.sock` is not responding, the client acquires `~/.secondbrain/daemon.lock` (`flock`) and auto-spawns `bin/secondbraind --daemonize` in `<200ms`. After 2 hours of idle time, `secondbraind` exits automatically to free RAM.
* **Automatic Private Vault Sync (`~/.secondbrain-vault` $\leftrightarrow$ GitHub):**
  1. **Zero-Conflict Merges via `.gitattributes` (`* merge=union`):**
     * `~/.secondbrain-vault/.gitattributes` contains `* text=auto merge=union`. If two machines ever edit the same file while offline, Git's built-in `union` driver automatically keeps both edits without conflict markers (`<<<<<<<`) and without halting the pull. Any duplicate phrasing is naturally consolidated by the Janitor on its next pass.
  2. **On Every Write (`memory_record` / `memory_compact`):**
     * `secondbraind` writes the `.md` file to `~/.secondbrain-vault/learnings/<category>/<slug>.md` and updates the local SQLite vector index immediately (`<10ms`).
     * It then spawns a non-blocking background sync inside your Private Vault:
       ```bash
       git -C ~/.secondbrain-vault add -A && \
       git -C ~/.secondbrain-vault commit -m "vault: update <slug>" && \
       git -C ~/.secondbrain-vault pull --rebase --autostash origin main && \
       git -C ~/.secondbrain-vault push origin main &
       ```
       *(If you are offline, the commit stays safely in `~/.secondbrain-vault` and pushes automatically the next time you are online.)*
  3. **On Daemon Boot (Multi-Device Pull):**
     * Whenever `secondbraind` starts up for a new coding session, it runs `git -C ~/.secondbrain-vault pull --rebase --autostash origin main &` in the background to pull down any notes recorded on your other machines.
  4. **Instant Incremental Re-Indexing (Git Pulls & Manual Edits):**
     * Before serving `memory_search`, `secondbraind` checks `git -C ~/.secondbrain-vault rev-parse HEAD` and file `mtime`s against SQLite metadata. If a `git pull` brought in new notes—or if you edited a Markdown file in `~/.secondbrain-vault` by hand—`indexer.py` incrementally re-embeds only the changed files in `<100ms`.

---

## 4. Universal Operating Invariants & Standards

Invariants are non-negotiable system guarantees (`~/.secondbrain/invariants/*.md`) that all agents uphold:

1. **System & State Invariants:**
   * Explicit pre-conditions and post-conditions on critical data flows.
   * Atomic operations must be transactional; concurrent writes must define isolation guarantees.
2. **Verification First:**
   * No task is complete without concrete terminal evidence: verification tests executed, exit code `0`, and clean `git diff`.
   * Real integration tests over brittle mocks.
3. **Communication & Escalation Invariants:**
   * Never dump raw terminal logs into the Captain's chat.
   * When genuinely blocked on a product tradeoff, present a 3-line summary, a recommended default, and 2–3 clear choices.

---

## 5. Universal Interface: Model Context Protocol (MCP)

To work identically across every agent harness, the Second Brain is exposed via a lightweight **MCP Server** (`bin/secondbrain-mcp`) backed by `secondbraind`.

### Exposed MCP Tools
* `memory_search(query: str, top_k: int = 3, category: str | None = None, tags: list[str] = [])`: Searches the Index-Card vectors in `storage/memory.db` (`<5ms`) and returns the full Markdown contents of the top matching notes.
* `memory_record(action: "check" | "update_existing" | "create_new" | "delete", title: str, summary: str = "", details: str = "", category: str = "general", tags: list[str] = [], target_slug: str | None = None)`:
  * `action="check"`: Returns nearest existing notes (`>0.80` similarity) so the agent can decide whether to refine an existing note or create a new one.
  * `action="update_existing"` / `"create_new"`: Runs the safety linter, writes `learnings/<category>/<slug>.md`, updates the SQLite vector index immediately, and triggers a non-blocking background `git commit && git push`.
  * `action="delete"`: Runs `git rm` on an obsolete note and removes its vector from SQLite.
* `memory_compact()`: Returns high-similarity note clusters (`>0.85`) for the Janitor subagent to merge.
* `get_invariants(domain: str = "general")`: Returns active operating and engineering invariants from `invariants/*.md`.
* `roster_status(project: str | None = None)`: Returns all registered projects (`projects/*.md`), active or blocked worktrees/workers, and unread background task completion digests so Chief recovers full state in `<5ms` on Turn 1 of any session.

### Cross-Harness MCP Configuration
All harnesses invoke the self-contained `~/.secondbrain/bin/secondbrain-mcp` wrapper (which automatically uses `~/.secondbrain/.venv/bin/python` and lazy-starts `secondbraind`):

* **BB / Claude Code / Codex / Antigravity / Cursor / Pi:**
  ```json
  {
    "mcpServers": {
      "secondbrain": {
        "command": "/Users/<you>/.secondbrain/bin/secondbrain-mcp",
        "args": []
      }
    }
  }
  ```
  *(Automatically registered across installed harnesses by `setup.sh`.)*

---

## 6. Visual Architecture Diagramming (Tool-Agnostic Adapter Pattern)

We use **D2 (Sketch Mode)** for declarative, hand-drawn architecture diagrams while isolating the compiler behind a **single-spot adapter**:

```text
┌─────────────────────────────────────────────────────────────────┐
│ 1. INSTRUCTION LAYER: `skills/diagramming/SKILL.md`             │
│    Single prompt definition: "When drawing, follow this skill." │
├─────────────────────────────────────────────────────────────────┤
│ 2. TOOL ADAPTER LAYER: `bin/render-diagram`                     │
│    Single executable script: hides compiler flags & engines.    │
├─────────────────────────────────────────────────────────────────┤
│ 3. STORAGE CONVENTION: `docs/diagrams/<name>.svg`               │
│    Markdown docs link only to the compiled .svg asset.          │
└─────────────────────────────────────────────────────────────────┘
```

If a better diagramming tool emerges in the future, updating **1 line** inside `bin/render-diagram` (`d2 --sketch "$SOURCE" "$TARGET"`) and updating `skills/diagramming/SKILL.md` migrates every project immediately.

---

## 7. Single-Spot Model Routing (`config/models.yaml` + `bin/spawn-agent`)

Agents never hardcode model names in prompts or skills. Every skill requests an abstract semantic tier (`heavy` or `light`), and **`bin/spawn-agent`** resolves the exact model from `config/models.yaml` based on the active harness:

```yaml
# ~/.secondbrain/config/models.yaml
# Single Source of Truth for Model Routing Across Harnesses

default_tiers:
  heavy: "gemini-4-neon"            # Global Chief, Project Chief, Complex Architects
  light: "gemini-4-hydrogen"        # Fast-Fix Workers, Routine Architects, Janitor
  embedding: "local/bge-small-en-v1.5" # 100% Local ONNX via fastembed (67MB, 0 API keys)

harness_overrides:
  bb:
    heavy: { provider: "acp-antigravity", model: "gemini-4-neon", reasoning: "high" }
    light: { provider: "acp-antigravity", model: "gemini-4-hydrogen", reasoning: "medium" }
  claude:
    heavy: "claude-opus-4-6"
    light: "claude-sonnet-4-6"
  codex:
    heavy: "gpt-5.6-sol"
    light: "gpt-5.6-luna"
```

### How `bin/spawn-agent` Enforces Single-Spot Routing
When Chief or Project Chief spawns a worker:
```bash
bin/spawn-agent --tier light --role architect --repo ~/code/my-app --task auth-jwt --brief "..."
```
1. `bin/spawn-agent` reads `config/models.yaml` for the current host harness.
2. Creates the isolated worktree (`~/code/my-app/.worktrees/auth-jwt`) with symlinked/CoW dependencies.
3. Injects `skills/<role>/SKILL.md` + `invariants/engineering.md`.
4. Launches the worker non-blockingly (`bb thread spawn` in BB, or background CLI process in headless mode), registers the task in `secondbraind`, and returns immediately.

---

## 8. Two-Repo Directory Structure (Public Engine + Private Vault)

```text
# =========================================================================
# REPO 1: PUBLIC ENGINE (github.com/<you>/secondbrain -> ~/.secondbrain)
# Shareable with anyone — 100% code, skills, invariants & adapters
# =========================================================================
~/.secondbrain/
├── README.md                     <-- Public docs, architecture SVG & bootstrap guide
├── SYSTEM_DESIGN.md              <-- Full system architecture specification
├── AGENTS.md                     <-- Root Global Instructions (auto-symlinked into harnesses)
├── CLAUDE.md                     <-- Symlink -> AGENTS.md (for Claude Code auto-discovery)
├── setup.sh                      <-- 1-command installer & Private Vault linker
│
├── config/
│   └── models.default.yaml       <-- Default model routing template (heavy, light, embedding)
│
├── bin/                          <-- Executable Adapters (symlinked to ~/.local/bin)
│   ├── spawn-agent               <-- Worktree creator + model router + BB/CLI spawner
│   ├── render-diagram            <-- Universal diagram compiler wrapper (d2 --sketch)
│   ├── secondbrain-mcp           <-- Self-contained .venv Python MCP launcher + daemon autostart
│   ├── secondbraind              <-- Local UNIX socket daemon (shared ONNX + SQLite WAL)
│   └── secondbrain               <-- CLI supervisor (`ps`, `prune`, `report`, `upgrade`, `publish`)
│
├── invariants/                   <-- Universal operating rules (locked read-only via chmod a-w)
│   ├── engineering.md            <-- Code hygiene, testing, typing, error boundaries
│   ├── delegation.md             <-- Chief-to-Worker brief & worktree lifecycle contract
│   └── pr-standards.md           <-- Commits, rebase rules, diff verification
│
├── skills/                       <-- 5 core universal OS roles (locked read-only via chmod a-w)
│   ├── chief/SKILL.md            <-- Global Chief of Staff role
│   ├── project-chief/SKILL.md    <-- Repo-level Project Chief role
│   ├── architect/SKILL.md        <-- Isolated worktree task worker role
│   ├── janitor/SKILL.md          <-- Memory compaction & prose merge role
│   └── diagramming/SKILL.md      <-- Visual architecture syntax & rules
│
├── templates/                    <-- Starter templates used when initializing a new Vault
│   ├── learning.md               <-- Canonical learning template (Trigger / Root Cause / Invariant)
│   └── project.md                <-- Project charter template (repo_path, default_branch, test_cmd)
│
├── mcp-server/                   <-- Local Daemon & MCP Implementation (locked read-only)
│   ├── server.py                 <-- Featherweight MCP client forwarding to daemon.sock
│   ├── daemon.py                 <-- secondbraind server (ONNX embeddings + SQLite WAL)
│   ├── indexer.py                <-- Distilled Index-Card parser & incremental vectorizer
│   ├── janitor.py                <-- Cosine similarity clustering (>0.85) engine
│   └── requirements.txt          <-- Minimal deps (fastembed, mcp, pyyaml)
│
├── vault -> ~/.secondbrain-vault <-- Git-ignored symlink pointing to active Private Vault
└── .gitignore                    <-- Ignores .venv/, .cache/, vault, daemon.sock, storage/memory.db


# =========================================================================
# REPO 2: PRIVATE VAULT (github.com/<you>/secondbrain-vault -> ~/.secondbrain-vault)
# 100% private to you — your learnings, project charters, custom skills & overrides
# =========================================================================
~/.secondbrain-vault/
├── .gitattributes                <-- `* text=auto merge=union` (zero-conflict auto-merging)
├── learnings/                    <-- Your private categorized Markdown knowledge base
│   └── database/
│       └── sqlite-wal-concurrency.md
│
├── projects/                     <-- Your private registered project charters
│   └── my-startup.md             <-- Local repo path, default branch, test_cmd, context
│
├── skills/                       <-- Your private custom skills (auto-symlinked alongside core skills)
│   └── deploy-internal/SKILL.md
│
├── invariants/                   <-- (Optional) Personal/company-specific invariant rules
│
└── config/
    └── models.yaml               <-- (Optional) Personal model tier overrides
```

---

## 9. Zero-Chore Bootstrap (`setup.sh`) for You & Anyone Else

The `setup.sh` script in the **Public Engine** supports both **your personal 1-line setup** (attaching your Private Vault) and **any public user** cloning your setup for themselves:

### A. How You Set Up a Machine (With Your Private Vault)
```bash
git clone https://github.com/<you>/secondbrain.git ~/.secondbrain
~/.secondbrain/setup.sh --vault git@github.com:<you>/secondbrain-vault.git
```
1. Clones your **Private Vault** into `~/.secondbrain-vault` and links `~/.secondbrain/vault -> ~/.secondbrain-vault`.
2. Creates `~/.secondbrain/.venv`, installs dependencies, pre-warms the 67MB `bge-small-en-v1.5` model, and indexes `~/.secondbrain-vault/learnings/**/*.md` into `storage/memory.db`.
3. Symlinks `AGENTS.md`, Public Engine `skills/*`, and Private Vault `skills/*` into all installed harnesses (`~/.bb/skills/`, `~/.claude/CLAUDE.md` & `~/.claude/skills/`, `~/.codex/AGENTS.md` & `~/.codex/skills/`, `~/.pi/agent/`, `~/.gemini/antigravity-cli/skills/`).
4. Symlinks `bin/*` into `~/.local/bin/` and registers `bin/secondbrain-mcp` across all harnesses.
5. Installs the Vault-Aware `pre-commit`/`pre-push` privacy hook into `~/.secondbrain/.git/hooks/` and locks `~/.secondbrain/{skills,invariants,mcp-server,bin}` read-only (`chmod -R a-w`).

### B. How Anyone Else Uses Your Public Repo
```bash
git clone https://github.com/<you>/secondbrain.git ~/.secondbrain
~/.secondbrain/setup.sh
```
* When `--vault` is omitted, `setup.sh` automatically creates a fresh local `~/.secondbrain-vault` (`git init`), seeds it with `templates/learning.md` and `templates/project.md`, and gives them the exact same agent operating system in seconds.

### C. Zero-Conflict Engine Upgrades & Safe Publishing
* **Pulling Engine Updates (`secondbrain upgrade`):**
  Temporarily unlocks `~/.secondbrain`, runs `git -C ~/.secondbrain pull --ff-only origin main`, refreshes symlinks, and re-locks `chmod -R a-w`.
* **Publishing Engine Improvements (`secondbrain publish`):**
  Only runs when explicitly invoked by you. Scans the `~/.secondbrain` diff against all private project names in `~/.secondbrain-vault/projects/*.md`, `/Users/<username>`, and secret patterns before allowing a commit/push to the public remote.
