import { getAddress } from "viem";
import { z } from "zod";

import { MAX_CHATS, deleteChat, getChat, listChats } from "@/lib/chats";
import { deviceRoute } from "@/lib/device-chain/route";
import { HttpError } from "@/lib/guard";

/** The saved AI chats of the wallet the app shows (the same ones the website shows): ?id= for one chat. */
export const GET = deviceRoute(
  async (device, _body, req) => {
    const wallet = getAddress(device.walletAddress);
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const chat = await getChat(device.userId, wallet, id.slice(0, 40));
      if (!chat) throw new HttpError(404, "Chat not found");
      return { id: chat.id, title: chat.title, messages: chat.messages };
    }
    return { chats: await listChats(device.userId, wallet), max: MAX_CHATS };
  },
  { acting: true },
);

/** Deletes a saved chat (drafts made in it stay). */
export const POST = deviceRoute(
  async (device, body) => {
    const b = z.object({ delete: z.string().max(40) }).safeParse(body);
    if (!b.success) throw new HttpError(400, "Which chat?");
    if (!(await deleteChat(device.userId, getAddress(device.walletAddress), b.data.delete))) throw new HttpError(404, "Chat not found");
    return { chats: await listChats(device.userId, getAddress(device.walletAddress)), max: MAX_CHATS };
  },
  { acting: true },
);
