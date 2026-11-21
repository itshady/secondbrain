#!/usr/bin/env bash
# Second Brain 1-Command Installer & Private Vault Linker (`setup.sh`)
# Usage:
#   ~/.secondbrain/setup.sh [--vault <git-url-or-path>]
set -euo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAULT_DIR="${SECONDBRAIN_VAULT:-$HOME/.secondbrain-vault}"
VAULT_REMOTE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault) VAULT_REMOTE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# Unlock engine permissions temporarily in case setup.sh is re-run
chmod -R u+w "$ENGINE_DIR" 2>/dev/null || true
chmod +x "$ENGINE_DIR"/bin/* "$ENGINE_DIR/setup.sh"

# Ensure CLAUDE.md -> AGENTS.md symlink in Engine
ln -sfn "AGENTS.md" "$ENGINE_DIR/CLAUDE.md"

echo "==> [1/6] Setting up Private Vault ($VAULT_DIR)..."
if [[ -n "$VAULT_REMOTE" && ! -d "$VAULT_DIR/.git" ]]; then
  git clone "$VAULT_REMOTE" "$VAULT_DIR"
elif [[ ! -d "$VAULT_DIR" ]]; then
  mkdir -p "$VAULT_DIR"/{learnings/database,projects,skills,invariants,config}
  git -C "$VAULT_DIR" init -b main >/dev/null
  cp "$ENGINE_DIR/templates/gitattributes" "$VAULT_DIR/.gitattributes"
  cp "$ENGINE_DIR/config/models.default.yaml" "$VAULT_DIR/config/models.yaml"
  if [[ ! -f "$VAULT_DIR/projects/secondbrain.md" ]]; then
    cat > "$VAULT_DIR/projects/secondbrain.md" <<EOF
---
name: "Second Brain Engine"
slug: "secondbrain"
repo_path: "$ENGINE_DIR"
default_branch: "main"
test_cmd: "$ENGINE_DIR/bin/secondbrain privacy-check"
---

# Project Charter: Second Brain Engine
Universal Chief of Staff & Local ONNX Second Brain operating system.
EOF
  fi
  git -C "$VAULT_DIR" add -A
  git -C "$VAULT_DIR" commit -m "vault: initialize private secondbrain vault" >/dev/null || true
fi

mkdir -p "$VAULT_DIR"/{learnings,projects,skills,invariants,config}
if [[ ! -f "$VAULT_DIR/.gitattributes" ]]; then
  cp "$ENGINE_DIR/templates/gitattributes" "$VAULT_DIR/.gitattributes"
fi
ln -sfn "$VAULT_DIR" "$ENGINE_DIR/vault"

# Set up ~/.secrets/ Central Hub (0 MB git overhead, chmod 700)
mkdir -p "$HOME/.secrets"
chmod 700 "$HOME/.secrets"
touch "$HOME/.secrets/global.env"
chmod 600 "$HOME/.secrets/global.env"

echo "==> [2/6] Setting up Python virtual environment & local ONNX dependencies..."
VENV_DIR="$ENGINE_DIR/.venv"
if command -v uv >/dev/null 2>&1; then
  if [[ ! -d "$VENV_DIR" ]]; then
    uv venv "$VENV_DIR" --python python3 >/dev/null
  fi
  uv pip install --python "$VENV_DIR/bin/python" -r "$ENGINE_DIR/mcp-server/requirements.txt" >/dev/null
else
  if [[ ! -d "$VENV_DIR" ]]; then
    python3 -m venv "$VENV_DIR"
  fi
  "$VENV_DIR/bin/pip" install --quiet --upgrade pip
  "$VENV_DIR/bin/pip" install --quiet -r "$ENGINE_DIR/mcp-server/requirements.txt"
fi

echo "==> [3/6] Warming local BAAI/bge-small-en-v1.5 ONNX model & indexing Private Vault..."
mkdir -p "$ENGINE_DIR/storage"
SECONDBRAIN_HOME="$ENGINE_DIR" SECONDBRAIN_VAULT="$VAULT_DIR" \
  "$VENV_DIR/bin/python" "$ENGINE_DIR/mcp-server/indexer.py"

echo "==> [4/6] Symlinking skills, global instructions & CLI adapters across harnesses..."
mkdir -p "$HOME/.local/bin"
for bin_script in "$ENGINE_DIR"/bin/*; do
  ln -sfn "$bin_script" "$HOME/.local/bin/$(basename "$bin_script")"
done

# Symlink skills (Public Engine core skills + Private Vault custom skills) into all harnesses
HARNESS_SKILL_DIRS=(
  "$HOME/.bb/skills"
  "$HOME/.claude/skills"
  "$HOME/.codex/skills"
  "$HOME/.pi/agent/skills"
  "$HOME/.gemini/antigravity-cli/skills"
)

for target_skills_dir in "${HARNESS_SKILL_DIRS[@]}"; do
  mkdir -p "$target_skills_dir"
  for skill_dir in "$ENGINE_DIR"/skills/*; do
    [[ -d "$skill_dir" ]] && ln -sfn "$skill_dir" "$target_skills_dir/$(basename "$skill_dir")"
  done
  for vault_skill_dir in "$VAULT_DIR"/skills/*; do
    [[ -d "$vault_skill_dir" ]] && ln -sfn "$vault_skill_dir" "$target_skills_dir/$(basename "$vault_skill_dir")"
  done
done

# Symlink global root AGENTS.md / CLAUDE.md instructions where supported
for instr_target in "$HOME/.bb/AGENTS.md" "$HOME/.codex/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"; do
  mkdir -p "$(dirname "$instr_target")"
  if [[ ! -f "$instr_target" || -L "$instr_target" ]]; then
    ln -sfn "$ENGINE_DIR/AGENTS.md" "$instr_target"
  fi
done
mkdir -p "$HOME/.claude"
if [[ ! -f "$HOME/.claude/CLAUDE.md" || -L "$HOME/.claude/CLAUDE.md" ]]; then
  ln -sfn "$ENGINE_DIR/AGENTS.md" "$HOME/.claude/CLAUDE.md"
fi

echo "==> [5/6] Registering bin/secondbrain-mcp in harness MCP configs..."
"$VENV_DIR/bin/python" - "$ENGINE_DIR/bin/secondbrain-mcp" <<'PYEOF'
import json, re, sys
from pathlib import Path

mcp_bin = sys.argv[1]
home = Path.home()

json_configs = [
    home / ".gemini" / "config" / "mcp_config.json",
    home / ".cursor" / "mcp.json",
    home / ".claude.json",
]

for cfg_path in json_configs:
    try:
        if cfg_path.exists():
            raw = cfg_path.read_text(encoding="utf-8").strip()
            data = json.loads(raw) if raw else {}
        elif cfg_path.name in ("mcp.json", "mcp_config.json"):
            cfg_path.parent.mkdir(parents=True, exist_ok=True)
            data = {}
        else:
            continue
        servers = data.setdefault("mcpServers", {})
        servers["secondbrain"] = {"command": mcp_bin, "args": []}
        cfg_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    except Exception:
        pass

codex_toml = home / ".codex" / "config.toml"
if codex_toml.exists():
    try:
        text = codex_toml.read_text(encoding="utf-8")
        section = f'[mcp_servers.secondbrain]\nargs = []\ncommand = "{mcp_bin}"\n'
        pattern = re.compile(r"^\[mcp_servers\.secondbrain\]\n(?:(?!\[).*\n)*", re.MULTILINE)
        if pattern.search(text):
            text = pattern.sub(section, text)
        else:
            text = text.rstrip() + "\n\n" + section
        codex_toml.write_text(text, encoding="utf-8")
    except Exception:
        pass
PYEOF

if command -v bb >/dev/null 2>&1; then
  bb plugin enable bb--mcp >/dev/null 2>&1 || true

  installed_plugins="$(bb plugin list 2>/dev/null || true)"
  for pdir in "$ENGINE_DIR/plugins"/* "$VAULT_DIR/plugins"/*; do
    [[ -f "$pdir/package.json" ]] || continue
    plugin_id="$(python3 -c "import json, sys, re; name = json.load(open(sys.argv[1])).get('name', ''); name = re.sub(r'^@[^/]+/', '', name); print(re.sub(r'^bb-plugin-', '', name))" "$pdir/package.json" 2>/dev/null || true)"
    [[ -n "$plugin_id" ]] || continue
    if ! echo "$installed_plugins" | grep -E -q "^${plugin_id}(@|[[:space:]])"; then
      if [[ ! -d "$pdir/node_modules" ]]; then
        npm --prefix "$pdir" install --no-audit --no-fund || true
      fi
      (bb plugin build "$pdir" && bb plugin install --yes "$pdir") || true
    fi
  done

  if bb plugin list 2>/dev/null | grep -E -q "^unified-usage(@|[[:space:]])"; then
    hidden_footer="$(bb settings ui get sidebar.hiddenFooterItems 2>/dev/null | tr -d '[:space:]' || true)"
    if [[ "$hidden_footer" == "[]" ]]; then
      bb settings ui set sidebar.hiddenFooterItems '["plugin:bb--provider-usage/usage"]' >/dev/null 2>&1 || true
      bb settings ui set sidebar.footerOrder '["builtin:mobile","plugin:unified-usage/unified-usage","plugin:automations-popover/automations-popover","builtin:report-bug"]' >/dev/null 2>&1 || true
    fi
  fi

  vault_proj_id="$( (bb project list --json 2>/dev/null || true) | python3 -c 'import json, sys, os
try:
    ps = json.load(sys.stdin)
except Exception:
    ps = []
v = os.path.abspath(sys.argv[1])
print(next((p["id"] for p in ps if isinstance(p, dict) for s in p.get("sources", []) if os.path.abspath(s.get("path", "")) == v), ""))' "$VAULT_DIR" 2>/dev/null || true)"

  if [[ -z "$vault_proj_id" ]]; then
    vault_proj_id="$( (bb project create --name "Second Brain Vault" --root "$VAULT_DIR" --json 2>/dev/null || true) | python3 -c 'import json, sys
try:
    res = json.load(sys.stdin)
except Exception:
    res = {}
print(res.get("id", "") if isinstance(res, dict) else "")' 2>/dev/null || true)"
  fi

  if [[ -n "$vault_proj_id" ]]; then
    has_janitor="$( (bb automation list --project "$vault_proj_id" --json 2>/dev/null || true) | python3 -c 'import json, sys
try:
    autos = json.load(sys.stdin)
except Exception:
    autos = []
print("yes" if any(isinstance(a, dict) and a.get("name") == "Weekly Second Brain Janitor" for a in autos) else "")' 2>/dev/null || true)"

    if [[ -z "$has_janitor" ]]; then
      local_tz="$(readlink /etc/localtime 2>/dev/null | sed -n 's|.*zoneinfo/||p' || true)"
      [[ -z "$local_tz" ]] && local_tz="UTC"

      janitor_prompt='Use the bb skill "janitor".

Run the weekly Second Brain Vault cleanup:
1. Run `secondbrain compact` (or call `memory_compact`) to find overlapping learning clusters (>0.85 similarity).
2. For any overlapping clusters, synthesize them into one crisp canonical note via `memory_record(action="update_existing")` and delete redundant notes via `memory_record(action="delete")`. Also quickly scan `~/.secondbrain-vault/learnings/` for obviously outdated or low-signal notes and prune/refine them.
3. Run `secondbrain prune` to clean up any crashed/already-merged worktrees.
4. Report a 1-line summary via `secondbrain report --task "weekly-janitor" --project "secondbrain" --status "ok" --summary "<summary>"`, and finally run `bb thread archive --self` so weekly runs do not bloat the sidebar.'

      bb automation create \
        --project "$vault_proj_id" \
        --name "Weekly Second Brain Janitor" \
        --cron "0 20 * * 0" \
        --timezone "$local_tz" \
        --provider acp-antigravity \
        --model gemini-3.8-flash \
        --reasoning low \
        --environment "$VAULT_DIR" \
        --prompt "$janitor_prompt" >/dev/null 2>&1 || true
    fi
  fi
fi

echo "==> [6/6] Installing Vault-Aware Privacy & Judge Git Hooks & locking Public Engine read-only..."
if [[ -d "$ENGINE_DIR/.git" ]]; then
  mkdir -p "$ENGINE_DIR/.git/hooks"
  cat > "$ENGINE_DIR/.git/hooks/pre-commit" <<HOOKEOF
#!/usr/bin/env bash
exec "$ENGINE_DIR/bin/secondbrain" privacy-check
HOOKEOF
  cat > "$ENGINE_DIR/.git/hooks/pre-push" <<HOOKEOF
#!/usr/bin/env bash
exec "$ENGINE_DIR/bin/secondbrain" judge-verify
HOOKEOF
  chmod +x "$ENGINE_DIR/.git/hooks/pre-commit" "$ENGINE_DIR/.git/hooks/pre-push"
fi

chmod -R a-w "$ENGINE_DIR/skills" "$ENGINE_DIR/invariants" "$ENGINE_DIR/mcp-server" "$ENGINE_DIR/bin"

echo ""
echo "✅ Second Brain OS installed and active!"
echo "   • Public Engine (Read-Only): $ENGINE_DIR"
echo "   • Private Vault (Read/Write): $VAULT_DIR"
echo "   • CLI Supervisor:             ~/.local/bin/secondbrain"
