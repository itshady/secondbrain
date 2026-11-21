import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { AgyWindow, NativeProviderQuota, QuotaResponse, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

function formatRelativeAge(updatedAt: number | null, now: number): string {
  if (!updatedAt) return "Not synced";
  const diffSec = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (diffSec < 15) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function formatResetTime(raw: string | null): string | null {
  if (!raw) return null;
  // ISO timestamp from native BB providers
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      const now = new Date();
      const sameDay =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
      return sameDay
        ? `Resets ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
        : `Resets ${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }
  }
  // agy format: "2026-11-24 21:31 PST"
  const agyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s*(\S+)?$/);
  if (agyMatch) {
    const [, y, m, d, hh, mm, tz] = agyMatch;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const hourNum = Number(hh);
    const ampm = hourNum >= 12 ? "PM" : "AM";
    const hour12 = hourNum % 12 || 12;
    const now = new Date();
    const sameDay =
      Number(y) === now.getFullYear() &&
      Number(m) === now.getMonth() + 1 &&
      Number(d) === now.getDate();
    const tzSuffix = tz ? ` ${tz}` : "";
    if (sameDay) {
      return `Resets ${hour12}:${mm} ${ampm}${tzSuffix}`;
    }
    return `Resets ${months[Number(m) - 1] ?? m} ${Number(d)}, ${hour12}:${mm} ${ampm}${tzSuffix}`;
  }
  return `Resets ${raw}`;
}

function remainingBarClass(remaining: number): string {
  if (remaining > 30) return "bg-emerald-500";
  if (remaining >= 10) return "bg-amber-500";
  return "bg-red-500";
}

function remainingTextClass(remaining: number): string {
  if (remaining > 30) return "text-emerald-600 dark:text-emerald-400";
  if (remaining >= 10) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function displayAgyGroup(group: string): string {
  if (/claude and gpt/i.test(group)) return "Claude & GPT (Antigravity)";
  return group;
}

function displayProviderName(id: string): string {
  switch (id) {
    case "codex":
      return "Codex";
    case "claude-code":
      return "Claude Code";
    default:
      return id
        .split(/[-_]/)
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
        .join(" ");
  }
}

function QuotaBarRow({
  label,
  remainingPercent,
  resetsAt,
}: {
  label: string;
  remainingPercent: number;
  resetsAt: string | null;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(remainingPercent)));
  const resetText = formatResetTime(resetsAt);

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-medium text-foreground/90">{label}</span>
        <span className={cn("shrink-0 font-mono text-[11px] font-semibold tabular-nums", remainingTextClass(clamped))}>
          {clamped}% left
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all duration-300", remainingBarClass(clamped))}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {resetText ? (
        <div className="text-[10px] leading-tight text-muted-foreground">{resetText}</div>
      ) : null}
    </div>
  );
}

function groupAgyRows(rows: AgyWindow[]): Array<{ group: string; windows: AgyWindow[] }> {
  const map = new Map<string, AgyWindow[]>();
  for (const row of rows) {
    const existing = map.get(row.group);
    if (existing) {
      existing.push(row);
    } else {
      map.set(row.group, [row]);
    }
  }
  return Array.from(map.entries()).map(([group, windows]) => ({ group, windows }));
}

function NativeProviderCard({ provider }: { provider: NativeProviderQuota }) {
  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-background/50 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">
          {displayProviderName(provider.id)}
        </span>
        {provider.planLabel ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {provider.planLabel}
          </span>
        ) : null}
      </div>

      {provider.status === "ok" && provider.windows && provider.windows.length > 0 ? (
        <div className="space-y-2">
          {provider.windows.map((w) => (
            <QuotaBarRow
              key={`${provider.id}-${w.label}`}
              label={w.label}
              remainingPercent={w.remainingPercent}
              resetsAt={w.resetsAt}
            />
          ))}
        </div>
      ) : provider.status === "ok" ? (
        <p className="text-[11px] text-muted-foreground">No active quota windows.</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {provider.status === "unauthenticated"
            ? "Not signed in"
            : provider.status === "expired"
              ? "Session expired"
              : provider.message ?? "Unavailable"}
        </p>
      )}
    </div>
  );
}

function UnifiedUsagePopover() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<QuotaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    async (forceRefresh: boolean) => {
      if (forceRefresh) {
        setRefreshing(true);
      } else {
        setLoading((prev) => (data === null ? true : prev));
      }
      try {
        const res = await rpc.call("getQuota", { refresh: forceRefresh });
        setData(res);
        setError(null);
        setNow(Date.now());
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [rpc, data],
  );

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtime("quota-updated", () => {
    void load(false);
  });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const agyGroups = data ? groupAgyRows(data.agy.rows) : [];
  const activeProviders = (data?.providers ?? []).filter((p) => p.status !== "not_installed");

  return (
    <div className="w-[310px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon name="BarChart3" className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-semibold">Usage &amp; Quota</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeAge(data?.updatedAt ?? null, now)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            aria-label="Refresh usage and quota"
            disabled={refreshing}
            onClick={() => void load(true)}
          >
            <Icon name="RefreshCw" className={cn("size-3.5", refreshing && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="max-h-[420px] space-y-3 overflow-y-auto p-3">
        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {loading && !data ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            Loading quota…
          </div>
        ) : null}

        {data ? (
          <>
            {/* Antigravity / Gemini CLI section */}
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Antigravity
              </div>
              {data.agy.status === "ok" && agyGroups.length > 0 ? (
                <div className="space-y-2">
                  {agyGroups.map(({ group, windows }) => (
                    <div
                      key={group}
                      className="space-y-2 rounded-md border border-border/60 bg-background/50 p-2.5"
                    >
                      <div className="text-xs font-semibold text-foreground">
                        {displayAgyGroup(group)}
                      </div>
                      <div className="space-y-2">
                        {windows.map((w) => (
                          <QuotaBarRow
                            key={`${group}-${w.rawLabel}`}
                            label={w.label}
                            remainingPercent={w.remainingPercent}
                            resetsAt={w.resetsAt}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border px-2.5 py-2 text-[11px] text-muted-foreground">
                  {data.agy.error ?? "Antigravity CLI unavailable"}
                </div>
              )}
            </div>

            {/* Native BB Providers section */}
            {activeProviders.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  BB Providers
                </div>
                <div className="space-y-2">
                  {activeProviders.map((provider) => (
                    <NativeProviderCard key={provider.id} provider={provider} />
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.experimental_sidebarFooter.register({
    id: "unified-usage",
    kind: "disclosure",
    label: "Usage & Quota",
    icon: "BarChart3",
    component: UnifiedUsagePopover,
  });
});
