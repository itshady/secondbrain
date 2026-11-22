#!/usr/bin/env python3
"""
Featherweight MCP Server & RPC Client (`server.py`).
Connects to `~/.secondbrain/daemon.sock` (<10MB RAM).
If `secondbraind` is not running, lazy-starts it using `fcntl.flock` in <200ms.
Also supports CLI invocations (`python server.py --rpc <method> '<json_params>'`).
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


def get_engine_dir() -> Path:
    return Path(os.environ.get("SECONDBRAIN_HOME", Path.home() / ".secondbrain")).resolve()


def _send_socket_rpc(sock_path: Path, method: str, params: dict[str, Any], timeout: float = 15.0) -> dict[str, Any]:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(str(sock_path))
        payload = json.dumps({"method": method, "params": params}) + "\n"
        s.sendall(payload.encode("utf-8"))
        buf = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
            if b"\n" in buf:
                break
        return json.loads(buf.decode("utf-8").strip())
    finally:
        s.close()


def ensure_daemon_and_call(method: str, params: dict[str, Any] | None = None) -> Any:
    """Send RPC to `secondbraind`, auto-spawning the daemon with `flock` if unreachable."""
    engine_dir = get_engine_dir()
    sock_path = engine_dir / "daemon.sock"
    lock_path = engine_dir / "daemon.lock"
    params = params or {}

    try:
        resp = _send_socket_rpc(sock_path, method, params)
        if not resp.get("ok"):
            raise RuntimeError(resp.get("error", "Daemon RPC error"))
        return resp["result"]
    except (FileNotFoundError, ConnectionRefusedError, socket.error):
        pass

    # Acquire exclusive flock to spawn `secondbraind` once
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "w") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            # Double-check if another client already started it
            try:
                resp = _send_socket_rpc(sock_path, "ping", {}, timeout=1.0)
                if resp.get("ok"):
                    resp2 = _send_socket_rpc(sock_path, method, params)
                    return resp2["result"]
            except Exception:
                pass

            daemon_script = Path(__file__).resolve().parent / "daemon.py"
            log_path = engine_dir / "daemon.log"
            with open(log_path, "ab") as log_f:
                subprocess.Popen(
                    [sys.executable, str(daemon_script)],
                    stdout=log_f,
                    stderr=log_f,
                    stdin=subprocess.DEVNULL,
                    start_new_session=True,
                )

            deadline = time.time() + 20.0
            while time.time() < deadline:
                try:
                    resp = _send_socket_rpc(sock_path, "ping", {}, timeout=1.0)
                    if resp.get("ok"):
                        break
                except Exception:
                    time.sleep(0.08)
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    resp = _send_socket_rpc(sock_path, method, params)
    if not resp.get("ok"):
        raise RuntimeError(resp.get("error", "Daemon RPC error"))
    return resp["result"]


def run_mcp_server() -> None:
    try:
        from mcp.server.mcpserver import MCPServer
    except ImportError:
        from mcp.server.fastmcp import FastMCP as MCPServer

        run_stdio = None
    else:
        import anyio
        from mcp.server.stdio import stdio_server
        from mcp.shared.message import SessionMessage
        from mcp.types import JSONRPCError, JSONRPCRequest, JSONRPCResponse

        async def run_stdio() -> None:
            # MCP 2.x cancels pending requests at EOF. Give piped clients a
            # bounded window to receive responses after closing their input.
            pending = set()
            input_closed = False
            drained = anyio.Event()
            input_send, input_receive = anyio.create_memory_object_stream(0)
            output_send, output_receive = anyio.create_memory_object_stream(0)

            async def receive_requests() -> None:
                nonlocal input_closed
                async with input_send:
                    async for item in reader:
                        if isinstance(item, SessionMessage) and isinstance(item.message, JSONRPCRequest):
                            pending.add(item.message.id)
                        await input_send.send(item)
                    input_closed = True
                    if pending:
                        with anyio.move_on_after(1):
                            await drained.wait()

            async def send_responses() -> None:
                async with output_receive, writer:
                    async for item in output_receive:
                        await writer.send(item)
                        if isinstance(item.message, (JSONRPCResponse, JSONRPCError)):
                            pending.discard(item.message.id)
                            if input_closed and not pending:
                                drained.set()

            async with stdio_server() as (reader, writer), anyio.create_task_group() as tasks:
                tasks.start_soon(receive_requests)
                tasks.start_soon(send_responses)
                server = mcp._lowlevel_server
                await server.run(input_receive, output_send, server.create_initialization_options())

    mcp = MCPServer("secondbrain")

    @mcp.tool()
    def memory_search(
        query: str,
        top_k: int = 3,
        category: str | None = None,
        tags: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Search the Second Brain Index-Card vector database (<5ms) and return full Markdown learnings."""
        return ensure_daemon_and_call(
            "memory_search",
            {"query": query, "top_k": top_k, "category": category, "tags": tags or []},
        )

    @mcp.tool()
    def memory_record(
        action: str = "check",
        title: str = "",
        summary: str = "",
        details: str = "",
        category: str = "general",
        tags: list[str] | None = None,
        target_slug: str | None = None,
    ) -> dict[str, Any]:
        """
        Self-healing Second Brain Editorial Gate:
        - action='check': Scan for existing notes (>0.75 similarity) before writing.
        - action='update_existing': Refine an existing canonical note (`target_slug`).
        - action='create_new': Create a new canonical learning (`## Trigger`, `## Root Cause`, `## Permanent Invariant`).
        - action='delete': Delete an obsolete note (`target_slug`) via `git rm`.
        """
        return ensure_daemon_and_call(
            "memory_record",
            {
                "action": action,
                "title": title,
                "summary": summary,
                "details": details,
                "category": category,
                "tags": tags or [],
                "target_slug": target_slug,
            },
        )

    @mcp.tool()
    def memory_compact(threshold: float = 0.85) -> list[dict[str, Any]]:
        """Return clusters of overlapping notes (>0.85 similarity) for the Janitor agent to merge."""
        return ensure_daemon_and_call("memory_compact", {"threshold": threshold})

    @mcp.tool()
    def get_invariants(domain: str = "general") -> dict[str, str]:
        """Return active engineering, delegation, and PR invariants from Public Engine + Private Vault."""
        return ensure_daemon_and_call("get_invariants", {"domain": domain})

    @mcp.tool()
    def roster_status(project: str | None = None) -> dict[str, Any]:
        """Recover all registered projects, active worktrees/workers, and unread completion events in <5ms."""
        return ensure_daemon_and_call("roster_status", {"project": project})

    if run_stdio is None:
        mcp.run()
    else:
        anyio.run(run_stdio)


def main() -> None:
    parser = argparse.ArgumentParser(description="Second Brain MCP Server & RPC Client")
    parser.add_argument("--rpc", type=str, help="Execute a single RPC method and print JSON result")
    parser.add_argument("--params", type=str, default="{}", help="JSON parameters for --rpc")
    args = parser.parse_args()

    if args.rpc:
        params = json.loads(args.params)
        res = ensure_daemon_and_call(args.rpc, params)
        print(json.dumps(res, indent=2))
        return

    run_mcp_server()


if __name__ == "__main__":
    main()
