"use client";

import { useEffect, useRef, useState } from "react";

import type { AgentStep } from "@/lib/agent";
import type { Sample } from "@/lib/samples";

import { Outcome } from "./ui";

type Attachment = { kind: "pdf"; name: string; base64: string } | { kind: "text"; name: string; text: string };

type Message =
  | { role: "user"; text: string; attachment?: string }
  | { role: "assistant"; text: string; steps: AgentStep[]; flags: string[] }
  | { role: "error"; text: string };

const TOOL_LABEL: Record<string, string> = {
  get_wallet_status: "Read wallet status",
  list_deals: "Read deals & evidence",
  forecast_cashflow: "Forecast cash flow",
  propose_deal_setup: "Propose escrow deal",
  release_milestone: "Release milestone",
  transfer: "Transfer",
  pause_wallet: "Pause wallet",
};

const SUGGESTIONS = [
  "Check the latest contractor evidence and pay whatever is due.",
  "What payments are coming up, and can we cover them?",
  "Summarize the wallet's limits and pending approvals.",
];

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
  const [open, setOpen] = useState(false);
  const label = TOOL_LABEL[step.tool] ?? step.tool;
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm">
      <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen((v) => !v)}>
        <span className="font-medium">
          <span className="mr-1.5 font-mono text-xs text-muted">tool</span>
          {label}
        </span>
        <span className="text-xs text-muted">{open ? "hide" : "details"}</span>
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
  onChanged,
}: {
  address: string;
  samples: Sample[];
  onChanged: () => void;
}) {
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
        body: JSON.stringify({ history, message: text, attachment: att ?? undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Agent request failed");
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
          <h2 className="font-semibold">AI agent</h2>
          <p className="text-xs text-muted">Acts for the buyer. Every action goes through the policy engine and the contract.</p>
        </div>
        <span className="pill bg-info-soft text-info">Claude</span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3 text-sm text-muted">
            <p>Start by sending the agent a purchase order, or try the phishing invoice.</p>
            <div className="flex flex-wrap gap-2">
              {docSamples.map((s) => (
                <button
                  key={s.id}
                  className={s.who === "attacker" ? "btn-danger" : "btn-ghost"}
                  disabled={busy}
                  onClick={() =>
                    send(
                      s.who === "attacker"
                        ? "We received this invoice from our contractor. Please handle it."
                        : "Here is a new purchase order. Please set up the milestone escrow.",
                      { kind: "text", name: `${s.title}.txt`, text: s.text },
                    )
                  }
                >
                  {s.who === "attacker" ? "⚠ " : "📄 "}
                  {s.title}
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
                  <div className="font-semibold">Untrusted-content scan flagged this document</div>
                  <ul className="mt-1 list-disc pl-4">
                    {m.flags.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              {m.steps.map((s, j) => (
                <Step key={j} step={s} />
              ))}
              <div className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm whitespace-pre-wrap">{m.text}</div>
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            Agent is reading, checking policy and signing… (can take up to a minute)
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-3">
        {messages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="pill bg-surface-2 text-left whitespace-normal text-muted hover:text-fg" disabled={busy} onClick={() => send(s, null)}>
                {s}
              </button>
            ))}
            {docSamples.map((s) => (
              <button
                key={s.id}
                className={`pill ${s.who === "attacker" ? "bg-bad-soft text-bad" : "bg-surface-2 text-muted hover:text-fg"}`}
                disabled={busy}
                onClick={() => setAttachment({ kind: "text", name: `${s.title}.txt`, text: s.text })}
              >
                📎 {s.title}
              </button>
            ))}
          </div>
        )}
        {attachment && (
          <div className="mb-2 flex items-center gap-2 text-xs">
            <span className="pill bg-info-soft text-info">📎 {attachment.name}</span>
            <button className="text-muted hover:text-fg" onClick={() => setAttachment(null)}>
              remove
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
          <button type="button" className="btn-ghost h-10" onClick={() => fileRef.current?.click()} title="Attach PDF or text">
            📎
          </button>
          <textarea
            className="h-10 max-h-40 min-h-10 flex-1 resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            placeholder="Ask the agent, or attach a PO / invoice…"
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
            Send
          </button>
        </form>
      </div>
    </section>
  );
}
