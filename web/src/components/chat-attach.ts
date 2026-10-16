/** Files the AI chat can read: images (downscaled here), PDFs and plain-text files. */

export type ChatAttachment =
  | { kind: "pdf"; name: string; base64: string }
  | { kind: "text"; name: string; text: string }
  | { kind: "image"; name: string; mediaType: "image/jpeg" | "image/png"; base64: string };

export const ATTACH_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/heic,application/pdf,.pdf,.txt,.csv,.md,.json,text/plain,text/csv";

const MAX_SIDE = 1600;
const MAX_PDF = 3 * 1024 * 1024;
const MAX_TEXT = 60_000;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Any image → JPEG at most 1600 px on its longest side (keeps requests small and readable). */
async function shrinkImage(file: File): Promise<{ base64: string; mediaType: "image/jpeg" }> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("This image format cannot be read here. Use PNG, JPEG or WebP.");
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read the image");
  ctx.fillStyle = "#fff"; // transparent PNGs on white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mediaType: "image/jpeg" };
}

export async function fileToChatAttachment(file: File): Promise<ChatAttachment> {
  const lower = file.name.toLowerCase();
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic)$/.test(lower)) {
    const { base64, mediaType } = await shrinkImage(file);
    return { kind: "image", name: file.name || "image.jpg", mediaType, base64 };
  }
  if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
    if (file.size > MAX_PDF) throw new Error("PDFs up to 3 MB");
    return { kind: "pdf", name: file.name, base64: toBase64(await file.arrayBuffer()) };
  }
  if (file.type.startsWith("text/") || /\.(txt|csv|md|json)$/.test(lower)) {
    const text = await file.text();
    return { kind: "text", name: file.name, text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…(cut)` : text };
  }
  throw new Error("The AI reads images, PDFs and text files (TXT, CSV, MD, JSON)");
}
