/**
 * The file formats a "file" milestone accepts, agreed in the deal (e.g. [".pdf", ".dwg"]). The seller's
 * upload is checked against them before anything is encrypted or anchored on-chain. Shared by the
 * server and the browser (the file picker only offers these).
 */

const EXT = /^\.[a-z0-9]{1,10}$/;

/** "PDF", "pdf", ".PDF", "*.pdf" → ".pdf"; unknown junk dropped; at most 12, no duplicates. */
export function normalizeFileTypes(list: readonly string[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const raw of list ?? []) {
    for (const part of String(raw).split(/[\s,;/|]+/)) {
      const ext = `.${part.trim().toLowerCase().replace(/^\*?\.?/, "")}`;
      if (EXT.test(ext)) out.add(ext === ".jpeg" ? ".jpg" : ext);
    }
  }
  return [...out].slice(0, 12);
}

export function fileTypeOk(fileName: string, types: readonly string[] | null | undefined): boolean {
  if (!types?.length) return true;
  const lower = fileName.toLowerCase();
  return types.some((t) => lower.endsWith(t) || (t === ".jpg" && lower.endsWith(".jpeg")));
}

/** For <input type="file" accept>: the extensions, comma separated (undefined: anything). */
export function acceptAttr(types: readonly string[] | null | undefined): string | undefined {
  return types?.length ? types.flatMap((t) => (t === ".jpg" ? [".jpg", ".jpeg"] : [t])).join(",") : undefined;
}

export const fileTypesLabel = (types: readonly string[] | null | undefined) => (types?.length ? types.map((t) => t.slice(1).toUpperCase()).join(", ") : "any file");

/** Rounds of changes a buyer may ask for on one delivered milestone: agreed per milestone, at most 10. */
export const MAX_REVISIONS = 10;
export const revisionsAllowed = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(MAX_REVISIONS, Math.round(n))) : MAX_REVISIONS);
