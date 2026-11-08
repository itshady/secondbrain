#!/usr/bin/env python3
"""
Second Brain Distilled Index-Card Parser, Safety Linter & Vector Indexer.
Embeds ~100-250 token Index Cards using local ONNX (BAAI/bge-small-en-v1.5)
into SQLite WAL (`storage/memory.db`) and returns full Markdown files on match.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import subprocess
import time
from pathlib import Path
from typing import Any

import numpy as np
import yaml

# Deterministic <1ms Safety Linter patterns
DANGEROUS_PATTERNS = [
    (re.compile(r"NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['\"]?0['\"]?"), "Disabling TLS verification (NODE_TLS_REJECT_UNAUTHORIZED=0) is forbidden."),
    (re.compile(r"verify\s*=\s*False"), "Disabling SSL certificate verification (verify=False) is forbidden."),
    (re.compile(r"--no-verify\b"), "Bypassing Git hooks (--no-verify) is forbidden."),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "Private key material detected."),
    (re.compile(r"\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b"), "Potential API key or secret token detected."),
]


def check_safety(text: str) -> tuple[bool, str]:
    """Run deterministic <1ms security & sanity checks before writing any learning."""
    for pattern, reason in DANGEROUS_PATTERNS:
        if pattern.search(text):
            return False, reason
    return True, "ok"


def get_paths() -> tuple[Path, Path, Path]:
    """Return (engine_dir, vault_dir, db_path)."""
    engine_dir = Path(os.environ.get("SECONDBRAIN_HOME", Path.home() / ".secondbrain")).resolve()
    vault_env = os.environ.get("SECONDBRAIN_VAULT")
    if vault_env:
        vault_dir = Path(vault_env).resolve()
    elif (engine_dir / "vault").exists():
        vault_dir = (engine_dir / "vault").resolve()
    else:
        vault_dir = (Path.home() / ".secondbrain-vault").resolve()
    db_path = engine_dir / "storage" / "memory.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return engine_dir, vault_dir, db_path


def connect_db(db_path: Path) -> sqlite3.Connection:
    """Open SQLite connection with WAL mode and busy_timeout=5000."""
    conn = sqlite3.connect(str(db_path), timeout=5.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    init_schema(conn)
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    """Initialize SQLite schema for notes, Index-Card vectors, roster, and events."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notes (
            slug TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            summary TEXT NOT NULL,
            file_path TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            mtime REAL NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS note_vectors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL,
            section_title TEXT NOT NULL,
            index_card TEXT NOT NULL,
            vector_blob BLOB NOT NULL,
            FOREIGN KEY (slug) REFERENCES notes(slug) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_note_vectors_slug ON note_vectors(slug);

        CREATE TABLE IF NOT EXISTS roster (
            task_id TEXT PRIMARY KEY,
            project TEXT NOT NULL,
            repo_path TEXT NOT NULL,
            worktree_path TEXT NOT NULL,
            branch TEXT NOT NULL,
            role TEXT NOT NULL,
            tier TEXT NOT NULL,
            harness TEXT NOT NULL,
            pid INTEGER,
            thread_id TEXT,
            status TEXT NOT NULL,
            summary TEXT DEFAULT '',
            started_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            project TEXT NOT NULL,
            status TEXT NOT NULL,
            summary TEXT NOT NULL,
            created_at REAL NOT NULL,
            read INTEGER DEFAULT 0
        );
        """
    )
    conn.commit()


def parse_markdown_note(md_path: Path, learnings_root: Path) -> dict[str, Any]:
    """Parse YAML frontmatter and body sections from a canonical Markdown learning file."""
    raw = md_path.read_text(encoding="utf-8")
    sha256 = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    mtime = md_path.stat().st_mtime

    frontmatter: dict[str, Any] = {}
    body = raw
    if raw.startswith("---\n"):
        parts = raw.split("\n---\n", 1)
        if len(parts) == 2:
            try:
                frontmatter = yaml.safe_load(parts[0][4:]) or {}
            except Exception:
                frontmatter = {}
            body = parts[1].strip()

    rel = md_path.relative_to(learnings_root)
    slug = str(rel.with_suffix("")).replace("\\", "/")
    category = frontmatter.get("category") or (rel.parts[0] if len(rel.parts) > 1 else "general")
    title = frontmatter.get("title") or slug.split("/")[-1].replace("-", " ").title()
    tags = frontmatter.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    summary = frontmatter.get("summary") or ""
    updated_at = str(frontmatter.get("updated_at") or time.strftime("%Y-%m-%d"))

    # Build Distilled Index Cards (~100-250 tokens each, stripping bulky code blocks)
    body_no_code = re.sub(r"```.*?```", "", body, flags=re.DOTALL)
    body_clean = re.sub(r"\s+", " ", body_no_code).strip()

    tags_str = ", ".join(str(t) for t in tags)
    header_prefix = f"{category} | {title} | Tags: {tags_str}\nSummary: {summary}".strip()

    # Split by ## H2 sections; if only standard Trigger/Root Cause/Permanent Invariant, keep as 1 concise card
    h2_Matches = list(re.finditer(r"^##\s+(.+)$", body, flags=re.MULTILINE))
    cards: list[tuple[str, str]] = []

    standard_sections = {"trigger", "the trigger", "root cause", "the root cause", "permanent invariant", "the permanent invariant", "invariant"}
    h2_names = {m.group(1).strip().lower() for m in h2_Matches}

    if not h2_Matches or h2_names.issubset(standard_sections) or len(body_clean) <= 900:
        snippet = body_clean[:900]
        cards.append(("main", f"{header_prefix}\n{snippet}"))
    else:
        for idx, match in enumerate(h2_Matches):
            sec_title = match.group(1).strip()
            start = match.end()
            end = h2_Matches[idx + 1].start() if idx + 1 < len(h2_Matches) else len(body)
            sec_body = re.sub(r"```.*?```", "", body[start:end], flags=re.DOTALL)
            sec_clean = re.sub(r"\s+", " ", sec_body).strip()[:700]
            cards.append((sec_title, f"{header_prefix}\nSection ({sec_title}): {sec_clean}"))

    return {
        "slug": slug,
        "title": title,
        "category": str(category),
        "tags": tags,
        "summary": str(summary),
        "file_path": str(md_path),
        "sha256": sha256,
        "mtime": mtime,
        "updated_at": updated_at,
        "cards": cards,
        "raw": raw,
    }


def get_vault_state_signature(vault_dir: Path) -> str:
    """Compute a fast signature of git HEAD + max mtime + file count in vault/learnings."""
    learnings_dir = vault_dir / "learnings"
    head_sha = "none"
    if (vault_dir / ".git").exists():
        try:
            res = subprocess.run(
                ["git", "-C", str(vault_dir), "rev-parse", "HEAD"],
                capture_output=True,
                text=True,
                timeout=1.5,
            )
            if res.returncode == 0:
                head_sha = res.stdout.strip()
        except Exception:
            pass

    max_mtime = 0.0
    count = 0
    if learnings_dir.exists():
        for p in learnings_dir.rglob("*.md"):
            if "templates" in p.parts:
                continue
            count += 1
            try:
                mt = p.stat().st_mtime
                if mt > max_mtime:
                    max_mtime = mt
            except OSError:
                pass
    return f"{head_sha}:{count}:{max_mtime:.6f}"


def sync_index(conn: sqlite3.Connection, embedder: Any, vault_dir: Path, force: bool = False) -> dict[str, int]:
    """Incrementally index new or modified Markdown notes in vault/learnings."""
    learnings_dir = vault_dir / "learnings"
    learnings_dir.mkdir(parents=True, exist_ok=True)

    sig = get_vault_state_signature(vault_dir)
    if not force:
        row = conn.execute("SELECT value FROM meta WHERE key = 'vault_sig'").fetchone()
        if row and row["value"] == sig:
            return {"added": 0, "updated": 0, "removed": 0}

    existing_rows = conn.execute("SELECT slug, sha256 FROM notes").fetchall()
    existing_map = {r["slug"]: r["sha256"] for r in existing_rows}
    seen_slugs: set[str] = set()

    added = 0
    updated = 0
    removed = 0

    for md_path in sorted(learnings_dir.rglob("*.md")):
        if "templates" in md_path.parts or md_path.name.startswith("."):
            continue
        parsed = parse_markdown_note(md_path, learnings_dir)
        slug = parsed["slug"]
        seen_slugs.add(slug)

        if not force and slug in existing_map and existing_map[slug] == parsed["sha256"]:
            continue

        card_texts = [c[1] for c in parsed["cards"]]
        embeddings = list(embedder.embed(card_texts))

        if slug in existing_map:
            updated += 1
            conn.execute("DELETE FROM note_vectors WHERE slug = ?", (slug,))
        else:
            added += 1

        conn.execute(
            """
            INSERT OR REPLACE INTO notes
            (slug, title, category, tags_json, summary, file_path, sha256, mtime, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                slug,
                parsed["title"],
                parsed["category"],
                json.dumps(parsed["tags"]),
                parsed["summary"],
                parsed["file_path"],
                parsed["sha256"],
                parsed["mtime"],
                parsed["updated_at"],
            ),
        )

        for (sec_title, card_text), vec in zip(parsed["cards"], embeddings):
            arr = np.asarray(vec, dtype=np.float32)
            norm = np.linalg.norm(arr)
            if norm > 0:
                arr = arr / norm
            conn.execute(
                """
                INSERT INTO note_vectors (slug, section_title, index_card, vector_blob)
                VALUES (?, ?, ?, ?)
                """,
                (slug, sec_title, card_text, arr.tobytes()),
            )

    for old_slug in set(existing_map.keys()) - seen_slugs:
        conn.execute("DELETE FROM note_vectors WHERE slug = ?", (old_slug,))
        conn.execute("DELETE FROM notes WHERE slug = ?", (old_slug,))
        removed += 1

    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('vault_sig', ?)", (sig,))
    conn.commit()
    return {"added": added, "updated": updated, "removed": removed}


