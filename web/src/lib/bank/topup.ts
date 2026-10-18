import "server-only";

import { db } from "../db";
import { LIMITS, kycOf } from "../kyc";
import { transfer } from "./ledger";

/**
 * Card top-ups into the Mock Bank through Stripe Checkout, in TEST MODE only (test card
 * 4242 4242 4242 4242). Without a webhook: when Stripe sends the customer back, the server fetches
 * the Checkout Session from Stripe itself and credits the account only if Stripe says it is paid,
 * for this user, in this currency. The session id is the idempotency key, so a reload or a second
 * confirmation never credits twice. Limits depend on KYC.
 */

export class TopupError extends Error {}

function key(): string {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new TopupError("Card top-up is not configured");
  // Test mode only: this is a demo bank with no real money behind it.
  if (!k.startsWith("sk_test_")) throw new TopupError("Only a Stripe test key may be used");
  return k;
}

export async function stripe<T>(path: string, body?: URLSearchParams, opts: { idempotencyKey?: string; method?: string } = {}): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: opts.method ?? (body ? "POST" : "GET"),
    headers: {
      authorization: `Bearer ${key()}`,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
    },
    body,
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new TopupError(json.error?.message ?? `Stripe error ${res.status}`);
  return json;
}

async function userAccount(userId: string) {
  const customer = await db.bankCustomer.findFirst({ where: { userId }, include: { accounts: { where: { linkedAt: { not: null } } } } });
  if (!customer) throw new TopupError("Sign in through the Mock Bank first");
  const account = customer.accounts.find((a) => a.isDefault) ?? customer.accounts[0];
  if (!account) throw new TopupError("No linked account to top up");
  return { customer, account };
}

export async function topupLimit(userId: string, currency: "THB" | "CNY") {
  return (await kycOf(userId)) ? LIMITS[currency].topupVerified : LIMITS[currency].topupUnverified;
}

/** Creates a Checkout Session for `amount` (major units) and returns Stripe's hosted page URL. */
/** Checks the amount against the minimum and the KYC limit; returns the account and minor units. */
export async function checkTopup(userId: string, amount: number) {
  const { customer, account } = await userAccount(userId);
  const currency = customer.currency;
  const limit = await topupLimit(userId, currency);
  if (!Number.isFinite(amount) || amount < (currency === "THB" ? 20 : 5)) throw new TopupError(`The minimum top-up is ${currency === "THB" ? "20 THB" : "5 CNY"}`);
  if (amount > limit) {
    throw new TopupError(`Top-ups are limited to ${limit.toLocaleString()} ${currency}${limit === LIMITS[currency].topupUnverified ? " until you verify your identity (Profile page)" : ""}`);
  }
  return { customer, account, currency, minor: Math.round(amount * 100) };
}

export type TopupMethod = "card" | "promptpay";

export async function startTopup(userId: string, amount: number, origin: string, method: TopupMethod = "card", back?: { success: string; cancel: string }): Promise<string> {
  const { account, currency, minor } = await checkTopup(userId, amount);
  if (method === "promptpay" && currency !== "THB") throw new TopupError("PromptPay is for baht accounts");
  const session = await stripe<{ url: string }>(
    "checkout/sessions",
    new URLSearchParams({
      mode: "payment",
      "payment_method_types[0]": method,
      client_reference_id: userId,
      "metadata[accountId]": account.id,
      "metadata[app]": "agentic-wallet",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(minor),
      "line_items[0][price_data][product_data][name]": `Mock Bank top-up · account ··${(account.accountNo ?? "").replace(/\D/g, "").slice(-4)}`,
      "line_items[0][price_data][product_data][description]": "Demo money for Agentic Wallet (Stripe test mode)",
      // The desktop app gets the browser back on its own local page (back), the website on /chat.
      success_url: back?.success ?? `${origin}/chat?topup={CHECKOUT_SESSION_ID}`,
      cancel_url: back?.cancel ?? `${origin}/chat?topup=cancelled`,
    }),
  );
  return session.url;
}

/** Credits a paid Checkout Session to the user's account, once. */
export async function confirmTopup(userId: string, sessionId: string) {
  if (!/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) throw new TopupError("Invalid session");
  const s = await stripe<{
    id: string;
    payment_status: string;
    client_reference_id: string | null;
    currency: string;
    amount_total: number;
    metadata: Record<string, string>;
    livemode: boolean;
  }>(`checkout/sessions/${sessionId}`);
  if (s.livemode) throw new TopupError("Live payments are not accepted");
  if (s.client_reference_id !== userId) throw new TopupError("This payment belongs to another user");
  if (s.payment_status !== "paid") return { status: s.payment_status, amount: 0, currency: s.currency.toUpperCase() };
  const { account } = await userAccount(userId);
  if (s.metadata.accountId !== account.id && !(await db.bankAccount.findFirst({ where: { id: s.metadata.accountId, customer: { userId } } }))) {
    throw new TopupError("The account for this payment is no longer linked");
  }
  const target = await db.bankAccount.findUniqueOrThrow({ where: { id: s.metadata.accountId } });
  if (target.currency.toLowerCase() !== s.currency) throw new TopupError("Currency mismatch");
  // Satang / fen: Stripe's minor units are the bank's minor units for THB and CNY.
  await transfer({ key: `stripe:${s.id}`, kind: "TOPUP", fromId: null, toId: target.id, amount: BigInt(s.amount_total) });
  return { status: "paid", amount: s.amount_total / 100, currency: target.currency };
}

/** The user's recent top-ups (any channel), newest first. */
export async function topupHistory(userId: string) {
  const rows = await db.bankTransfer.findMany({
    where: { kind: "TOPUP", to: { customer: { userId } } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { idempotencyKey: true, amount: true, createdAt: true },
  });
  const channel = (k: string) =>
    k.startsWith("stripe-auto:") ? "Linked card (for a deal)" : k.startsWith("stripe-link:") ? "Linked card" : k.startsWith("counter:") ? "Counter service (demo)" : "Card or PromptPay (Stripe)";
  return rows.map((r) => ({ amount: Number(r.amount) / 100, at: r.createdAt, channel: channel(r.idempotencyKey) }));
}
