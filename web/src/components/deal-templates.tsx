"use client";

import { useCallback, useEffect, useState } from "react";

import { toast } from "./header-tools";
import { api, tokenMoney } from "./app-data";
import { Button, Loading } from "./mockup-ui";

type Template = {
  id: string;
  name: string;
  side: "BUY" | "SELL";
  kind: "HIRE" | "GOODS";
  title: string;
  summary: string;
  milestones: { name: string; amount: string; delivery: "file" | "parcel" | "note"; acceptance: string; dueDays: number | null }[];
  uses: number;
  total: string;
};

const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/**
 * Deals → Templates: deals saved without their other party. "Use" opens the AI chat with the
 * template named, so the AI drafts a new preview from it (the user still confirms it).
 */
export function TemplatesPanel({ currency, onCount }: { currency: "THB" | "CNY"; onCount?: (n: number) => void }) {
  const [list, setList] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ templates: Template[] }>("/api/templates");
      setList(r.templates);
      onCount?.(r.templates.length);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [onCount]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const use = (t: Template) => {
    const who = t.side === "SELL" ? "buyer" : t.kind === "GOODS" ? "seller" : "contractor";
    window.location.assign(`/chat?draft=${encodeURIComponent(`Use my template "${t.name}" with ${who}: `)}`);
  };

  return (
    <section className="aw-templates">
      <p className="aw-templates-intro">
        ⓘ A template is a deal without the other party. <b>Use</b> opens the AI chat with it: type who it is for (and anything to change, like the amount); the AI drafts a new preview that you still confirm. Save one with “☆ Save as template” on a deal card or a deal&apos;s page, or ask the AI.
      </p>
      {error && <p className="aw-bank-error">{error}</p>}
      {!list && !error && <Loading text="Loading your templates…" />}
      {list?.length === 0 && <p className="aw-templates-empty">No templates yet.</p>}
      <div className="aw-template-grid">
        {list?.map((t) => (
          <article className="aw-template-card" key={t.id}>
            <header>
              <b>{t.name}</b>
              <span className={`aw-kind-badge ${t.kind === "GOODS" ? "goods" : "hire"}`}>
                {t.side === "SELL" ? "SELL" : t.kind === "GOODS" ? "BUY" : "HIRE"}
              </span>
            </header>
            <small>{t.title}</small>
            <ol>
              {t.milestones.map((m, i) => (
                <li key={i}>
                  <span>
                    {m.name}
                    {m.delivery === "parcel" ? " · 📦" : m.delivery === "file" ? " · 📎" : ""}
                  </span>
                  <b>{tokenMoney(m.amount, currency)}</b>
                </li>
              ))}
            </ol>
            <div className="aw-template-total">
              <span>Total{t.uses ? ` · used ${t.uses}×` : ""}</span>
              <b>{tokenMoney(t.total, currency)}</b>
            </div>
            <footer>
              <Button onClick={() => use(t)} disabled={!!busy}>
                Use with someone →
              </Button>
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => {
                  const name = window.prompt("New name for this template:", t.name)?.trim();
                  if (name && name !== t.name) void run(`r${t.id}`, () => api(`/api/templates/${t.id}`, json("PATCH", { name })));
                }}
              >
                Rename
              </Button>
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => {
                  if (window.confirm(`Delete the template “${t.name}”? Deals made from it are not affected.`)) void run(`d${t.id}`, () => api(`/api/templates/${t.id}`, json("DELETE")));
                }}
              >
                {busy === `d${t.id}` ? "Deleting…" : "Delete"}
              </Button>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}

export type TemplatePayload = Omit<Template, "id" | "uses" | "total">;

/** The "Save as template" dialog: a name, what is kept and what is left out, Save. */
export function SaveTemplateDialog({
  payload,
  currency,
  onClose,
  onSaved,
}: {
  payload: TemplatePayload;
  currency: "THB" | "CNY";
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [name, setName] = useState(payload.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = payload.milestones.reduce((t, m) => t + Number(m.amount), 0);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/templates", json("POST", { ...payload, name: name.trim() }));
      toast({ text: `Saved template “${name.trim()}”`, tone: "ok", href: "/deals" });
      onSaved(`Saved template “${name.trim()}”. Use it from Deals → Templates, or tell the AI “use my template ${name.trim()}”.`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="aw-co-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="aw-co-dialog aw-tpl-dialog" role="dialog" aria-modal="true" aria-label="Save as template" onSubmit={save}>
        <header>
          <h2>☆ Save as template</h2>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy}>
            ×
          </button>
        </header>
        <label className="aw-tpl-field">
          <span>Template name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus placeholder="e.g. Logo package" />
          <small>Using the same name again replaces that template.</small>
        </label>
        <div className="aw-tpl-preview">
          <div className="aw-tpl-head">
            <b>{payload.title}</b>
            <span className={`aw-kind-badge ${payload.kind === "GOODS" ? "goods" : "hire"}`}>{payload.side === "SELL" ? "SELL" : payload.kind === "GOODS" ? "BUY" : "HIRE"}</span>
          </div>
          <ol>
            {payload.milestones.map((m, i) => (
              <li key={i}>
                <span>
                  {m.name}
                  {m.dueDays !== null ? <small> · due +{m.dueDays} days</small> : null}
                </span>
                <b>{tokenMoney(m.amount, currency)}</b>
              </li>
            ))}
          </ol>
          <div className="aw-template-total">
            <span>Total</span>
            <b>{tokenMoney(total, currency)}</b>
          </div>
        </div>
        <ul className="aw-tpl-kept">
          <li>✓ Kept: title, scope, milestones, amounts, acceptance criteria, delivery type</li>
          <li>✕ Not kept: the other party, their link, addresses and dates (due days are kept relative)</li>
        </ul>
        {error && <p className="aw-bank-error">{error}</p>}
        <footer>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? (
              <>
                <i className="aw-spinner" aria-hidden /> Saving…
              </>
            ) : (
              "Save template"
            )}
          </Button>
        </footer>
      </form>
    </div>
  );
}
