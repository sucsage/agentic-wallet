import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { type Address, getAddress } from "viem";

import type { BuyerInvite } from "@/generated/prisma/client";

import { createWorkspace } from "../actions";
import { agentWalletAbi } from "../abis";
import { type TxOutcome, send } from "../chain";
import { db } from "../db";
import { readFileDeals } from "../state";
import { accountOf, openAccount, transfer } from "./ledger";
import { acceptAndPay, buyerAction, dealTerms, deliveryInfo, syncDeal } from "./deals";
import { stripe } from "./topup";

/**
 * Buyers without an account. A seller invites someone by name and gets a link; the server runs an
 * agent wallet for that buyer (allowing the seller as its payee), so the contracts see an ordinary
 * buyer. On the link's page the buyer sees the seller's offer, pays its total by card (Stripe test
 * mode, credited to the wallet's demo bank account, then locked in escrow exactly like any accepted
 * offer), and approves each delivery, which pays the seller and unlocks the file.
 */

export class BuyerInviteError extends Error {}

const LINK_DAYS = 30;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Invited buyers' wallets, labelled for the seller: "<name> (invited buyer)". */
export async function buyerInviteLabels(userId: string): Promise<[string, string][]> {
  const rows = await db.buyerInvite.findMany({ where: { userId }, select: { buyerWallet: true, name: true } });
  return rows.map((r) => [r.buyerWallet.toLowerCase(), `${r.name} (invited buyer)`]);
}

export async function createBuyerInvite(userId: string, sellerWallet: Address, name: string): Promise<{ invite: BuyerInvite; token: string; payee: TxOutcome }> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (clean.length < 2) throw new BuyerInviteError("Enter the buyer's name");
  const sellerAccount = await accountOf(sellerWallet);
  if (!sellerAccount) throw new BuyerInviteError("Your wallet has no account yet");
  const currency = sellerAccount.currency;
  const { address: buyerWallet } = await createWorkspace({ currency });
  await openAccount(buyerWallet, `Invited buyer · ${clean}`, currency);
  // The buyer's wallet may pay this seller (accepting the offer locks money for them).
  const payee = await send("owner", { address: buyerWallet, abi: agentWalletAbi, functionName: "setRecipient", args: [sellerWallet, true] });
  const token = randomBytes(24).toString("base64url");
  const invite = await db.buyerInvite.create({
    data: { tokenHash: hashToken(token), userId, sellerWallet, buyerWallet, name: clean, currency, expiresAt: new Date(Date.now() + LINK_DAYS * 86_400_000) },
  });
  return { invite, token, payee };
}

export async function buyerInviteByToken(token: string): Promise<BuyerInvite> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new BuyerInviteError("This link is not valid");
  const invite = await db.buyerInvite.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite) throw new BuyerInviteError("This link is not valid");
  if (invite.expiresAt < new Date()) throw new BuyerInviteError("This link has expired; ask the seller for a new one");
  return invite;
}

/** The buyer's page: the seller's offers and deals with this buyer, milestone by milestone. */
export async function buyerInviteView(invite: BuyerInvite) {
  const buyerWallet = getAddress(invite.buyerWallet);
  const seller = getAddress(invite.sellerWallet);
  const [sellerUser, deals, account] = await Promise.all([
    db.user.findUnique({ where: { id: invite.userId }, select: { name: true } }),
    readFileDeals(buyerWallet),
    accountOf(buyerWallet),
  ]);
  const mine = deals.filter((d) => d.role === "buyer" && getAddress(d.counterparty) === seller);
  return {
    name: invite.name,
    sellerName: sellerUser?.name ?? "The seller",
    currency: invite.currency,
    expiresAt: invite.expiresAt,
    balance: (account?.balance ?? 0n).toString(),
    deals: await Promise.all(
      mine.map(async (d) => {
        const terms = await dealTerms(d.id, buyerWallet, seller);
        const ms = (terms?.milestones ?? []) as { name: string; acceptance: string }[];
        return {
          id: d.id,
          status: d.status,
          total: d.total,
          title: terms?.title ?? `Deal #${d.id}`,
          summary: terms?.summary ?? null,
          shipTo: terms?.shipTo ?? null,
          canPay: d.status === "Proposed" && d.offeredBy === "them",
          milestones: await Promise.all(
            d.milestones.map(async (m, i) => ({
              index: m.index,
              amount: m.amount,
              status: m.status,
              hasFile: m.hasFile,
              name: ms[i]?.name ?? `Milestone ${i + 1}`,
              acceptance: ms[i]?.acceptance ?? null,
              canApprove: d.status === "Active" && m.status === "Delivered",
              delivery: await deliveryInfo(d.id, m.index),
            })),
          ),
        };
      }),
    ),
  };
}

