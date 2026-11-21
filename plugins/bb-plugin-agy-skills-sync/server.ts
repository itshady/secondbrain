import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

const bbDataDir = process.env.BB_DATA_DIR || join(homedir(), ".bb");
const globalSkillsRoot = join(bbDataDir, "runtime", "global-skills");

export function syncAgySkills(): void {
  if (!existsSync(globalSkillsRoot)) return;
  const entries = readdirSync(globalSkillsRoot, { withFileTypes: true });
  let newestHash: string | null = null;
  let newestMtime = -1;

  for (const entry of entries) {
    if (entry.name === "current" || entry.name.startsWith(".")) continue;
    if (!entry.isDirectory()) continue;
    const skillsDir = join(globalSkillsRoot, entry.name, "skills");
    try {
      const mtime = statSync(skillsDir).mtimeMs;
      if (mtime > newestMtime) {
        newestMtime = mtime;
        newestHash = entry.name;
      }
    } catch {
      // ignore entries lacking readable skills subdir
    }
  }
  if (!newestHash) return;

  const currentLink = join(globalSkillsRoot, "current");
  const relativeTarget = join(newestHash, "skills");
  let existingTarget: string | null = null;
  try {
    existingTarget = readlinkSync(currentLink);
  } catch {
    // not present or not a link
  }

  if (existingTarget !== relativeTarget && existingTarget !== join(globalSkillsRoot, relativeTarget)) {
    try {
      rmSync(currentLink, { force: true });
    } catch {
      // ignore
    }
    symlinkSync(relativeTarget, currentLink);
  }

  const geminiConfigDir = join(homedir(), ".gemini", "config");
  const skillsConfigPath = join(geminiConfigDir, "skills.json");
  const entryPath = process.env.BB_DATA_DIR ? currentLink : "~/.bb/runtime/global-skills/current";
  const targetEntry = {
    path: entryPath,
    exclude: ["claude-code-provider", "codex-provider", "pi-provider"],
  };

  interface SkillsConfig {
    entries?: Array<{ path: string; exclude?: string[]; [key: string]: unknown }>;
    inherits?: unknown[];
    [key: string]: unknown;
  }

  let config: SkillsConfig = { entries: [] };
  let originalContent = "";
  if (existsSync(skillsConfigPath)) {
    try {
      originalContent = readFileSync(skillsConfigPath, "utf-8");
      config = JSON.parse(originalContent);
    } catch {
      config = { entries: [] };
    }
  }

  const entriesList = Array.isArray(config.entries) ? config.entries : (config.entries = []);
  const idx = entriesList.findIndex(
    (e) => e.path === entryPath || e.path === "~/.bb/runtime/global-skills/current" || e.path === currentLink,
  );
  if (idx >= 0) {
    entriesList[idx] = targetEntry;
  } else {
    entriesList.push(targetEntry);
  }

  const newContent = JSON.stringify(config, null, 2) + "\n";
  if (newContent !== originalContent) {
    mkdirSync(geminiConfigDir, { recursive: true });
    const tmpPath = join(geminiConfigDir, `skills.json.tmp.${process.pid}.${Date.now()}`);
    writeFileSync(tmpPath, newContent, "utf-8");
    renameSync(tmpPath, skillsConfigPath);
  }
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("bb-plugin-agy-skills-sync loaded");
  try {
    syncAgySkills();
  } catch (err) {
    bb.log.warn(`initial skills sync failed: ${err}`);
  }

  bb.background.service("skills-watcher", {
    async start(signal) {
      if (!existsSync(globalSkillsRoot)) {
        try {
          mkdirSync(globalSkillsRoot, { recursive: true });
        } catch {
          // ignore
        }
      }

      let timer: NodeJS.Timeout | null = null;
      let watcher: FSWatcher | null = null;
      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (watcher) {
          watcher.close();
          watcher = null;
        }
      };
      signal.addEventListener("abort", cleanup, { once: true });

      try {
        watcher = watch(globalSkillsRoot, () => {
          if (signal.aborted) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            if (!signal.aborted) {
              try {
                syncAgySkills();
              } catch (err) {
                bb.log.warn(`debounced skills sync failed: ${err}`);
              }
            }
          }, 1000);
        });
      } catch (err) {
        bb.log.warn(`failed to watch ${globalSkillsRoot}: ${err}`);
      }

      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          cleanup();
          resolve();
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            cleanup();
            resolve();
          },
          { once: true },
        );
      });
    },
  });

  bb.onDispose(() => {
    bb.log.info("bb-plugin-agy-skills-sync disposed");
  });
}
