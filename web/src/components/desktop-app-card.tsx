"use client";

import { useCallback, useEffect, useState } from "react";

import { localizeMockupNode, useLang } from "@/lib/i18n";

import { api } from "./app-data";
import { Button, Card } from "./mockup-ui";

type Device = { address: string; name: string; os: string; linkedAt: string; revokedAt: string | null; lastSeenAt: string | null; height: number | null; head: string | null };
type Settings = { deviceSigns: boolean; devices: Device[]; pendingRequests: number; server: string; downloads: string | null };

const when = (t: string | null) => (t ? new Date(t).toLocaleString() : "never");

/**
 * Profile → Desktop app: link the app (a one-time code), see each computer's chain head, remove a
 * lost one, and choose whether deal moves pressed here wait for the app's signature.
 */
export function DesktopAppCard() {
  const lang = useLang();
  const [s, setS] = useState<Settings | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => api<Settings>("/api/device/settings").then(setS).catch((e: Error) => setMsg({ ok: false, text: e.message })), []);
  useEffect(() => {
    load();
  }, [load]);
  // While a code is shown, look for the new device every few seconds.
  useEffect(() => {
    if (!code) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [code, load]);

  async function act(fn: () => Promise<Settings | void>, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (r) setS(r);
      if (ok) setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const active = s?.devices.filter((d) => !d.revokedAt) ?? [];

  return localizeMockupNode(
    <Card className="aw-desktop-card">
      <header>
        <div>
          <h2>Desktop app</h2>
          <small>
            Keep your deals as your own chain on your computer (macOS, Windows, Linux). Every deal event is a block signed by your computer&apos;s key; this website keeps only
            the latest one, countersigned, and anchors them on the blockchain.
          </small>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => act(async () => setCode(await post<{ code: string; expiresAt: string }>("/api/device/link-code")))}>
          Make a link code
        </Button>
      </header>

      {code && (
        <div className="aw-desktop-code">
          <span>Type this in the app (valid until {new Date(code.expiresAt).toLocaleTimeString()}):</span>
          <b>{code.code}</b>
        </div>
      )}

      <div className="aw-desktop-download">
        {s?.downloads ? (
          <a href={s.downloads} target="_blank" rel="noreferrer">
            Download the app
          </a>
        ) : (
          <span>Download: ask the team for the build for your computer (desktop/ in the repository builds all of them).</span>
        )}
        <small>Test mode demo · the app is unsigned, so Windows and macOS ask once before opening it.</small>
      </div>

      {s && active.length > 0 && (
        <table className="aw-desktop-devices">
          <thead>
            <tr>
              <th>Computer</th>
              <th>Chain</th>
              <th>Last seen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {active.map((d) => (
              <tr key={d.address}>
                <td>
                  <b>{d.name}</b>
                  <small>
                    {d.os} · key {d.address.slice(0, 8)}…{d.address.slice(-4)}
                  </small>
                </td>
                <td>
                  {d.height === null ? "no blocks yet" : `${d.height + 1} blocks`}
                  {d.head && <small className="aw-mono">head {d.head.slice(0, 10)}…</small>}
                </td>
                <td>{when(d.lastSeenAt)}</td>
                <td>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Remove ${d.name}? It can no longer sync or sign. Its chain stays on that computer.`)) act(() => post<Settings>("/api/device/revoke", { address: d.address }), "Removed");
                    }}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {s && (
        <label className="aw-desktop-toggle">
          <input
            type="checkbox"
            checked={s.deviceSigns}
            disabled={busy || (!active.length && !s.deviceSigns)}
            onChange={(e) => act(() => post<Settings>("/api/device/settings", { deviceSigns: e.target.checked }))}
          />
          <span>
            <b>My desktop app signs deal moves</b>
            <small>
              Approving, accepting, disputing and refunds pressed on this website wait until you sign them in the app.
              {s.pendingRequests > 0 && ` ${s.pendingRequests} waiting now.`}
            </small>
          </span>
        </label>
      )}
      {msg && <p className={msg.ok ? "aw-ok" : "aw-error"}>{msg.text}</p>}
    </Card>,
    lang,
  );
}
