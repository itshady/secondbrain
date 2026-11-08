#!/usr/bin/env python3
"""
Second Brain Background Daemon (`secondbraind`).
Listens on `~/.secondbrain/daemon.sock`, holds the single 67MB ONNX embedding model in RAM,
serializes SQLite WAL operations, and manages non-blocking Private Vault Git syncs.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

import yaml
from fastembed import TextEmbedding

from indexer import check_safety, connect_db, get_paths, search_notes, sync_index
from janitor import find_duplicate_clusters

IDLE_TIMEOUT_SECONDS = 7200  # 2 hours


def slugify(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", text.lower()).strip("-")
    return s[:64] or "note"


def async_vault_git_sync(vault_dir: Path, commit_msg: str) -> None:
    """Spawn a detached non-blocking git commit + pull --rebase + push inside Private Vault."""
    if not (vault_dir / ".git").exists():
        return
    cmd = (
        f"git -C { json.dumps(str(vault_dir)) } add -A && "
        f"(git -C { json.dumps(str(vault_dir)) } diff --cached --quiet || "
        f"git -C { json.dumps(str(vault_dir)) } commit -m { json.dumps(commit_msg) }) && "
        f"(git -C { json.dumps(str(vault_dir)) } remote get-url origin >/dev/null 2>&1 && "
        f"git -C { json.dumps(str(vault_dir)) } pull --rebase --autostash origin main >/dev/null 2>&1 && "
        f"git -C { json.dumps(str(vault_dir)) } push origin main >/dev/null 2>&1 || true)"
    )
    subprocess.Popen(
        cmd,
        shell=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def async_vault_git_pull(vault_dir: Path) -> None:
    """Spawn a non-blocking git pull --rebase on daemon startup."""
    if not (vault_dir / ".git").exists():
        return
    cmd = (
        f"git -C { json.dumps(str(vault_dir)) } remote get-url origin >/dev/null 2>&1 && "
        f"git -C { json.dumps(str(vault_dir)) } pull --rebase --autostash origin main >/dev/null 2>&1 || true"
    )
    subprocess.Popen(
        cmd,
        shell=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


class SecondBrainDaemon:
    def __init__(self) -> None:
        self.engine_dir, self.vault_dir, self.db_path = get_paths()
        self.sock_path = self.engine_dir / "daemon.sock"
        self.pid_path = self.engine_dir / "daemon.pid"
        self.conn = connect_db(self.db_path)
        self.lock = threading.Lock()
        self.last_activity = time.time()
        self.running = True

        # Load single shared ONNX model in RAM (capped threads for low CPU footprint)
        self.embedder = TextEmbedding(model_name="BAAI/bge-small-en-v1.5", threads=2)
        with self.lock:
            sync_index(self.conn, self.embedder, self.vault_dir, force=False)
        async_vault_git_pull(self.vault_dir)

    def handle_request(self, req: dict[str, Any]) -> dict[str, Any]:
        self.last_activity = time.time()
        method = req.get("method", "")
        params = req.get("params") or {}

        try:
            with self.lock:
                if method == "ping":
                    return {"ok": True, "result": {"status": "alive", "vault": str(self.vault_dir)}}

                if method == "memory_search":
                    sync_index(self.conn, self.embedder, self.vault_dir, force=False)
                    results = search_notes(
                        self.conn,
                        self.embedder,
                        query=str(params.get("query", "")),
                        top_k=int(params.get("top_k", 3)),
                        category=params.get("category") or None,
                        tags=params.get("tags") or [],
                    )
                    return {"ok": True, "result": results}

                if method == "memory_record":
                    return {"ok": True, "result": self._handle_memory_record(params)}

                if method == "memory_compact":
                    sync_index(self.conn, self.embedder, self.vault_dir, force=False)
                    threshold = float(params.get("threshold", 0.85))
                    clusters = find_duplicate_clusters(self.conn, threshold=threshold)
                    return {"ok": True, "result": clusters}

                if method == "get_invariants":
                    return {"ok": True, "result": self._handle_get_invariants(params.get("domain", "general"))}

                if method == "roster_status":
                    return {"ok": True, "result": self._handle_roster_status(params.get("project"))}

                if method == "roster_upsert":
                    return {"ok": True, "result": self._handle_roster_upsert(params)}

                if method == "roster_report":
                    return {"ok": True, "result": self._handle_roster_report(params)}

                return {"ok": False, "error": f"Unknown method: {method}"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def _handle_memory_record(self, params: dict[str, Any]) -> dict[str, Any]:
        action = str(params.get("action", "check")).lower()
        title = str(params.get("title", "")).strip()
        summary = str(params.get("summary", "")).strip()
        details = str(params.get("details", "")).strip()
        category = slugify(str(params.get("category") or "general"))
        tags = params.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        target_slug = str(params.get("target_slug") or "").strip()

        sync_index(self.conn, self.embedder, self.vault_dir, force=False)

        if action == "check":
            query_str = f"{title}. {summary}. {' '.join(str(t) for t in tags)}".strip()
            candidates = search_notes(
                self.conn,
                self.embedder,
                query=query_str,
                top_k=3,
                min_score=0.75,
            )
            return {
                "action": "check",
                "candidates": candidates,
                "instruction": (
                    "Review candidates above. If an existing note covers this topic (>0.80 similarity), "
                    "call memory_record(action='update_existing', target_slug='<slug>', ...). "
                    "If this is a genuinely new cross-project topic, call memory_record(action='create_new', ...)."
                ),
            }

        if action == "delete":
            slug_to_del = target_slug or f"{category}/{slugify(title)}"
            md_path = self.vault_dir / "learnings" / f"{slug_to_del}.md"
            if not md_path.exists():
                return {"status": "not_found", "slug": slug_to_del}
            md_path.unlink()
            sync_index(self.conn, self.embedder, self.vault_dir, force=True)
            async_vault_git_sync(self.vault_dir, f"vault: delete obsolete note {slug_to_del}")
            return {"status": "deleted", "slug": slug_to_del}

        if action in ("create_new", "update_existing"):
            combined_text = f"{title}\n{summary}\n{details}"
            safe, reason = check_safety(combined_text)
            if not safe:
                return {"status": "rejected_by_safety_linter", "reason": reason}

            if action == "update_existing" and target_slug:
                rel_slug = target_slug.removesuffix(".md")
                if "/" in rel_slug:
                    category = rel_slug.split("/", 1)[0]
            else:
                rel_slug = f"{category}/{slugify(title)}"

            md_path = self.vault_dir / "learnings" / f"{rel_slug}.md"
            md_path.parent.mkdir(parents=True, exist_ok=True)

            today = time.strftime("%Y-%m-%d")
            frontmatter = {
                "title": title or rel_slug.split("/")[-1].replace("-", " ").title(),
                "category": category,
                "tags": list(tags),
                "summary": summary,
                "updated_at": today,
            }
            fm_yaml = yaml.safe_dump(frontmatter, sort_keys=False).strip()
            full_md = f"---\n{fm_yaml}\n---\n\n{details.strip()}\n"
            md_path.write_text(full_md, encoding="utf-8")

            sync_index(self.conn, self.embedder, self.vault_dir, force=True)
            verb = "update" if action == "update_existing" else "add"
            async_vault_git_sync(self.vault_dir, f"vault: {verb} {rel_slug}")
            return {"status": "saved", "action": action, "slug": rel_slug, "file_path": str(md_path)}

        raise ValueError(f"Unsupported memory_record action: {action}")

    def _handle_get_invariants(self, domain: str) -> dict[str, Any]:
        result: dict[str, str] = {}
        for root_label, inv_dir in [
            ("engine", self.engine_dir / "invariants"),
            ("vault", self.vault_dir / "invariants"),
        ]:
            if not inv_dir.exists():
                continue
            for md in sorted(inv_dir.glob("*.md")):
                if domain in ("general", "all") or domain.lower() in md.stem.lower():
                    result[f"{root_label}/{md.name}"] = md.read_text(encoding="utf-8")
        return result

    def _handle_roster_status(self, project_filter: str | None) -> dict[str, Any]:
        projects_dir = self.vault_dir / "projects"
        projects: list[dict[str, Any]] = []
        if projects_dir.exists():
            for md in sorted(projects_dir.glob("*.md")):
                raw = md.read_text(encoding="utf-8")
                fm: dict[str, Any] = {}
                if raw.startswith("---\n"):
                    parts = raw.split("\n---\n", 1)
                    if len(parts) == 2:
                        try:
                            fm = yaml.safe_load(parts[0][4:]) or {}
                        except Exception:
                            fm = {}
                slug = fm.get("slug") or md.stem
                if project_filter and project_filter.lower() not in slug.lower():
                    continue
                repo_path = os.path.expanduser(str(fm.get("repo_path", "")))
                active_worktrees: list[str] = []
                wt_root = Path(repo_path) / ".worktrees" if repo_path else None
                if wt_root and wt_root.exists():
                    active_worktrees = [d.name for d in sorted(wt_root.iterdir()) if d.is_dir()]
                projects.append(
                    {
                        "slug": slug,
                        "name": fm.get("name", slug),
                        "repo_path": repo_path,
                        "default_branch": fm.get("default_branch", "main"),
                        "test_cmd": fm.get("test_cmd", ""),
                        "active_worktrees_on_disk": active_worktrees,
                        "charter_file": str(md),
                    }
                )

        # Check live PIDs in roster
        rows = self.conn.execute("SELECT * FROM roster ORDER BY updated_at DESC LIMIT 30").fetchall()
        workers: list[dict[str, Any]] = []
        for r in rows:
            item = dict(r)
            if project_filter and project_filter.lower() not in item["project"].lower():
                continue
            pid = item.get("pid")
            if item["status"] == "running" and pid:
                try:
                    os.kill(int(pid), 0)
                except OSError:
                    if not Path(item["worktree_path"]).exists():
                        item["status"] = "completed"
                    else:
                        item["status"] = "stale_pid"
                    self.conn.execute(
                        "UPDATE roster SET status = ?, updated_at = ? WHERE task_id = ?",
                        (item["status"], time.time(), item["task_id"]),
                    )
            workers.append(item)

        unread_rows = self.conn.execute(
            "SELECT * FROM events WHERE read = 0 ORDER BY created_at DESC LIMIT 20"
        ).fetchall()
        unread_events = [dict(r) for r in unread_rows]
        if unread_events:
            self.conn.execute("UPDATE events SET read = 1 WHERE read = 0")
        self.conn.commit()

        note_count = self.conn.execute("SELECT COUNT(*) AS c FROM notes").fetchone()["c"]
        return {
            "registered_projects": projects,
            "workers": workers,
            "unread_completion_events": unread_events,
            "total_indexed_learnings": note_count,
            "vault_path": str(self.vault_dir),
        }

    def _handle_roster_upsert(self, params: dict[str, Any]) -> dict[str, Any]:
        now = time.time()
        task_id = str(params["task_id"])
        self.conn.execute(
            """
            INSERT OR REPLACE INTO roster
            (task_id, project, repo_path, worktree_path, branch, role, tier, harness, pid, thread_id, status, summary, started_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT started_at FROM roster WHERE task_id = ?), ?), ?)
            """,
            (
                task_id,
                str(params.get("project", "default")),
                str(params.get("repo_path", "")),
                str(params.get("worktree_path", "")),
                str(params.get("branch", "")),
                str(params.get("role", "architect")),
                str(params.get("tier", "light")),
                str(params.get("harness", "cli")),
                params.get("pid"),
                params.get("thread_id"),
                str(params.get("status", "running")),
                str(params.get("summary", "")),
                task_id,
                now,
                now,
            ),
        )
        self.conn.commit()
        return {"task_id": task_id, "status": params.get("status", "running")}

    def _handle_roster_report(self, params: dict[str, Any]) -> dict[str, Any]:
        now = time.time()
        task_id = str(params.get("task_id", "unknown"))
        status = str(params.get("status", "ok"))
        summary = str(params.get("summary", ""))
        project = str(params.get("project", "default"))

        self.conn.execute(
            "UPDATE roster SET status = ?, summary = ?, updated_at = ? WHERE task_id = ?",
            (status, summary, now, task_id),
        )
        self.conn.execute(
            "INSERT INTO events (task_id, project, status, summary, created_at, read) VALUES (?, ?, ?, ?, ?, 0)",
            (task_id, project, status, summary, now),
        )
        self.conn.commit()
        return {"reported": True, "task_id": task_id, "status": status}

    def serve_forever(self) -> None:
        if self.sock_path.exists():
            try:
                self.sock_path.unlink()
            except OSError:
                pass

        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(str(self.sock_path))
        os.chmod(str(self.sock_path), 0o600)
        server.listen(32)
        server.settimeout(5.0)
        self.pid_path.write_text(str(os.getpid()), encoding="utf-8")

        def shutdown_handler(signum: int, frame: Any) -> None:
            self.running = False

        signal.signal(signal.SIGTERM, shutdown_handler)
        signal.signal(signal.SIGINT, shutdown_handler)

        try:
            while self.running:
                if time.time() - self.last_activity > IDLE_TIMEOUT_SECONDS:
                    break
                try:
                    conn_sock, _ = server.accept()
                except socket.timeout:
                    continue
                except OSError:
                    break
                threading.Thread(target=self._handle_client, args=(conn_sock,), daemon=True).start()
        finally:
            try:
                server.close()
            except Exception:
                pass
            if self.sock_path.exists():
                try:
                    self.sock_path.unlink()
                except OSError:
                    pass
            if self.pid_path.exists():
                try:
                    self.pid_path.unlink()
                except OSError:
                    pass

    def _handle_client(self, conn_sock: socket.socket) -> None:
        try:
            data = b""
            while True:
                chunk = conn_sock.recv(65536)
                if not chunk:
                    break
                data += chunk
                if b"\n" in data:
                    break
            if not data:
                return
            req = json.loads(data.decode("utf-8").strip())
            resp = self.handle_request(req)
            conn_sock.sendall((json.dumps(resp) + "\n").encode("utf-8"))
        except Exception as exc:
            try:
                conn_sock.sendall((json.dumps({"ok": False, "error": str(exc)}) + "\n").encode("utf-8"))
            except Exception:
                pass
        finally:
            conn_sock.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Second Brain UNIX socket daemon (secondbraind)")
    parser.add_argument("--daemonize", action="store_true", help="Run detached in the background")
    args = parser.parse_args()

    if args.daemonize:
        engine_dir, _, _ = get_paths()
        log_path = engine_dir / "daemon.log"
        with open(log_path, "ab") as log_f:
            subprocess.Popen(
                [sys.executable, str(Path(__file__).resolve())],
                stdout=log_f,
                stderr=log_f,
                stdin=subprocess.DEVNULL,
                start_new_session=True,
            )
        return

    daemon = SecondBrainDaemon()
    daemon.serve_forever()


if __name__ == "__main__":
    main()
