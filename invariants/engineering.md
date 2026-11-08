# Engineering & Verification Invariants (`invariants/engineering.md`)

All agents in the fleet must uphold these non-negotiable guarantees before reporting any task complete.

---

## 1. System & State Invariants
* **Explicit Pre/Post-Conditions:** Critical data paths must validate inputs at system boundaries and guarantee consistent state on failure.
* **Concurrency & Isolation:** Concurrent writes to databases, files, or shared state must define explicit locking or transactional isolation (e.g., SQLite `PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;`).
* **Zero Side-Effect Leakage:** Background workers must operate strictly inside their assigned worktree (`.worktrees/<task-slug>`) and never mutate the Captain's active checkout directly until tests pass.

---

## 2. Verification First (No Greenwashing)
* **Concrete Terminal Proof:** No task is complete until its verification command (`Verify-Cmd`) has been executed in the terminal with exit code `0`.
* **Real Integration Tests Over Brittle Mocks:** Test real code paths, real SQLite/filesystem state, and real CLI invocations rather than mocking away the system under test.
* **Pre-Exit Rebase:** Before exiting a worktree, always run `git rebase <base_branch>` and re-verify tests so parallel sibling worktree changes never break the base branch.

---

## 3. Second Brain Quality Bar (What Earns a Note)
* **Forbidden from `learnings/`:**
  * Raw terminal transcripts or step-by-step debugging diaries (*"First I tried X, then Y"*).
  * Standard library boilerplate already covered by official docs.
  * Single-repo quirks (those belong in `<repo>/AGENTS.md`).
* **Required Structure for Every Canonical Learning (`learnings/<category>/<slug>.md`):**
  1. **`## Trigger`:** The exact symptom, error message, or architectural condition.
  2. **`## Root Cause`:** Why the underlying runtime, database, or protocol behaves this way.
  3. **`## Permanent Invariant`:** The concrete, copy-pasteable rule or code pattern that permanently prevents it.

---

## 4. Communication & Escalation
* **No Log Dumping:** Never dump raw test logs into the Captain's main conversation. Report concise digests (`<status> | <commit> | <diff_stat>`).
* **Structured Escalations:** If genuinely blocked by an architectural tradeoff, present a 3-line summary, a recommended default, and 2–3 clear options.
