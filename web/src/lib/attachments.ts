import "server-only";

import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";

import { type Attachment, readsImagesNatively } from "./agent";
import { HttpError } from "./guard";
import { describeImage } from "./vision";

/** A file attached to an AI chat message, as the browser sends it (chat-attach.ts). */
export const AttachmentInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pdf"), name: z.string().max(200), base64: z.string().max(4_000_000) }),
  z.object({ kind: z.literal("text"), name: z.string().max(200), text: z.string().max(60_000) }),
  // Images are downscaled in the browser (about 1600 px) so they stay well under the request limit.
  z.object({ kind: z.literal("image"), name: z.string().max(200), mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]), base64: z.string().max(4_000_000) }),
]);

/** The attachment as text for the model: a text file as is, a PDF's text, an image described by one vision call (Claude reads images itself). */
export async function attachmentText(a: Attachment): Promise<string | undefined> {
  if (a.kind === "text") return a.text;
  if (a.kind === "image") {
    if (readsImagesNatively()) return undefined;
    return describeImage(a).catch((e) => {
      console.error("vision", e);
      throw new HttpError(502, "The AI could not read that image right now. Try again, or describe it in words.");
    });
  }
  try {
    const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(a.base64, "base64")));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch {
    return "";
  }
}

/** The attachment as a stored file: its bytes and media type. */
export function attachmentFile(a: Attachment): { name: string; mime: string; bytes: Buffer } {
  if (a.kind === "text") return { name: a.name, mime: "text/plain; charset=utf-8", bytes: Buffer.from(a.text, "utf8") };
  if (a.kind === "pdf") return { name: a.name, mime: "application/pdf", bytes: Buffer.from(a.base64, "base64") };
  return { name: a.name, mime: a.mediaType, bytes: Buffer.from(a.base64, "base64") };
}
