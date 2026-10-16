"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** "D-12" in a reply becomes a link to that deal's page (outside code spans and existing links). */
function linkDeals(text: string): string {
  return text
    .split(/(`[^`]*`|\[[^\]]*\]\([^)]*\))/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/(^|[^\w/[-])D-(\d{1,6})\b/g, "$1[D-$2](/deals/D-$2)")))
    .join("");
}

/** The AI's replies: Markdown, with deal numbers as links; links to this app open in it. */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href = "", children }) =>
          href.startsWith("/") && !href.startsWith("//") ? (
            <Link href={href}>{children}</Link>
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
