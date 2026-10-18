"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "./app-data";

export type AiUsage = { today: number; week: number; ownKeyToday: number; perDay: number; perWeek: number; custom: boolean; resetsDay: string; resetsWeek: string };

const fmt = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000).toLocaleString()}k` : n.toLocaleString());
const when = (t: string) => new Date(t).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

function Bar({ label, used, limit, resets }: { label: string; used: number; limit: number; resets: string }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return (
    <div className="aw-ai-usage-row">
      <div className="aw-ai-usage-head">
        <span>{label}</span>
        <span>
          {fmt(used)} / {fmt(limit)} tokens · resets {when(resets)}
        </span>
      </div>
      <div className="aw-ai-usage-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${pct}%` }} data-level={pct >= 100 ? "full" : pct >= 80 ? "high" : "ok"} />
      </div>
    </div>
  );
}

/** The user's AI allowance: tokens today and this week on the team's AI (Profile → Preferences). */
export function AiUsageBars() {
  const [u, setU] = useState<AiUsage | null>(null);
  const load = useCallback(() => api<AiUsage>("/api/ai/usage").then(setU).catch(() => setU(null)), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!u) return null;
  return (
    <div className="aw-ai-usage">
      <b>AI allowance</b>
      <small>So one person cannot use up everyone&apos;s AI. Chat, terms checks, summaries and applicant ranking count. Your own AI key in the desktop app does not.</small>
      <Bar label="Today" used={u.today} limit={u.perDay} resets={u.resetsDay} />
      <Bar label="This week" used={u.week} limit={u.perWeek} resets={u.resetsWeek} />
    </div>
  );
}
