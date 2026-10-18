"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "./app-data";
import type { AiUsage } from "./ai-usage";

type Row = AiUsage & { userId: string; name: string; email: string; ownKeyWeek: number; callsWeek: number };

/** Admin: this week's heaviest AI users; give one user other limits (0 turns the team's AI off for them). */
export function AiUsageAdmin() {
  const [data, setData] = useState<{ defaults: { perDay: number; perWeek: number }; users: Row[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api<{ defaults: { perDay: number; perWeek: number }; users: Row[] }>("/api/admin/ai-usage").then(setData).catch((e: Error) => setMsg(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  async function set(userId: string, perDay: number | null, perWeek: number | null) {
    try {
      await api("/api/admin/ai-usage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, perDay, perWeek }) });
      setMsg("Saved");
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  const ask = (label: string, now: number) => {
    const v = prompt(`${label} in tokens (empty: back to the default)`, String(now));
    if (v === null) return undefined;
    return v.trim() === "" ? null : Math.max(0, Math.floor(Number(v)));
  };

  if (!data) return <p className="text-sm text-muted">{msg ?? "Loading…"}</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Defaults: {data.defaults.perDay.toLocaleString()} tokens a day, {data.defaults.perWeek.toLocaleString()} a week (AI_TOKENS_PER_DAY, AI_TOKENS_PER_WEEK).
      </p>
      {msg && <p className="text-sm">{msg}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1">User</th>
            <th>Today</th>
            <th>This week</th>
            <th>Own key (week)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.users.map((u) => (
            <tr key={u.userId} className="border-t border-white/10">
              <td className="py-2">
                {u.name}
                <div className="text-xs text-muted">{u.email}</div>
              </td>
              <td>
                {u.today.toLocaleString()} / {u.perDay.toLocaleString()}
              </td>
              <td>
                {u.week.toLocaleString()} / {u.perWeek.toLocaleString()}
                {u.custom && <span className="ml-1 text-xs text-muted">(custom)</span>}
              </td>
              <td>{u.ownKeyWeek.toLocaleString()}</td>
              <td className="text-right">
                <button
                  className="aw-button aw-button-outline"
                  onClick={() => {
                    const d = ask("Per day", u.perDay);
                    if (d === undefined) return;
                    const w = ask("Per week", u.perWeek);
                    if (w === undefined) return;
                    void set(u.userId, d, w);
                  }}
                >
                  Set limits
                </button>
              </td>
            </tr>
          ))}
          {!data.users.length && (
            <tr>
              <td colSpan={5} className="py-2 text-muted">
                No AI use this week yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
