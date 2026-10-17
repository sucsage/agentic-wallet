import { asDealFileHttp, fileResponse, readDealFile, removeDealFile } from "@/lib/deal-files";
import { HttpError, errorResponse, requireBankWallet } from "@/lib/guard";

const asHttp = (e: unknown) => {
  throw asDealFileHttp(e) ? new HttpError(404, (e as Error).message) : e;
};

export async function GET(_req: Request, ctx: RouteContext<"/api/deals/[id]/attachments/[fileId]">) {
  try {
    const { wallet } = await requireBankWallet();
    const p = await ctx.params;
    return fileResponse(await readDealFile(wallet, Number(p.id), p.fileId).catch(asHttp));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/deals/[id]/attachments/[fileId]">) {
  try {
    const { user, wallet } = await requireBankWallet();
    const p = await ctx.params;
    await removeDealFile(user.id, wallet, Number(p.id), p.fileId).catch(asHttp);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
