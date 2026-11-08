#!/usr/bin/env python3
"""
Stage 1 Deterministic Vector Compaction Engine (`janitor.py`).
Scans all canonical notes in `storage/memory.db` and returns pairs/clusters
with cosine similarity > 0.85 for the Stage 2 Janitor agent to merge.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import numpy as np


def find_duplicate_clusters(conn: sqlite3.Connection, threshold: float = 0.85) -> list[dict[str, Any]]:
    """Compute pairwise cosine similarities across primary Index Cards and return clusters > threshold."""
    rows = conn.execute(
        """
        SELECT n.slug, n.title, n.category, n.tags_json, n.summary, n.file_path,
               v.vector_blob
        FROM notes n
        JOIN note_vectors v ON v.slug = n.slug
        GROUP BY n.slug
        """
    ).fetchall()

    if len(rows) < 2:
        return []

    items = []
    vecs = []
    for r in rows:
        fp = Path(r["file_path"])
        items.append(
            {
                "slug": r["slug"],
                "title": r["title"],
                "category": r["category"],
                "tags": json.loads(r["tags_json"]),
                "summary": r["summary"],
                "file_path": str(fp),
                "content": fp.read_text(encoding="utf-8") if fp.exists() else "",
            }
        )
        vecs.append(np.frombuffer(r["vector_blob"], dtype=np.float32))

    mat = np.vstack(vecs)
    sim_matrix = np.matmul(mat, mat.T)

    clusters: list[dict[str, Any]] = []
    n = len(items)
    for i in range(n):
        for j in range(i + 1, n):
            sim = float(sim_matrix[i, j])
            if sim >= threshold:
                clusters.append(
                    {
                        "similarity": round(sim, 4),
                        "note_a": items[i],
                        "note_b": items[j],
                    }
                )

    clusters.sort(key=lambda c: c["similarity"], reverse=True)
    return clusters
