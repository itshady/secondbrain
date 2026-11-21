import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 120_000;
const AGY_TIMEOUT_MS = 15_000;
const QUOTA_UPDATED_CHANNEL = "quota-updated";

const agyWindowSchema = z.object({
  group: z.string(),
  label: z.string(),
  rawLabel: z.string(),
  remainingPercent: z.number(),
  usedPercent: z.number(),
  resetsAt: z.string().nullable(),
});

const providerWindowSchema = z.object({
  label: z.string(),
  usedPercent: z.number(),
  remainingPercent: z.number(),
  resetsAt: z.string().nullable(),
  cost: z
    .object({
      usedUsdCents: z.number(),
      limitUsdCents: z.number(),
    })
    .optional(),
});

const nativeProviderSchema = z.object({
  id: z.string(),
  status: z.enum(["ok", "not_installed", "unauthenticated", "expired", "error"]),
  accountEmail: z.string().nullable().optional(),
  planLabel: z.string().nullable().optional(),
  message: z.string().optional(),
  windows: z.array(providerWindowSchema).optional(),
});

const quotaResponseSchema = z.object({
  updatedAt: z.number().nullable(),
  agy: z.object({
    status: z.enum(["ok", "not_installed", "error"]),
    rows: z.array(agyWindowSchema),
    error: z.string().nullable(),
  }),
  providers: z.array(nativeProviderSchema),
});

export type AgyWindow = z.infer<typeof agyWindowSchema>;
export type NativeProviderQuota = z.infer<typeof nativeProviderSchema>;
export type QuotaResponse = z.infer<typeof quotaResponseSchema>;

export const rpcContract = defineRpcContract({
  getQuota: {
    input: z.object({ refresh: z.boolean().optional() }),
    output: quotaResponseSchema,
  },
});

