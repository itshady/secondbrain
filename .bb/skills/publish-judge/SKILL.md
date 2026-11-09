---
name: publish-judge
description: "Public Release Judge for the Second Brain Engine (~/.secondbrain). Audits git diffs before publishing to the public repository to ensure zero private data, project names, or Scope 1/2 leaks."
---

# Public Release Judge (`.bb/skills/publish-judge/SKILL.md`)

Whenever you modify `~/.secondbrain` (Public Engine) and prepare to publish changes to `origin/main` via `secondbrain publish`, you MUST act as an uncompromising **Public Release Judge** and verify the outgoing diff against the **5-Point Public Release Rubric** below.

---

## The 5-Point Public Release Rubric

Inspect the full outgoing diff (`git -C ~/.secondbrain diff origin/main..HEAD` and any uncommitted changes) line by line:

1. **Zero Personal Machine Paths or Local Identifiers:**
   - **FORBIDDEN:** Hardcoded `/Users/<username>`, `/home/<username>`, local machine hostnames, personal email addresses, or private SSH/Tailscale IPs.
   - **ALLOWED:** Portable environment variables (`$HOME`, `~`, `$SECONDBRAIN_HOME`, `$SECONDBRAIN_VAULT`, `<username>`, `<you>`).
2. **Zero Private Project Names, Domains, or Employer/Course Context:**
   - **FORBIDDEN:** Any project slug, repo name, API endpoint, competition rule, or domain term from `~/.secondbrain-vault/projects/*.md`, university course codes, or private company names.
   - **ALLOWED:** Generic illustrative placeholders (`example-project`, `Repo A`, `my-app`, `secondbrain`).
3. **Zero Secrets, Tokens, or Credentials:**
   - **FORBIDDEN:** API keys (`sk-...`, `ghp_...`, `AKIA...`), bearer tokens, private keys, or `.env` values.
4. **Strict 3-Tier Scope Separation (The Portability Litmus Test):**
   - **FORBIDDEN in `~/.secondbrain`:** Project-specific skills (which belong in `<repo>/.bb/skills/`) or personal cross-project learnings/charters (which belong in `~/.secondbrain-vault/`).
   - **ALLOWED in `~/.secondbrain`:** Universal OS orchestration skills (`chief`, `project-chief`, `architect`, `janitor`, `diagramming`), repo-local engine skills (`.bb/skills/publish-judge`), CLI adapters (`bin/*`), and the MCP server (`mcp-server/*`).
5. **Clean Commit History (`origin/main..HEAD`):**
   - Not only must the current working tree pass, **every commit message and intermediate diff in `origin/main..HEAD`** must also be free of private identifiers. If an earlier unpushed commit leaked a term that was later deleted, squash/amend the unpushed commits before publishing.

---

## Automated 2-Stage Publishing Workflow (`secondbrain publish`)

Never leave verified Public Engine improvements unpushed, and never ask the Captain to manually run `secondbrain publish`. Instead, execute this 3-step sequence automatically at the end of any Public Engine task:

1. **Commit Changes & Run `setup.sh`:**
   ```bash
   ~/.secondbrain/setup.sh
   git -C ~/.secondbrain add -A
   git -C ~/.secondbrain commit -m "<clean conventional commit message>"
   ```
2. **Audit Outgoing Diff Against This Judge Rubric & Stamp Approval:**
   ```bash
   git -C ~/.secondbrain diff origin/main..HEAD
   ```
   After verifying all 5 points of the rubric above pass with zero violations, stamp the exact `HEAD` SHA:
   ```bash
   ~/.secondbrain/bin/secondbrain judge-approve --note "Audited origin/main..HEAD against 5-point Public Release Rubric: 0 personal paths, 0 private projects, 100% universal OS scope."
   ```
3. **Publish to Public Remote (Enforces Stage 1 Scanner + Stage 2 Judge Stamp):**
   ```bash
   ~/.secondbrain/bin/secondbrain publish
   ```
   *(Both `secondbrain publish` and `.git/hooks/pre-push` will block the push if either Stage 1 `privacy-check` fails OR the cryptographic Stage 2 `judge-approve` stamp does not match `git rev-parse HEAD`.)*
