import { getAddress } from "viem";
import { z } from "zod";

import { llmConfigured, runAgent } from "@/lib/agent";
import { AttachmentInput, attachmentText } from "@/lib/attachments";
import { publicStep } from "@/lib/chats";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";
import { scanForInjection } from "@/lib/policy";
import { prefsOf } from "@/lib/prefs";
import { readWallet } from "@/lib/state";

export const maxDuration = 300;

const Body = z.object({
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) }))
    .max(30)
    .default([]),
  message: z.string().max(4000).default(""),
  lang: z.enum(["en", "th"]).default("en"),
  attachment: AttachmentInput.optional(),
});

/**
 * The AI agent from the desktop app: the same agent and tools as the website's chat. Its history
 * is kept on the computer. Drafts it makes are confirmed in the app with a signed block.
 */
export const POST = deviceRoute(async (device, body) => {
  if (!llmConfigured()) throw new HttpError(503, "The AI agent is not configured");
  if (!(await prefsOf(device.userId)).aiChat) throw new HttpError(403, "The AI chat is off (Profile & Privacy on the website)");
  const parsed = Body.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const { history, message, lang, attachment } = parsed.data;
  if (!message && !attachment) throw new HttpError(400, "Send a message or a document");
  const wallet = getAddress(device.walletAddress);
  const text = attachment ? await attachmentText(attachment) : undefined;
  const flags = text ? scanForInjection(text, await readWallet(wallet)) : [];
  const { reply, steps } = await runAgent(wallet, history, message, attachment, text, lang, device.userId, undefined, "The user is in the Agentic Wallet desktop app: previews you make appear under the chat there, and the user confirms them with their device key. The app shows no forms or buttons inside your messages: when you need details, also ask for them in plain text, one short list.");
  return { reply, steps: steps.map(publicStep), flags };
});
