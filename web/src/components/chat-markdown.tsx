"use client";

import Link from "next/link";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** "D-12" in a reply becomes a link to that deal's page (outside code spans and existing links). */
function linkDeals(text: string): string {
  return text
    .split(/(`[^`]*`|\[[^\]]*\]\([^)]*\))/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/(^|[^\w/[-])D-(\d{1,6})\b/g, "$1[D-$2](/deals/D-$2)")))
    .join("");
}

/** Copies text; falls back to a hidden textarea where the Clipboard API is refused. True when it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const t = document.createElement("textarea");
      t.value = text;
      t.setAttribute("readonly", "");
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand("copy");
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Copying something that only exists after a slow request (a private link made on Confirm):
 * browsers allow clipboard writes only during the click, so the write starts in the click with a
 * pending ClipboardItem and is filled in when the link arrives. `resolve(null)` cancels it.
 * Falls back to a plain copy (which may be refused) where ClipboardItem promises are unsupported.
 */
export function startDeferredCopy(): { resolve: (text: string | null) => void; done: Promise<boolean> } {
  let fill: (t: string | null) => void = () => {};
  const text = new Promise<string | null>((r) => (fill = r));
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      const blob = text.then((t) => {
        if (t === null) throw new Error("nothing to copy");
        return new Blob([t], { type: "text/plain" });
      });
      const done = navigator.clipboard
        .write([new ClipboardItem({ "text/plain": blob })])
        .then(() => true)
        .catch(() => false);
      return { resolve: fill, done };
    } catch {
      /* fall through */
    }
  }
  return { resolve: fill, done: text.then((t) => (t === null ? false : copyText(t))) };
}

/** A small "Copy link" button. */
export function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <button
      type="button"
      className={`aw-copy-btn ${state}`}
      onClick={async () => {
        setState((await copyText(text)) ? "ok" : "fail");
        setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "ok" ? "✓ Copied" : state === "fail" ? "Copy failed: select it" : `⧉ ${label}`}
    </button>
  );
}

/** Private links (a seller's or buyer's) get a copy button next to them. */
const isShareLink = (href: string) => /^https?:\/\/[^/]+\/(invite|pay|groups\/join)\//.test(href);

/** The AI's replies: Markdown, with deal numbers as links; links to this app open in it. */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href = "", children }) =>
          href.startsWith("/") && !href.startsWith("//") ? (
            <Link href={href}>{children}</Link>
          ) : isShareLink(href) ? (
            <span className="aw-share-link">
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
              <CopyButton text={href} />
            </span>
          ) : (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
      }}
    >
      {linkDeals(text)}
    </ReactMarkdown>
  );
}

/** The button open_deal shows. */
export function OpenDealButton({ dealId, title }: { dealId: number; title: string }) {
  return (
    <Link className="aw-open-deal" href={`/deals/D-${dealId}`}>
      <span>
        <small>D-{dealId}</small>
        <b>{title}</b>
      </span>
      <i>Open deal →</i>
    </Link>
  );
}
