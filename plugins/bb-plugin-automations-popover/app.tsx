import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { NormalizedAutomation, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type Frequency = "hourly" | "daily" | "weekly" | "monthly" | "once" | "custom";

interface EditState {
  frequency: Frequency;
  time: string;
  dayOfWeek: number;
  dayOfMonth: number;
  atValue: string;
  customCron: string;
  timezone: string;
  saving: boolean;
  error?: string;
}

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function initEditState(auto: NormalizedAutomation): EditState {
  const tz = auto.trigger.timezone || getBrowserTimezone();

  if (auto.trigger.at) {
    let localIso = "";
    try {
      const d = new Date(auto.trigger.at);
      if (!Number.isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, "0");
        localIso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    } catch {
      localIso = "";
    }
    return {
      frequency: "once",
      time: "09:00",
      dayOfWeek: 0,
      dayOfMonth: 1,
      atValue: localIso,
      customCron: "0 9 * * *",
      timezone: tz,
      saving: false,
    };
  }

  const cron = (auto.trigger.cron || "").trim();
  const parts = cron.split(/\s+/);
  if (parts.length === 5) {
    const [min, hour, dom, mon, dow] = parts;
    const isNum = (s: string) => /^\d+$/.test(s);
    if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
      return {
        frequency: "hourly",
        time: "09:00",
        dayOfWeek: 0,
        dayOfMonth: 1,
        atValue: "",
        customCron: cron,
        timezone: tz,
        saving: false,
      };
    }
    if (isNum(min) && isNum(hour)) {
      const timeStr = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
      if (dom === "*" && mon === "*" && dow === "*") {
        return {
          frequency: "daily",
          time: timeStr,
          dayOfWeek: 0,
          dayOfMonth: 1,
          atValue: "",
          customCron: cron,
          timezone: tz,
          saving: false,
        };
      }
      if (dom === "*" && mon === "*" && isNum(dow)) {
        return {
          frequency: "weekly",
          time: timeStr,
          dayOfWeek: Math.max(0, Math.min(6, Number(dow))),
          dayOfMonth: 1,
          atValue: "",
          customCron: cron,
          timezone: tz,
          saving: false,
        };
      }
      if (isNum(dom) && mon === "*" && dow === "*") {
        return {
          frequency: "monthly",
          time: timeStr,
          dayOfWeek: 0,
          dayOfMonth: Math.max(1, Math.min(28, Number(dom))),
          atValue: "",
          customCron: cron,
          timezone: tz,
          saving: false,
        };
      }
    }
  }

  return {
    frequency: "custom",
    time: "09:00",
    dayOfWeek: 0,
    dayOfMonth: 1,
    atValue: "",
    customCron: cron || "0 9 * * *",
    timezone: tz,
    saving: false,
  };
}

