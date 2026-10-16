"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { DraftView } from "@/lib/bank/drafts";
import { useLang } from "@/lib/i18n";

import { api, useAppData } from "./app-data";
import { DraftCard } from "./mockup-live";
import { Button, Loading } from "./mockup-ui";
import "./group-chat.css";

type Step = { tool: string; summary: string; draft?: DraftView; form?: { missing: string[] }; wallet: string; mine: boolean; inVote?: boolean };
type Message = { id: string; ai: boolean; mine: boolean; author: string; text: string; steps: Step[]; at: string };

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * The group's chat. Members talk; "Ask AI" sends the message to the group's agent too, which
 * answers for everyone and can propose a deal in the group's name (a preview: only the member who
 * asked confirms it, then the signers vote).
 */
export function GroupChat({ groupId, threshold, shared }: { groupId: string; threshold: number; shared: string | null }) {
  const lang = useLang();
  const { me, refresh } = useAppData();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [text, setText] = useState("");
  const [askAi, setAskAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const currency = me?.bank.currency ?? "THB";

  const load = useCallback(async () => {
    try {
      setMessages((await api<{ messages: Message[] }>(`/api/groups/${groupId}/chat`)).messages);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [groupId]);
  useEffect(() => {
    // Loading the chat (and polling for the others' messages) is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => void load(), 6000);
    return () => clearInterval(t);
  }, [load]);
  const count = messages?.length ?? 0;
  // Newest at the bottom: scroll the chat itself, never the page.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [count, thinking]);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    setText("");
    // Show the message at once; the AI's answer follows.
    setMessages((m) => [...(m ?? []), { id: `local-${Date.now()}`, ai: false, mine: true, author: me?.user.name ?? "You", text: body, steps: [], at: new Date().toISOString() }]);
    if (askAi) setThinking(true);
    try {
      await api(`/api/groups/${groupId}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: body, askAi, lang }) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setThinking(false);
      setBusy(false);
      await load();
    }
  }

  async function act(step: Step, d: DraftView, kind: "approve" | "discard") {
    setError(null);
    try {
      if (kind === "discard") await api(`/api/workspace/${step.wallet}/drafts/${d.id}`, { method: "DELETE" });
      else await api(`/api/workspace/${step.wallet}/drafts/${d.id}/approve`, { method: "POST" });
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="aw-gchat">
      <header>
        <div>
          <h3>Group chat</h3>
          <small>
            Everyone in the group reads this. Ask the AI to plan, hire or sell{shared ? ` in the name of ${shared}` : ""}: it only proposes; the one who asked confirms, then {threshold} signers vote.
          </small>
        </div>
      </header>
      <div className="aw-gchat-list" ref={list}>
        {messages === null && <Loading text="Loading the chat…" />}
        {messages?.length === 0 && <p className="aw-gchat-empty">No messages yet. Say hi, or ask the AI something like “hire a designer for our logo, ฿6,000 in 2 milestones”.</p>}
        {messages?.map((m) => (
          <div key={m.id} className={`aw-gchat-msg${m.ai ? " ai" : m.mine ? " mine" : ""}`}>
            <small>
              {m.ai ? "✦ AI agent" : m.mine ? "You" : m.author} · {time(m.at)}
            </small>
            <div className="aw-gchat-bubble">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
            </div>
            {m.steps.map((s, i) =>
              s.draft ? (
                <div key={i} className="aw-gchat-card">
                  {s.mine ? (
                    <DraftCard
                      draft={s.draft}
                      currency={currency}
                      company={shared ? { name: shared, threshold } : null}
                      onApprove={(d) => void act(s, d, "approve")}
                      onDiscard={(d) => void act(s, d, "discard")}
                    />
                  ) : (
                    <p className="aw-gchat-note">
                      ✦ Proposed “{s.draft.title}” for whoever asked:{" "}
                      {s.draft.status === "PREVIEW"
                        ? "waiting for them to confirm."
                        : s.inVote
                          ? "now in the group vote (Approvals → Group votes)."
                          : s.draft.status === "FUNDED"
                            ? `done · deal #${s.draft.dealId}.`
                            : s.draft.status.toLowerCase()}
                    </p>
                  )}
                  {s.mine && s.inVote && <p className="aw-gchat-note">In the group vote now: signers approve in Approvals → Group votes.</p>}
                </div>
              ) : s.form ? (
                <p key={i} className="aw-gchat-note">
                  ✦ The AI needs: {s.form.missing.join(", ")}. Reply here with the details.
                </p>
              ) : null,
            )}
          </div>
        ))}
        {thinking && (
          <div className="aw-gchat-msg ai">
            <small>✦ AI agent</small>
            <div className="aw-gchat-bubble">
              <Loading text="Thinking…" />
            </div>
          </div>
        )}
      </div>
      {error && <p className="aw-bank-error">{error}</p>}
      <form className="aw-gchat-form" onSubmit={post}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={askAi ? "Ask the AI or write to the group…" : "Write to the group…"}
          rows={2}
          maxLength={2000}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div>
          <label className="aw-gchat-ai">
            <input type="checkbox" checked={askAi} onChange={(e) => setAskAi(e.target.checked)} /> Ask AI
          </label>
          <Button type="submit" disabled={busy || !text.trim()}>
            {busy ? "…" : "Send"}
          </Button>
        </div>
      </form>
    </section>
  );
}
