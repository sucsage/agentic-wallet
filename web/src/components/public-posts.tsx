"use client";

import { useCallback, useEffect, useState } from "react";

import { localizeMockupNode, useLang } from "@/lib/i18n";

import { api, tokenMoney } from "./app-data";
import { copyText } from "./chat-markdown";
import { FileLink } from "./file-preview";
import { toast } from "./header-tools";
import { Button, Loading } from "./mockup-ui";
import { askConfirm } from "./ui-dialog";

type Application = {
  id: string;
  name: string;
  contact: string;
  message: string;
  links: string[];
  price: number | null;
  files: { id: string; name: string; mime: string; size: number; kind?: string }[];
  ai: { score: number; reason: string; rank: number } | null;
  chosenAt: string | null;
  at: string;
};
type Post = {
  id: string;
  title: string;
  summary: string;
  requirements: string;
  budget: number;
  status: string;
  open: boolean;
  closesAt: string;
  awardedTo: string | null;
  link: string;
  positions: number;
  chosen: number;
  files: { id: string; name: string; mime: string; size: number }[];
  applications: Application[];
};

/**
 * Deals → Public posts: the user's open calls (public links), every application with its links and
 * files, the AI's ranking, and "Choose" to draft the deal with that person.
 */
export function PublicPostsPanel({ currency, onChosen, onCount }: { currency: "THB" | "CNY"; onChosen: (draftId: string, text: string) => void; onCount?: (n: number) => void }) {
  const lang = useLang();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await api<{ posts: Post[] }>("/api/posts");
      setPosts(r.posts);
      onCount?.(r.posts.length);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [onCount]);
  useEffect(() => {
    // Reading the posts when the tab opens is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const post = (path: string, body: object = {}) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!posts) return err ? <p className="aw-bank-error">{err}</p> : <Loading text="Loading your public posts…" />;
  return localizeMockupNode(
    <div className="aw-posts">
      <p className="aw-posts-intro">
        A <b>public link</b> is an open call: anyone with it can apply with a proposal, a price, portfolio links and files. Ask the AI in the chat, e.g. “post a public call for a logo designer, ฿6,000, applicants send 3 samples”. A <b>private link</b> is for one person you already chose.
      </p>
      {posts.length === 0 && <p className="aw-posts-empty">No public posts yet.</p>}
      {posts.map((p) => {
        const apps = [...p.applications].sort((a, b) => (a.ai?.rank ?? 999) - (b.ai?.rank ?? 999));
        return (
          <article key={p.id} className="aw-post">
            <header>
              <div>
                <b>{p.title}</b>
                <small>
                  Budget {tokenMoney(p.budget, currency)} each · hiring {p.positions} · chosen {p.chosen}/{p.positions} · {p.applications.length} application{p.applications.length === 1 ? "" : "s"} ·{" "}
                  {p.status === "AWARDED" ? "all places taken" : p.open ? `open until ${new Date(p.closesAt).toLocaleDateString()}` : "closed"}
                </small>
              </div>
              <span className={`aw-post-status ${p.open ? "open" : p.status.toLowerCase()}`}>{p.open ? "Open" : p.status === "AWARDED" ? "All chosen" : "Closed"}</span>
            </header>
            <div className="aw-post-link">
              <input readOnly value={p.link} onFocus={(e) => e.currentTarget.select()} aria-label="Public link" />
              <Button
                variant="outline"
                onClick={async () => toast((await copyText(p.link)) ? { text: "Public link copied", tone: "ok" } : { text: "Copy failed: select the link", tone: "info" })}
              >
                Copy link
              </Button>
              {p.applications.length > 0 && (
                <Button disabled={!!busy} onClick={() => void run(`r${p.id}`, async () => void (await post(`/api/posts/${p.id}/recommend`)))}>
                  {busy === `r${p.id}` ? "The AI is reading…" : "✦ AI: who fits best?"}
                </Button>
              )}
              {p.open && (
                <Button variant="outline" disabled={!!busy} onClick={async () => (await askConfirm("Close this post? The link stops taking applications.")) && void run(`c${p.id}`, async () => void (await post(`/api/posts/${p.id}/close`)))}>
                  Close
                </Button>
              )}
            </div>
            <PostDocuments post={p} busy={!!busy} onChange={() => void load()} onError={setErr} />
            {apps.map((a) => (
              <div key={a.id} className={`aw-post-app${a.chosenAt ? " chosen" : ""}`}>
                <div className="aw-post-app-head">
                  <b>
                    {a.ai ? `#${a.ai.rank} · ` : ""}
                    {a.name}
                  </b>
                  {a.price !== null && <span>{tokenMoney(a.price, currency)}</span>}
                  {a.ai && <span className={`aw-post-score ${a.ai.score >= 70 ? "hi" : a.ai.score >= 40 ? "mid" : "lo"}`}>AI {a.ai.score}/100</span>}
                </div>
                {a.ai && <small className="aw-post-reason">✦ {a.ai.reason}</small>}
                <p>{a.message}</p>
                {(a.links.length > 0 || a.files.length > 0) && (
                  <div className="aw-post-attach">
                    {a.links.map((l) => (
                      <a key={l} href={l} target="_blank" rel="noopener noreferrer nofollow">
                        🔗 {l.replace(/^https?:\/\//, "").slice(0, 48)}
                      </a>
                    ))}
                    {a.files.map((f) => (
                      <span key={f.id} className="aw-post-file">
                        {f.kind === "portfolio" && <small className="aw-post-portfolio">Portfolio</small>}
                        <FileLink href={`/api/posts/files/${f.id}`} name={f.name} mime={f.mime} size={f.size} />
                      </span>
                    ))}
                  </div>
                )}
                <small className="aw-post-contact">Contact (only you see it): {a.contact}</small>
                {a.chosenAt && <span className="aw-post-score hi">✓ Chosen · their deal is in your previews</span>}
                {!a.chosenAt && p.chosen < p.positions && p.status !== "CLOSED" && (
                  <Button
                    disabled={!!busy}
                    onClick={() =>
                      void run(`h${a.id}`, async () => {
                        const r = await api<{ draftId: string; name: string; contact: string; chosen: number; positions: number }>(`/api/posts/${p.id}/choose`, {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ applicationId: a.id }),
                        });
                        onChosen(r.draftId, `Deal drafted for ${r.name} (${r.chosen} of ${r.positions} chosen). Confirm it: their private link and one-time code are made then; send them to ${r.contact} (the code separately).`);
                      })
                    }
                  >
                    {busy === `h${a.id}` ? "Drafting…" : `Choose ${a.name}`}
                  </Button>
                )}
              </div>
            ))}
          </article>
        );
      })}
      {err && <p className="aw-bank-error">{err}</p>}
    </div>,
    lang,
  );
}

/** The owner's documents for applicants (rules, a brief): they see them on the post's page. */
function PostDocuments({ post, busy, onChange, onError }: { post: Post; busy: boolean; onChange: () => void; onError: (e: string) => void }) {
  const [uploading, setUploading] = useState(false);
  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      await api(`/api/posts/${post.id}/files`, { method: "POST", body: form });
      onChange();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="aw-post-docs">
      <small>
        <b>Documents for applicants</b> (rules, a brief · up to 5, 4 MB each): they read them on the post&apos;s page.
      </small>
      {post.files.map((f) => (
        <span key={f.id} className="aw-post-file">
          <FileLink href={`/api/posts/${post.id}/files/${f.id}`} name={f.name} mime={f.mime} size={f.size} />
          <Button
            variant="outline"
            disabled={busy || uploading}
            onClick={async () => {
              try {
                await api(`/api/posts/${post.id}/files/${f.id}`, { method: "DELETE" });
                onChange();
              } catch (e) {
                onError((e as Error).message);
              }
            }}
          >
            Remove
          </Button>
        </span>
      ))}
      {post.files.length < 5 && (
        <label className="aw-post-upload">
          <input type="file" disabled={busy || uploading} onChange={(e) => void upload(e.target.files?.[0])} />
          <span>{uploading ? "Uploading…" : "+ Attach a document"}</span>
        </label>
      )}
    </div>
  );
}