function formatScheduleSummary(trigger: NormalizedAutomation["trigger"]): string {
  if (trigger.at) {
    try {
      const d = new Date(trigger.at);
      if (!Number.isNaN(d.getTime())) {
        return `At ${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
      }
    } catch {
      // ignore
    }
    return `At ${trigger.at}`;
  }

  if (!trigger.cron) {
    return "No schedule";
  }

  const cron = trigger.cron.trim();
  const parts = cron.split(/\s+/);
  if (parts.length === 5) {
    const [min, hour, dom, mon, dow] = parts;
    if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
      return "Hourly at :00";
    }

    const isNum = (s: string) => /^\d+$/.test(s);
    if (isNum(min) && isNum(hour)) {
      const h = Number(hour);
      const m = min.padStart(2, "0");
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 || 12;
      const timeStr = `${h12}:${m} ${ampm}`;

      if (dom === "*" && mon === "*" && dow === "*") {
        return `Daily at ${timeStr}`;
      }
      if (dom === "*" && mon === "*" && isNum(dow) && Number(dow) >= 0 && Number(dow) <= 6) {
        return `Every ${FULL_DAYS[Number(dow)]} at ${timeStr}`;
      }
      if (isNum(dom) && mon === "*" && dow === "*") {
        const d = Number(dom);
        const suffix =
          d === 1 || d === 21 || d === 31
            ? "st"
            : d === 2 || d === 22
              ? "nd"
              : d === 3 || d === 23
                ? "rd"
                : "th";
        return `Monthly on the ${d}${suffix} at ${timeStr}`;
      }
    }
  }

  return `Cron: ${cron}`;
}

function formatNextRun(nextRunAt: string | number | null | undefined, enabled: boolean): string {
  if (!enabled) return "Paused";
  if (!nextRunAt) return "Not scheduled";

  const date = typeof nextRunAt === "number" ? new Date(nextRunAt) : new Date(nextRunAt);
  if (Number.isNaN(date.getTime())) return String(nextRunAt);

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (sameDay) {
    return `Today at ${timeStr}`;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  ) {
    return `Tomorrow at ${timeStr}`;
  }

  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${timeStr}`;
}

function InlineScheduleEditor({
  automation,
  onSave,
  onCancel,
}: {
  automation: NormalizedAutomation;
  onSave: (state: EditState) => Promise<void>;
  onCancel: () => void;
}) {
  const [state, setState] = useState<EditState>(() => initEditState(automation));

  const handleSave = async () => {
    setState((s) => ({ ...s, saving: true, error: undefined }));
    try {
      await onSave(state);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, saving: false, error: msg }));
    }
  };

  return (
    <div className="mt-2 space-y-2.5 rounded-md border border-border/80 bg-background/80 p-2.5 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-foreground">Edit Schedule</span>
        <span className="text-[10px] text-muted-foreground">{automation.name}</span>
      </div>

      {state.error ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
          {state.error}
        </div>
      ) : null}

      {/* Frequency selector */}
      <div className="space-y-1">
        <label className="text-[10px] font-medium text-muted-foreground">Frequency</label>
        <select
          value={state.frequency}
          onChange={(e) =>
            setState((s) => ({ ...s, frequency: e.target.value as Frequency, error: undefined }))
          }
          className="w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="once">One-time</option>
          <option value="custom">Custom Cron</option>
        </select>
      </div>

      {/* Weekly Day of Week Selector */}
      {state.frequency === "weekly" ? (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground">Day of Week</label>
          <div className="grid grid-cols-7 gap-1">
            {DAYS_OF_WEEK.map((day, idx) => (
              <button
                type="button"
                key={day}
                onClick={() => setState((s) => ({ ...s, dayOfWeek: idx }))}
                className={cn(
                  "rounded border py-1 text-center text-[10px] font-medium transition-colors",
                  state.dayOfWeek === idx
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {day}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Monthly Day of Month Selector */}
      {state.frequency === "monthly" ? (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground">Day of Month (1–28)</label>
          <select
            value={state.dayOfMonth}
            onChange={(e) => setState((s) => ({ ...s, dayOfMonth: Number(e.target.value) }))}
            className="w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                Day {d}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/* Time Picker for Daily, Weekly, Monthly */}
      {state.frequency === "daily" || state.frequency === "weekly" || state.frequency === "monthly" ? (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground">Time</label>
          <input
            type="time"
            value={state.time}
            onChange={(e) => setState((s) => ({ ...s, time: e.target.value }))}
            className="w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      ) : null}

      {/* One-time Datetime Picker */}
      {state.frequency === "once" ? (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground">Run At</label>
          <input
            type="datetime-local"
            value={state.atValue}
            onChange={(e) => setState((s) => ({ ...s, atValue: e.target.value }))}
            className="w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      ) : null}

      {/* Custom Cron Input */}
      {state.frequency === "custom" ? (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground">Cron Expression (5 fields)</label>
          <input
            type="text"
            value={state.customCron}
            placeholder="0 9 * * 1"
            onChange={(e) => setState((s) => ({ ...s, customCron: e.target.value }))}
            className="w-full rounded border border-input bg-background px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      ) : null}

      {/* Timezone (for cron-based schedules) */}
      {state.frequency !== "once" ? (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground">Timezone</label>
          <input
            type="text"
            value={state.timezone}
            placeholder="e.g. America/Los_Angeles"
            onChange={(e) => setState((s) => ({ ...s, timezone: e.target.value }))}
            className="w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      ) : null}

      {/* Buttons */}
      <div className="flex items-center justify-end gap-1.5 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={onCancel}
          disabled={state.saving}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => void handleSave()}
          disabled={state.saving}
        >
          {state.saving ? (
            <>
              <Icon name="RefreshCw" className="size-3 animate-spin" />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
      </div>
    </div>
  );
}

function AutomationCard({
  automation,
  isEditing,
  isToggling,
  isRunning,
  onToggle,
  onRunNow,
  onToggleEdit,
  onSaveSchedule,
}: {
  automation: NormalizedAutomation;
  isEditing: boolean;
  isToggling: boolean;
  isRunning: boolean;
  onToggle: () => void;
  onRunNow: () => void;
  onToggleEdit: () => void;
  onSaveSchedule: (state: EditState) => Promise<void>;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background/50 p-2.5 transition-colors">
      {/* Top Header: Name, Badge, Toggle */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-foreground" title={automation.name}>
              {automation.name}
            </span>
            <span
              className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
              title={`Project: ${automation.projectName}`}
            >
              {automation.projectName}
            </span>
            {automation.mode ? (
              <span className="shrink-0 rounded border border-border/80 px-1 py-0.2 text-[8px] font-mono uppercase text-muted-foreground">
                {automation.mode}
              </span>
            ) : null}
          </div>
          {automation.model ? (
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {automation.model}
            </div>
          ) : null}
        </div>

        {/* On/Off Toggle Button */}
        <button
          type="button"
          onClick={onToggle}
          disabled={isToggling}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50",
            automation.enabled
              ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 dark:text-emerald-400"
              : "border border-border bg-muted/80 text-muted-foreground hover:bg-muted",
          )}
          title={automation.enabled ? "Click to pause" : "Click to resume"}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              automation.enabled ? "bg-emerald-500" : "bg-muted-foreground/60",
            )}
          />
          {isToggling ? "…" : automation.enabled ? "On" : "Off"}
        </button>
      </div>

      {/* Schedule Summary & Next Run */}
      <div className="mt-2 space-y-0.5 text-[11px]">
        <div className="flex items-center gap-1.5 text-foreground/90">
          <Icon name="Clock" className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{formatScheduleSummary(automation.trigger)}</span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Next: {formatNextRun(automation.nextRunAt, automation.enabled)}</span>
          {automation.lastRunStatus ? (
            <span
              className={cn(
                "capitalize",
                automation.lastRunStatus === "ok" || automation.lastRunStatus === "completed"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400",
              )}
            >
              Last: {automation.lastRunStatus}
            </span>
          ) : null}
        </div>
      </div>

      {/* Action Buttons: Run Now & Edit Schedule */}
      <div className="mt-2.5 flex items-center gap-1.5 border-t border-border/40 pt-2">
        <Button
          variant="outline"
          size="sm"
          className="h-6 gap-1 px-2 text-[10px]"
          disabled={isRunning}
          onClick={onRunNow}
          aria-label="Run automation now"
        >
          <Icon
            name={isRunning ? "RefreshCw" : "Play"}
            className={cn("size-2.5 text-emerald-500", isRunning && "animate-spin")}
          />
          {isRunning ? "Running…" : "Run now"}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={onToggleEdit}
        >
          <Icon name="Calendar" className="size-2.5" />
          {isEditing ? "Close" : "Edit Schedule"}
        </Button>
      </div>

      {/* Inline Editor */}
      {isEditing ? (
        <InlineScheduleEditor
          automation={automation}
          onSave={onSaveSchedule}
          onCancel={onToggleEdit}
        />
      ) : null}
    </div>
  );
}

function AutomationsPopover() {
  const rpc = useRpc<typeof rpcContract>();
  const [automations, setAutomations] = useState<NormalizedAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [togglingIds, setTogglingIds] = useState<Record<string, boolean>>({});
  const [runningIds, setRunningIds] = useState<Record<string, boolean>>({});

  const load = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const res = await rpc.call("listAutomations", {});
        setAutomations(res.automations);
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [rpc],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const handleToggle = async (auto: NormalizedAutomation) => {
    setTogglingIds((prev) => ({ ...prev, [auto.id]: true }));
    try {
      const res = await rpc.call("toggleAutomation", {
        id: auto.id,
        projectId: auto.projectId,
        enabled: !auto.enabled,
      });
      if (res.ok) {
        setAutomations((prev) =>
          prev.map((a) => (a.id === auto.id ? { ...a, enabled: !a.enabled } : a)),
        );
      } else {
        setError(res.error || "Failed to toggle automation");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingIds((prev) => ({ ...prev, [auto.id]: false }));
    }
  };

  const handleRunNow = async (auto: NormalizedAutomation) => {
    setRunningIds((prev) => ({ ...prev, [auto.id]: true }));
    try {
      const res = await rpc.call("runNow", {
        id: auto.id,
        projectId: auto.projectId,
      });
      if (!res.ok) {
        setError(res.error || "Failed to trigger run");
      } else {
        // Refresh list to pick up updated run timestamps
        void load(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningIds((prev) => ({ ...prev, [auto.id]: false }));
    }
  };

  const handleSaveSchedule = async (auto: NormalizedAutomation, state: EditState) => {
    let cron: string | undefined;
    let at: string | undefined;
    const timezone = state.timezone.trim() || undefined;

    if (state.frequency === "once") {
      if (!state.atValue) {
        throw new Error("Please select a date and time");
      }
      const d = new Date(state.atValue);
      if (Number.isNaN(d.getTime())) {
        throw new Error("Invalid date and time format");
      }
      at = d.toISOString();
    } else if (state.frequency === "hourly") {
      cron = "0 * * * *";
    } else if (state.frequency === "daily") {
      const [h, m] = state.time.split(":").map(Number);
      cron = `${m || 0} ${h || 0} * * *`;
    } else if (state.frequency === "weekly") {
      const [h, m] = state.time.split(":").map(Number);
      cron = `${m || 0} ${h || 0} * * ${state.dayOfWeek}`;
    } else if (state.frequency === "monthly") {
      const [h, m] = state.time.split(":").map(Number);
      cron = `${m || 0} ${h || 0} ${state.dayOfMonth} * *`;
    } else if (state.frequency === "custom") {
      const trimmed = state.customCron.trim();
      if (trimmed.split(/\s+/).length !== 5) {
        throw new Error("Cron expression must consist of exactly 5 fields");
      }
      cron = trimmed;
    }

    const res = await rpc.call("updateSchedule", {
      id: auto.id,
      projectId: auto.projectId,
      cron,
      timezone,
      at,
    });

    if (!res.ok) {
      throw new Error(res.error || "Failed to update schedule");
    }

    setEditingId(null);
    void load(true);
  };

  const activeCount = automations.filter((a) => a.enabled).length;

  return (
    <div className="w-[340px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon name="Clock" className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-semibold">Automations</span>
          {automations.length > 0 ? (
            <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] font-medium text-muted-foreground">
              {activeCount} active
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            aria-label="Refresh automations"
            disabled={refreshing}
            onClick={() => void load(true)}
          >
            <Icon name="RefreshCw" className={cn("size-3.5", refreshing && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="max-h-[440px] space-y-2.5 overflow-y-auto p-3">
        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {loading && automations.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            Loading automations…
          </div>
        ) : null}

        {!loading && automations.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            No automations configured.
            <div className="mt-1 text-[10px] text-muted-foreground/80">
              Create one via <code className="font-mono">bb automation create</code>.
            </div>
          </div>
        ) : null}

        {automations.map((auto) => (
          <AutomationCard
            key={`${auto.projectId}-${auto.id}`}
            automation={auto}
            isEditing={editingId === auto.id}
            isToggling={Boolean(togglingIds[auto.id])}
            isRunning={Boolean(runningIds[auto.id])}
            onToggle={() => void handleToggle(auto)}
            onRunNow={() => void handleRunNow(auto)}
            onToggleEdit={() => setEditingId((curr) => (curr === auto.id ? null : auto.id))}
            onSaveSchedule={(state) => handleSaveSchedule(auto, state)}
          />
        ))}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.experimental_sidebarFooter.register({
    id: "automations-popover",
    kind: "disclosure",
    label: "Automations",
    icon: "Clock",
    component: AutomationsPopover,
  });
});