function resolveAgyBin(): string | null {
  const candidates = [
    process.env.AGY_BIN,
    join(homedir(), ".local", "bin", "agy"),
    "/opt/homebrew/bin/agy",
    "/usr/local/bin/agy",
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "agy";
}

function normalizeAgyLabel(group: string, rawLabel: string): string {
  if (/five\s*hour/i.test(rawLabel)) return "5-Hour";
  if (/weekly/i.test(rawLabel)) return "Weekly";
  const stripped = rawLabel
    .replace(new RegExp(`^${group.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")
    .replace(/\s*limit\s*remaining$/i, "")
    .replace(/\s*limit$/i, "")
    .trim();
  return stripped || rawLabel;
}

const GROUP_PRIORITY: Record<string, number> = {
  "Gemini Models": 0,
  "Gemini 4 Argon": 1,
  "Claude and GPT models": 2,
};

function parseAgyUsage(stdout: string): AgyWindow[] {
  const rows: AgyWindow[] = [];
  const lines = stdout.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (!line || /^quota:?$/i.test(line)) continue;

    const parts = line.includes("\t")
      ? line.split("\t").map((s) => s.trim())
      : line.split(/\s{2,}/).map((s) => s.trim());
    if (parts.length < 3) continue;

    const pctMatch = parts[2].match(/^(\d+(?:\.\d+)?)%$/);
    if (!pctMatch) continue;

    const group = parts[0];
    const rawLabel = parts[1];
    const remainingPercent = Math.max(0, Math.min(100, Math.round(Number(pctMatch[1]))));
    const resetsAt = parts[3] || null;

    rows.push({
      group,
      label: normalizeAgyLabel(group, rawLabel),
      rawLabel,
      remainingPercent,
      usedPercent: 100 - remainingPercent,
      resetsAt,
    });
  }

  rows.sort((a, b) => {
    const ga = GROUP_PRIORITY[a.group] ?? 99;
    const gb = GROUP_PRIORITY[b.group] ?? 99;
    if (ga !== gb) return ga - gb;
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    const la = a.label === "5-Hour" ? 0 : a.label === "Weekly" ? 1 : 2;
    const lb = b.label === "5-Hour" ? 0 : b.label === "Weekly" ? 1 : 2;
    return la - lb;
  });

  return rows;
}

async function fetchAgyQuota(): Promise<QuotaResponse["agy"]> {
  const bin = resolveAgyBin();
  if (!bin) {
    return { status: "not_installed", rows: [], error: "agy CLI not found" };
  }

  const extraPaths = [
    join(homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  const currentPath = process.env.PATH ?? "";
  const mergedPath = [...extraPaths, currentPath].filter(Boolean).join(":");

  try {
    const { stdout } = await execFileAsync(bin, ["-p", "/usage"], {
      timeout: AGY_TIMEOUT_MS,
      maxBuffer: 256 * 1024,
      env: { ...process.env, PATH: mergedPath },
    });
    const rows = parseAgyUsage(stdout);
    if (rows.length === 0) {
      return { status: "error", rows: [], error: "No quota rows returned by agy" };
    }
    return { status: "ok", rows, error: null };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { status: "not_installed", rows: [], error: "agy CLI not installed" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", rows: [], error: msg.slice(0, 200) };
  }
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("unified-usage loaded");

  let cachedQuota: QuotaResponse | null = null;
  let inFlight: Promise<QuotaResponse> | null = null;

  async function fetchNativeProviders(refresh: boolean): Promise<NativeProviderQuota[]> {
    try {
      const limits = await bb.sdk.system.usageLimits({ refresh });
      const providers: NativeProviderQuota[] = [];
      for (const [id, entry] of Object.entries(limits)) {
        if (entry.status === "ok") {
          providers.push({
            id,
            status: "ok",
            accountEmail: entry.accountEmail ?? null,
            planLabel: entry.planLabel ?? null,
            windows: entry.windows.map((w) => {
              const used = Math.max(0, Math.min(100, Math.round(w.usedPercent)));
              return {
                label: w.label,
                usedPercent: used,
                remainingPercent: 100 - used,
                resetsAt: w.resetsAt ?? null,
                ...(w.cost ? { cost: w.cost } : {}),
              };
            }),
          });
        } else if (entry.status === "error") {
          providers.push({
            id,
            status: "error",
            accountEmail: entry.accountEmail ?? null,
            planLabel: entry.planLabel ?? null,
            message: entry.message,
          });
        } else {
          providers.push({ id, status: entry.status });
        }
      }
      return providers;
    } catch (err: unknown) {
      bb.log.warn(
        `failed to fetch native usageLimits: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  function refreshQuota(forceProviderRefresh: boolean): Promise<QuotaResponse> {
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const [agy, providers] = await Promise.all([
        fetchAgyQuota(),
        fetchNativeProviders(forceProviderRefresh),
      ]);
      const result: QuotaResponse = {
        updatedAt: Date.now(),
        agy,
        providers,
      };
      cachedQuota = result;
      bb.realtime.publish(QUOTA_UPDATED_CHANNEL, { updatedAt: result.updatedAt });
      return result;
    })().finally(() => {
      inFlight = null;
    });

    return inFlight;
  }

  bb.rpc.register(rpcContract, {
    getQuota: async ({ refresh }) => {
      const force = refresh === true;
      if (!force && cachedQuota !== null) {
        const age = Date.now() - (cachedQuota.updatedAt ?? 0);
        if (age >= CACHE_TTL_MS) {
          void refreshQuota(false);
        }
        return cachedQuota;
      }
      return refreshQuota(force);
    },
  });

  bb.background.service("quota-warmer", {
    async start(signal) {
      while (!signal.aborted) {
        await refreshQuota(false).catch((err) => {
          bb.log.warn(
            `background quota refresh failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
        if (signal.aborted) break;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, CACHE_TTL_MS);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    },
  });

  bb.onDispose(() => {
    cachedQuota = null;
    bb.log.info("unified-usage disposed");
  });
}
