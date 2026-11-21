import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 20_000;

export const triggerSchema = z.object({
  triggerType: z.string(),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  at: z.string().optional(),
});

export const normalizedAutomationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  trigger: triggerSchema,
  nextRunAt: z.union([z.string(), z.number()]).nullable().optional(),
  lastRunAt: z.union([z.string(), z.number()]).nullable().optional(),
  lastRunStatus: z.string().nullable().optional(),
  model: z.string().optional(),
  mode: z.string().default("unknown"),
});

export type Trigger = z.infer<typeof triggerSchema>;
export type NormalizedAutomation = z.infer<typeof normalizedAutomationSchema>;

export const rpcContract = defineRpcContract({
  listAutomations: {
    input: z.object({}),
    output: z.object({
      automations: z.array(normalizedAutomationSchema),
    }),
  },
  toggleAutomation: {
    input: z.object({
      id: z.string(),
      projectId: z.string(),
      enabled: z.boolean(),
    }),
    output: z.object({
      ok: z.boolean(),
      error: z.string().optional(),
    }),
  },
  updateSchedule: {
    input: z.object({
      id: z.string(),
      projectId: z.string(),
      cron: z.string().optional(),
      timezone: z.string().optional(),
      at: z.string().optional(),
    }),
    output: z.object({
      ok: z.boolean(),
      error: z.string().optional(),
    }),
  },
  runNow: {
    input: z.object({
      id: z.string(),
      projectId: z.string(),
    }),
    output: z.object({
      ok: z.boolean(),
      error: z.string().optional(),
    }),
  },
});

function resolveBbBin(): string {
  const candidates = [
    process.env.BB_BIN,
    "/usr/local/bin/bb",
    "/opt/homebrew/bin/bb",
    "/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb",
    join(homedir(), ".local", "bin", "bb"),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "bb";
}

function getExecutionEnv(): Record<string, string> {
  const extraPaths = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".local", "bin"),
  ];
  const currentPath = process.env.PATH ?? "";
  const mergedPath = [...extraPaths, currentPath].filter(Boolean).join(":");
  return {
    ...process.env,
    PATH: mergedPath,
  } as Record<string, string>;
}

async function execBb(args: string[]): Promise<string> {
  const bin = resolveBbBin();
  const env = getExecutionEnv();
  const { stdout } = await execFileAsync(bin, args, {
    timeout: TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    env,
  });
  return stdout;
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("automations-popover loaded");

  bb.rpc.register(rpcContract, {
    listAutomations: async () => {
      let projects: Array<{ id: string; name: string }> = [];

      try {
        const res = await bb.sdk.projects.list({ includePersonal: true });
        if (Array.isArray(res)) {
          projects = res.map((p) => ({ id: p.id, name: p.name || p.id }));
        }
      } catch (err: unknown) {
        bb.log.warn(`bb.sdk.projects.list failed, falling back to CLI: ${String(err)}`);
        try {
          const stdout = await execBb(["project", "list", "--include-personal", "--json"]);
          const parsed = JSON.parse(stdout);
          if (Array.isArray(parsed)) {
            projects = parsed.map((p) => ({ id: p.id, name: p.name || p.id }));
          }
        } catch (cliErr: unknown) {
          bb.log.warn(`project list CLI fallback failed: ${String(cliErr)}`);
        }
      }

      if (projects.length === 0) {
        return { automations: [] };
      }

      const results = await Promise.all(
        projects.map(async (project) => {
          try {
            const stdout = await execBb(["automation", "list", "--project", project.id, "--json"]);
            const parsed = JSON.parse(stdout);
            if (!Array.isArray(parsed)) return [];

            return parsed.map((item: any): NormalizedAutomation => {
              const triggerObj = item.trigger ?? {};
              const execObj = item.execution ?? {};
              return {
                id: String(item.id),
                projectId: project.id,
                projectName: project.name,
                name: String(item.name || item.id),
                enabled: Boolean(item.enabled),
                trigger: {
                  triggerType: String(triggerObj.triggerType ?? "schedule"),
                  cron: triggerObj.cron ? String(triggerObj.cron) : undefined,
                  timezone: triggerObj.timezone ? String(triggerObj.timezone) : undefined,
                  at: triggerObj.at ? String(triggerObj.at) : undefined,
                },
                nextRunAt: item.nextRunAt ?? null,
                lastRunAt: item.lastRunAt ?? null,
                lastRunStatus: item.lastRunStatus ? String(item.lastRunStatus) : null,
                model: execObj.model ? String(execObj.model) : undefined,
                mode: String(execObj.mode ?? "script"),
              };
            });
          } catch (err: unknown) {
            bb.log.warn(`failed to list automations for project ${project.id}: ${String(err)}`);
            return [];
          }
        }),
      );

      const automations = results.flat();
      automations.sort((a, b) => {
        const pCmp = a.projectName.localeCompare(b.projectName);
        if (pCmp !== 0) return pCmp;
        return a.name.localeCompare(b.name);
      });

      return { automations };
    },

    toggleAutomation: async ({ id, projectId, enabled }) => {
      const action = enabled ? "resume" : "pause";
      try {
        await execBb(["automation", action, id, "--project", projectId, "--json"]);
        return { ok: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },

    updateSchedule: async ({ id, projectId, cron, timezone, at }) => {
      try {
        const args = ["automation", "update", id, "--project", projectId];
        if (at) {
          args.push("--at", at);
        } else if (cron) {
          args.push("--cron", cron);
          const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
          args.push("--timezone", tz);
        } else {
          return { ok: false, error: "Either --cron or --at must be specified" };
        }
        args.push("--json");
        await execBb(args);
        return { ok: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },

    runNow: async ({ id, projectId }) => {
      try {
        await execBb(["automation", "run", id, "--project", projectId, "--json"]);
        return { ok: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  });

  bb.onDispose(() => {
    bb.log.info("automations-popover disposed");
  });
}
