"use client";

type DealFileRow = { id: string; name: string; mime: string; size: number };

export const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The same files on a private link's page (no account): links that go through the link's token. */
export function DealFileLinks({ base, dealId, files, from }: { base: string; dealId: number; files: DealFileRow[]; from: string }) {
  if (!files.length) return null;
  return (
    <div className="inv-files">
      <small className="inv-label">FILES FROM {from.toUpperCase()}</small>
      {files.map((f) => (
        <a key={f.id} href={`${base}/deal-files/${dealId}/${f.id}`} target="_blank" rel="noopener">
          📎 {f.name} <small>{kb(f.size)}</small>
        </a>
      ))}
    </div>
  );
}
