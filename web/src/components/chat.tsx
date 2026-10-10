"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { AgentStep } from "@/lib/agent";
import { type Key, trServer, useT } from "@/lib/i18n";
import type { Sample } from "@/lib/samples";

import { sampleTitle } from "./panels";
import { Outcome } from "./ui";

type Attachment = { kind: "pdf"; name: string; base64: string } | { kind: "text"; name: string; text: string };

type Message =
  | { role: "user"; text: string; attachment?: string }
  | { role: "assistant"; text: string; steps: AgentStep[]; flags: string[] }
  | { role: "error"; text: string };

const SUGGESTIONS: Key[] = ["chat.suggest.pay", "chat.suggest.cash", "chat.suggest.limits"];

async function fileToAttachment(file: File): Promise<Attachment> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { kind: "pdf", name: file.name, base64: btoa(binary) };
  }
  return { kind: "text", name: file.name, text: await file.text() };
}

function Step({ step }: { step: AgentStep }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const key = `tool.${step.tool}` as Key;
  const label = t(key) === key ? step.tool : t(key);
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm">
      <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen((v) => !v)}>
        <span className="font-medium">
          <span className="mr-1.5 font-mono text-xs text-muted">tool</span>
          {label}
        </span>
        <span className="text-xs text-muted">{open ? t("common.hide") : t("common.details")}</span>
      </button>
      {step.result && (
        <div className="mt-1.5">
          <Outcome result={step.result} />
        </div>
      )}
      {open && (
        <pre className="mt-2 max-h-64 overflow-auto rounded bg-surface p-2 font-mono text-[11px] whitespace-pre-wrap text-muted">
          {JSON.stringify(step.input, null, 2)}
          {"\n\n→ "}
          {step.summary.length > 3000 ? `${step.summary.slice(0, 3000)}…` : step.summary}
        </pre>
      )}
    </div>
  );
}

export function Chat({
  address,
  samples,
  model,
  onChanged,
}: {
  address: string;
  samples: Sample[];
  model: string | null;
  onChanged: () => void;
}) {
  const { t, lang } = useT();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function send(text: string, att: Attachment | null) {
    if (busy || (!text.trim() && !att)) return;
    const history = messages
      .filter((m): m is Extract<Message, { role: "user" | "assistant" }> => m.role !== "error")
      .map((m) => ({
        role: m.role,
        text: m.role === "user" && m.attachment ? `${m.text}\n[attached: ${m.attachment}]` : m.text,
      }))
      .filter((m) => m.text.trim())
      .slice(-12);
    setMessages((prev) => [...prev, { role: "user", text, attachment: att?.name }]);
    setInput("");
    setAttachment(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/workspace/${address}/agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ history, message: text, attachment: att ?? undefined, lang }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t("chat.failed"));
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: body.reply, steps: body.steps ?? [], flags: body.flags ?? [] },
      ]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: "error", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  const docSamples = samples.filter((s) => s.who !== "contractor");

  return (
    <section className="card flex min-h-[560px] flex-col lg:h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="font-semibold">{t("chat.title")}</h2>
          <p className="text-xs text-muted">{t("chat.subtitle")}</p>
        </div>
        <span className="pill bg-info-soft font-mono text-info">{model ?? t("chat.notConfigured")}</span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3 text-sm text-muted">
            <p>{t("chat.empty")}</p>
            <div className="flex flex-wrap gap-2">
              {docSamples.map((s) => (
                <button
                  key={s.id}
                  className={s.who === "attacker" ? "btn-danger" : "btn-ghost"}
                  disabled={busy}
                  onClick={() =>
                    send(s.who === "attacker" ? t("chat.msg.invoice") : t("chat.msg.po"), {
                      kind: "text",
                      name: `${s.title}.txt`,
                      text: s.text,
                    })
                  }
                >
                  {s.who === "attacker" ? "⚠ " : "📄 "}
                  {sampleTitle(t, s)}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-xl bg-accent px-3.5 py-2.5 text-sm text-accent-fg">
              {m.attachment && <div className="mb-1 text-xs opacity-80">📎 {m.attachment}</div>}
              {m.text}
            </div>
          ) : m.role === "error" ? (
            <div key={i} className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
              {m.text}
            </div>
          ) : (
            <div key={i} className="flex max-w-[95%] flex-col gap-2">
              {m.flags.length > 0 && (
                <div className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-xs text-bad">
                  <div className="font-semibold">{t("chat.flagged")}</div>
                  <ul className="mt-1 list-disc pl-4">
                    {m.flags.map((f) => (
                      <li key={f}>{trServer(f, lang)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {m.steps.map((s, j) => (
                <Step key={j} step={s} />
              ))}
              <div className="md rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            {t("chat.working")}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-3">
        {messages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((k) => (
              <button
                key={k}
                className="pill bg-surface-2 text-left whitespace-normal text-muted hover:text-fg"
                disabled={busy}
                onClick={() => send(t(k), null)}
              >
                {t(k)}
              </button>
            ))}
            {docSamples.map((s) => (
              <button
                key={s.id}
                className={`pill ${s.who === "attacker" ? "bg-bad-soft text-bad" : "bg-surface-2 text-muted hover:text-fg"}`}
                disabled={busy}
                onClick={() => setAttachment({ kind: "text", name: `${s.title}.txt`, text: s.text })}
              >
                📎 {sampleTitle(t, s)}
              </button>
            ))}
          </div>
        )}
        {attachment && (
          <div className="mb-2 flex items-center gap-2 text-xs">
            <span className="pill bg-info-soft text-info">📎 {attachment.name}</span>
            <button className="text-muted hover:text-fg" onClick={() => setAttachment(null)}>
              {t("common.remove")}
            </button>
          </div>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input, attachment);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md,text/plain,application/pdf"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setAttachment(await fileToAttachment(f));
              e.target.value = "";
            }}
          />
          <button type="button" className="btn-ghost h-10" onClick={() => fileRef.current?.click()} title={t("chat.attach")}>
            📎
          </button>
          <textarea
            className="h-10 max-h-40 min-h-10 flex-1 resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            placeholder={t("chat.placeholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input, attachment);
              }
            }}
          />
          <button className="btn-primary h-10" disabled={busy || (!input.trim() && !attachment)}>
            {t("chat.send")}
          </button>
        </form>
      </div>
    </section>
  );
}
