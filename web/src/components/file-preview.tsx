"use client";

import { type CSSProperties, useEffect, useState } from "react";

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const previewable = (mime: string, name = "") => mime === "application/pdf" || /\.pdf$/i.test(name) || /^image\/(png|jpeg|webp|gif)$/.test(mime);

const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
const panel: CSSProperties = { width: "min(960px, 100%)", height: "min(88vh, 1100px)", background: "#111", border: "1px solid #333", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" };
const bar: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 14px", borderBottom: "1px solid #2a2a2a", color: "#eee", fontSize: 13 };
const btn: CSSProperties = { border: "1px solid #444", background: "transparent", color: "#eee", borderRadius: 8, padding: "5px 10px", fontSize: 12, cursor: "pointer", textDecoration: "none" };

/**
 * A work file (a PDF or an image) shown inside the page: the browser's own PDF viewer in a frame
 * (the file route allows framing by this site only and serves PDFs without scripts). Other kinds
 * of files are only downloaded.
 */
export function FilePreview({ href, name, mime, onClose }: { href: string; name: string; mime: string; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const image = mime.startsWith("image/");
  return (
    <div style={overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label={`Preview of ${name}`}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={bar}>
          <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</b>
          <span style={{ display: "flex", gap: 6, flex: "none" }}>
            <a style={btn} href={href} target="_blank" rel="noopener">
              Open in a new tab
            </a>
            <button type="button" style={btn} onClick={onClose}>
              Close
            </button>
          </span>
        </div>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={href} alt={name} style={{ flex: 1, minHeight: 0, objectFit: "contain", background: "#0b0b0b" }} />
        ) : (
          <iframe src={href} title={name} style={{ flex: 1, border: 0, background: "#525659" }} />
        )}
      </div>
    </div>
  );
}

/** One file row: Preview (PDFs and images) and Download. */
export function FileLink({ href, name, mime, size, className }: { href: string; name: string; mime: string; size?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const can = previewable(mime, name);
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span>
        📎 {name}
        {size !== undefined && <small style={{ opacity: 0.7 }}> · {kb(size)}</small>}
      </span>
      {can && (
        <button type="button" style={{ ...btn, color: "#9fc1ff", borderColor: "#34507a" }} onClick={() => setOpen(true)}>
          Preview
        </button>
      )}
      <a style={btn} href={href} download={name}>
        Download
      </a>
      {open && <FilePreview href={href} name={name} mime={mime === "application/octet-stream" ? "application/pdf" : mime} onClose={() => setOpen(false)} />}
    </span>
  );
}

/** A delivered PDF before approval: its first pages as watermarked images (the file stays locked). */
export function PdfPagePreview({ base, alt }: { base: string; alt: string }) {
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState<number | null>(null);
  const src = `${base}?page=${page}`;
  useEffect(() => {
    let live = true;
    fetch(`${base}?page=1`, { method: "HEAD" })
      .then((r) => live && setPages(Number(r.headers.get("x-preview-pages")) || 1))
      .catch(() => live && setPages(1));
    return () => {
      live = false;
    };
  }, [base]);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`${alt}, page ${page}`} loading="lazy" style={{ maxWidth: "100%", borderRadius: 8 }} />
      {pages !== null && pages > 1 && (
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <button type="button" style={btn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ‹ Prev
          </button>
          Page {page} of {pages} (watermarked preview; the file opens after approval)
          <button type="button" style={btn} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next ›
          </button>
        </span>
      )}
    </div>
  );
}
