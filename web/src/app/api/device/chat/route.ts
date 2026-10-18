import { getAddress } from "viem";
import { z } from "zod";

import { llmConfigured, runAgent, runWithUserLlm, userLlmOf } from "@/lib/agent";
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
  /** Bring your own key: the user's provider, model and API key, for this request only (never stored). */
  byok: z
    .object({
      provider: z.enum(["anthropic", "openrouter"]),
      apiKey: z.string().trim().min(20).max(300),
      model: z.string().trim().min(2).max(120).regex(/^[\w.:/-]+$/),
    })
    .optional(),
});

/**
 * The AI agent from the desktop app: the same agent and tools as the website's chat. Its history
 * is kept on the computer. Drafts it makes are confirmed in the app with a signed block.
 */
export const POST = deviceRoute(async (device, body) => {
  if (!(await prefsOf(device.userId)).aiChat) throw new HttpError(403, "The AI chat is off (Profile & Privacy on the website)");
  const parsed = Body.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.path.includes("byok") ? "Check your own AI key and model (Settings → AI)" : "Invalid request");
  const { history, message, lang, attachment, byok } = parsed.data;
  if (!byok && !llmConfigured()) throw new HttpError(503, "The AI agent is not configured: add your own key in Settings → AI");
  if (!message && !attachment) throw new HttpError(400, "Send a message or a document");
  const wallet = getAddress(device.walletAddress);
  const text = attachment ? await attachmentText(attachment) : undefined;
  const flags = text ? scanForInjection(text, await readWallet(wallet)) : [];
  const note =
    "The user is in the Agentic Wallet desktop app: previews you make appear under the chat there, and the user confirms them with their device key. The app shows no forms or buttons inside your messages: when you need details, also ask for them in plain text, one short list. Format replies in Markdown (short paragraphs, lists, tables when they help).";
  const run = () => runAgent(wallet, history, message, attachment, text, lang, device.userId, undefined, note);
  try {
    const { reply, steps } = byok ? await runWithUserLlm(userLlmOf(byok), run) : await run();
    return { reply, steps: steps.map(publicStep), flags, model: byok ? `${byok.provider}:${byok.model}` : null };
  } catch (e) {
    // A provider's refusal of the user's own key: say so without echoing anything about the key.
    const status = (e as { status?: number }).status;
    if (byok && (status === 401 || status === 403)) throw new HttpError(400, `Your ${byok.provider} key was refused (check it in Settings → AI)`);
    if (byok && status === 404) throw new HttpError(400, `${byok.provider} does not know the model "${byok.model}"`);
    if (byok && status === 429) throw new HttpError(429, `Your ${byok.provider} account is out of credit or rate-limited`);
    throw e;
  }
});
