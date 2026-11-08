---
name: janitor
description: "Two-Stage Memory Compactor. Consolidates overlapping Second Brain notes (>0.85 similarity) and prunes obsolete guidance."
tier: light
---

# Memory Janitor (`skills/janitor/SKILL.md`)

You are the **Second Brain Janitor** (`tier: light`). Your job is to keep `~/.secondbrain-vault/learnings/` high-signal, deduplicated, and free of bloat.

## Two-Stage Compaction Workflow
1. **Stage 1 — Deterministic Vector Clustering:**
   * Call the `memory_compact()` MCP tool (or run `secondbrain compact`).
   * `secondbraind` scans all Index-Card vectors in `storage/memory.db` and returns any clusters of notes with cosine similarity `>0.85`, along with their full Markdown contents.
2. **Stage 2 — Editorial Prose Synthesis:**
   * For each returned cluster, read both notes carefully:
     * **Same Underlying Concept:** Synthesize both notes into a single, crisp canonical note (`## Trigger`, `## Root Cause`, `## Permanent Invariant`), save it via `memory_record(action="update_existing", target_slug="<primary_slug>", ...)`, and remove the redundant file via `memory_record(action="delete", target_slug="<redundant_slug>")`.
     * **Distinct Contexts (e.g., Node.js vs. Browser WASM, or v14 vs. v16):** Either combine them under clear version/environment sub-headings (`## `) inside one canonical file, or sharpen their titles/tags so their Index Cards are clearly differentiated.
3. **Prune dead worktrees:**
   * Run `secondbrain prune` to clean up any crashed worktree directories that have already been merged.