const ownDeal = async (invite: BuyerInvite, dealId: number) => {
  const d = (await readFileDeals(getAddress(invite.buyerWallet))).find((x) => x.id === dealId && x.role === "buyer");
  if (!d || getAddress(d.counterparty) !== getAddress(invite.sellerWallet)) throw new BuyerInviteError("Deal not found");
  return d;
};

/** A Stripe Checkout (test mode) for what the offer needs beyond the wallet's balance. */
export async function startBuyerPayment(invite: BuyerInvite, token: string, dealId: number, origin: string): Promise<{ url: string | null; covered: boolean }> {
  const d = await ownDeal(invite, dealId);
  if (d.status !== "Proposed" || d.offeredBy !== "them") throw new BuyerInviteError("This offer is not open for payment");
  const account = await accountOf(getAddress(invite.buyerWallet));
  if (!account) throw new BuyerInviteError("This link has no account");
  const need = BigInt(Math.round(Number(d.total) * 100)) - account.balance;
  if (need <= 0n) return { url: null, covered: true };
  const session = await stripe<{ url: string }>(
    "checkout/sessions",
    new URLSearchParams({
      mode: "payment",
      "payment_method_types[0]": "card",
      client_reference_id: `buyer-invite:${invite.id}`,
      "metadata[buyerInviteId]": invite.id,
      "metadata[dealId]": String(dealId),
      "metadata[accountId]": account.id,
      "metadata[app]": "agentic-wallet",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": invite.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(need),
      "line_items[0][price_data][product_data][name]": `Deal D-${dealId} · held in escrow until you approve`,
      "line_items[0][price_data][product_data][description]": "Demo payment for Agentic Wallet (Stripe test mode)",
      success_url: `${origin}/pay/${token}?paid={CHECKOUT_SESSION_ID}&deal=${dealId}`,
      cancel_url: `${origin}/pay/${token}`,
    }),
    { idempotencyKey: `buyer-invite:${invite.id}:${dealId}:${need}` },
  );
  return { url: session.url, covered: false };
}

/** After Checkout: credit the card payment once, then accept the offer (locks it in escrow). */
export async function confirmBuyerPayment(invite: BuyerInvite, sessionId: string, dealId: number) {
  if (!/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) throw new BuyerInviteError("Invalid payment");
  const s = await stripe<{ id: string; payment_status: string; amount_total: number; currency: string; metadata: Record<string, string>; livemode: boolean }>(`checkout/sessions/${sessionId}`);
  if (s.livemode) throw new BuyerInviteError("Live payments are not accepted");
  if (s.metadata.buyerInviteId !== invite.id || Number(s.metadata.dealId) !== dealId) throw new BuyerInviteError("This payment is for another link or deal");
  if (s.payment_status !== "paid") throw new BuyerInviteError(`The card payment is ${s.payment_status}`);
  const account = await accountOf(getAddress(invite.buyerWallet));
  if (!account || account.id !== s.metadata.accountId || account.currency.toLowerCase() !== s.currency) throw new BuyerInviteError("Account mismatch");
  await transfer({ key: `stripe:${s.id}`, kind: "TOPUP", fromId: null, toId: account.id, amount: BigInt(s.amount_total) });
  return payOffer(invite, dealId);
}

/** Accepts the seller's offer from the buyer's wallet (its balance must cover the total). */
export async function payOffer(invite: BuyerInvite, dealId: number) {
  await ownDeal(invite, dealId);
  const wallet = getAddress(invite.buyerWallet);
  const r = await acceptAndPay(wallet, dealId);
  void syncDeal(wallet, dealId).catch(() => null);
  return r;
}

/** The buyer approves a delivery: the seller is paid and the file's key is released. */
export async function approveAsInvitedBuyer(invite: BuyerInvite, dealId: number, index: number) {
  await ownDeal(invite, dealId);
  const wallet = getAddress(invite.buyerWallet);
  const r = await buyerAction(wallet, dealId, "approve", index);
  void syncDeal(wallet, dealId).catch(() => null);
  return r;
}
