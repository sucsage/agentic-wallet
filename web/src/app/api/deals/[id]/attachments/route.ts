import { addDealFile, asDealFileHttp, listDealFiles } from "@/lib/deal-files";
import { HttpError, errorResponse, rateLimit, requireBankWallet } from "@/lib/guard";

const asHttp = (e: unknown) => {
  throw asDealFileHttp(e) ? new HttpError(400, (e as Error).message) : e;
};

/** Files attached to the deal by its creator (both parties can read them). */
export async function GET(_req: Request, ctx: RouteContext<"/api/deals/[id]/attachments">) {
  try {
    const { user, wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) throw new HttpError(400, "Invalid deal");
    return Response.json(await listDealFiles(wallet, id, user.id).catch(asHttp));
  } catch (err) {
    return errorResponse(err);
  }
}

/** The deal's creator attaches a file: multipart form with `file` (max 4 MB, 5 per deal). */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/attachments">) {
  try {
    rateLimit(req, "deal-files", 40, 60 * 60 * 1000);
    const { user, wallet } = await requireBankWallet();
    const id = Number((await ctx.params).id);
    const form = await req.formData().catch(() => null);
    const f = form?.get("file");
    if (!Number.isInteger(id) || !(f instanceof File) || f.size === 0) throw new HttpError(400, "Choose a file");
    const out = await addDealFile(user.id, wallet, id, { name: f.name, mime: f.type, bytes: Buffer.from(await f.arrayBuffer()) }).catch(asHttp);
    return Response.json(out, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
