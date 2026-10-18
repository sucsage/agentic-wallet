"use client";

import { type FormEvent, useEffect, useState } from "react";

import { FileLink } from "./file-preview";
import "./invite.css";

type Post = {
  title: string;
  summary: string;
  requirements: string;
  kind: "HIRE" | "GOODS";
  owner: string;
  currency: "THB" | "CNY";
  budget: number;
  milestones: { name: string; amount: number; acceptance: string }[];
  reviewHours: number;
  closesAt: string;
  open: boolean;
  positions: number;
  chosen: number;
  files: { id: string; name: string; mime: string; size: number }[];
};

/**
 * A public link (open call): anyone can read the brief and apply with a message, a price, portfolio
 * links and up to 3 files. No account. The owner sees the applications and may choose one; the one
 * chosen then gets a private link and a one-time code from the owner.
 */
export function ApplyPage({ slug }: { slug: string }) {
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState({ name: "", contact: "", message: "", links: "", price: "", website: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [portfolio, setPortfolio] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/apply/${slug}`, { cache: "no-store" })
      .then(async (r) => {
        const b = await r.json().catch(() => null);
        if (!r.ok) throw new Error(b?.error ?? "This post is not available");
        setPost(b);
      })
      .catch((e: Error) => setError(e.message));
  }, [slug]);

  const sign = post?.currency === "CNY" ? "¥" : "฿";
  const money = (n: number) => `${sign}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormErr(null);
    if (!portfolio) return setFormErr("Attach your portfolio as a PDF");
    if (portfolio.type !== "application/pdf" && !/\.pdf$/i.test(portfolio.name)) return setFormErr("The portfolio must be a PDF file");
    if (files.length > 3 || [portfolio, ...files].some((f) => f.size > 4 * 1024 * 1024)) return setFormErr("A portfolio and up to 3 other files, 4 MB each");
    setBusy(true);
    try {
      const form = new FormData();
      for (const [k, val] of Object.entries(v)) form.set(k, val);
      form.set("portfolio", portfolio);
      for (const f of files) form.append("files", f);
      const r = await fetch(`/api/apply/${slug}`, { method: "POST", body: form });
      const b = await r.json().catch(() => null);
      if (!r.ok) throw new Error(b?.error ?? `Sending failed (${r.status})`);
      setDone(b?.replaced ? "Updated: your new application replaces the earlier one." : "Sent ✓");
    } catch (e2) {
      setFormErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inv-page">
      <div className="inv-banner">DEMO · simulated money · an open call on Agentic Wallet</div>
      <main className="inv-main">
        <header className="inv-head">
          <span className="inv-mark" aria-hidden />
          <div>
            <small>Agentic Wallet · open call</small>
            <h1>{post ? post.title : error ? "Not available" : "Loading…"}</h1>
            {post && (
              <p>
                <b>{post.owner}</b> is {post.kind === "HIRE" ? "looking for someone to hire" : "looking to buy"}. Apply below: no account needed.
              </p>
            )}
          </div>
        </header>
        {error && <p className="inv-error">{error}</p>}
        {post && (
          <>
            <section className="inv-card">
              <p>{post.summary}</p>
              <p>
                <b>Please send:</b> {post.requirements}
              </p>
              <p className="inv-muted">
                Budget {money(post.budget)} · paid through escrow, milestone by milestone after approval ({post.reviewHours} h to review each delivery). Applications close{" "}
                {new Date(post.closesAt).toLocaleDateString()}.
              </p>
              {post.positions > 1 && (
                <p className="inv-muted">
                  Hiring {post.positions} people ({post.chosen} chosen so far): each gets their own deal on these terms.
                </p>
              )}
              {post.files.length > 0 && (
                <div className="inv-files">
                  <small className="inv-label">DOCUMENTS FROM {post.owner.toUpperCase()} · READ BEFORE APPLYING</small>
                  {post.files.map((f) => (
                    <FileLink key={f.id} href={`/api/apply/${slug}/files/${f.id}`} name={f.name} mime={f.mime} size={f.size} />
                  ))}
                </div>
              )}
              {post.milestones.map((m, i) => (
                <div className="inv-ms" key={i}>
                  <div className="inv-ms-head">
                    <b>
                      {i + 1}. {m.name}
                    </b>
                    <span>{money(m.amount)}</span>
                  </div>
                  <small className="inv-muted">To be approved: {m.acceptance}</small>
                </div>
              ))}
            </section>
            {!post.open ? (
              <p className="inv-muted">This post is closed: it no longer takes applications.</p>
            ) : done ? (
              <section className="inv-card">
                <b>{done}</b>
                <p className="inv-muted">
                  {post.owner} reads every application. If they choose you, they send you a private link and a one-time code to the contact you gave: the deal, the escrow and your payout are there.
                </p>
              </section>
            ) : (
              <section className="inv-card">
                <form className="inv-form" onSubmit={submit}>
                  <label>
                    <span>Your name</span>
                    <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required minLength={2} maxLength={80} autoComplete="name" />
                  </label>
                  <label>
                    <span>How to reach you (email or phone; only {post.owner} sees it)</span>
                    <input value={v.contact} onChange={(e) => setV({ ...v, contact: e.target.value })} required minLength={5} maxLength={160} />
                  </label>
                  <label>
                    <span>Your proposal: why you, how you would do it</span>
                    <textarea value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} rows={5} required minLength={10} maxLength={4000} />
                  </label>
                  <label>
                    <span>Portfolio links (optional, one per line, up to 5)</span>
                    <textarea value={v.links} onChange={(e) => setV({ ...v, links: e.target.value })} rows={3} placeholder="https://…" />
                  </label>
                  <label>
                    <span>Your price ({sign}, optional)</span>
                    <input value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} inputMode="decimal" />
                  </label>
                  <label>
                    <span>Portfolio (one PDF, required · 4 MB max): {post.owner}&apos;s AI reads it to compare applicants</span>
                    <input type="file" accept="application/pdf,.pdf" required onChange={(e) => setPortfolio(e.target.files?.[0] ?? null)} />
                  </label>
                  <label>
                    <span>Other files (samples, a quotation · optional, up to 3, 4 MB each)</span>
                    <input type="file" multiple onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 3))} />
                  </label>
                  <input className="inv-hp" tabIndex={-1} autoComplete="off" aria-hidden value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} name="website" />
                  <button className="inv-btn" type="submit" disabled={busy}>
                    {busy ? "Sending…" : "Send application"}
                  </button>
                  {formErr && <p className="inv-error">{formErr}</p>}
                </form>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