def search_notes(
    conn: sqlite3.Connection,
    embedder: Any,
    query: str,
    top_k: int = 3,
    category: str | None = None,
    tags: list[str] | None = None,
    min_score: float = 0.0,
) -> list[dict[str, Any]]:
    """Search Index-Card vectors in <5ms and return full Markdown files from disk."""
    q_vec = np.asarray(list(embedder.embed([query]))[0], dtype=np.float32)
    q_norm = np.linalg.norm(q_vec)
    if q_norm > 0:
        q_vec = q_vec / q_norm

    sql = """
        SELECT n.slug, n.title, n.category, n.tags_json, n.summary, n.file_path, n.updated_at,
               v.section_title, v.index_card, v.vector_blob
        FROM note_vectors v
        JOIN notes n ON n.slug = v.slug
    """
    params: list[Any] = []
    if category:
        sql += " WHERE n.category = ?"
        params.append(category)

    rows = conn.execute(sql, params).fetchall()
    if not rows:
        return []

    req_tags = {t.lower() for t in (tags or []) if t}
    best_by_slug: dict[str, dict[str, Any]] = {}

    for r in rows:
        note_tags = json.loads(r["tags_json"])
        if req_tags and not req_tags.intersection({str(t).lower() for t in note_tags}):
            continue
        vec = np.frombuffer(r["vector_blob"], dtype=np.float32)
        score = float(np.dot(q_vec, vec))
        if score < min_score:
            continue

        slug = r["slug"]
        if slug not in best_by_slug or score > best_by_slug[slug]["score"]:
            file_path = Path(r["file_path"])
            content = file_path.read_text(encoding="utf-8") if file_path.exists() else r["index_card"]
            best_by_slug[slug] = {
                "slug": slug,
                "title": r["title"],
                "category": r["category"],
                "tags": note_tags,
                "summary": r["summary"],
                "matched_section": r["section_title"],
                "score": round(score, 4),
                "updated_at": r["updated_at"],
                "file_path": str(file_path),
                "content": content,
            }

    ranked = sorted(best_by_slug.values(), key=lambda x: x["score"], reverse=True)
    return ranked[: max(1, top_k)]


if __name__ == "__main__":
    from fastembed import TextEmbedding

    engine_dir, vault_dir, db_path = get_paths()
    conn = connect_db(db_path)
    model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
    stats = sync_index(conn, model, vault_dir, force=True)
    print(f"Indexed Second Brain Vault ({vault_dir}): {stats}")
