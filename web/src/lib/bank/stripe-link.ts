import "server-only";

import { db } from "../db";
import { accountOf, transfer } from "./ledger";
import { TopupError, checkTopup, stripe, topupLimit } from "./topup";

/**
 * A card linked through Stripe (test mode) as a funding source, the way a bank account is linked:
 * the customer saves it once on Stripe's page (Checkout in setup mode), and from then on, when the
 * Mock Bank balance is short at "Approve & lock", the shortfall is charged to it off-session and
 * credited to the account (TOPUP), then the deal is funded as usual.
 *
 * Stripe in Thailand cannot link a bank account for direct debit, and PromptPay cannot be charged
 * again without the customer, so a card is the reusable source. Every charge carries an
 * idempotency key derived from the deal, so a retry never charges twice.
 */

type Session = { id: string; status: string; customer: string | null; metadata: Record<string, string>; setup_intent: { payment_method: string } | string | null };
type Card = { id: string; customer: string | null; card: { brand: string; last4: string; exp_month: number; exp_year: number } };

export function linkOf(userId: string) {
  return db.stripeLink.findUnique({ where: { userId } });
}

/** Opens Stripe's page to save a card for this user. */
export async function startLink(userId: string, origin: string): Promise<string> {
  const customer = await db.bankCustomer.findFirst({ where: { userId }, select: { displayName: true, currency: true } });
  if (!customer) throw new TopupError("Sign in through the Mock Bank first");
  const prior = await linkOf(userId);
  const cus =
    prior?.customerId ??
    (await stripe<{ id: string }>("customers", new URLSearchParams({ name: customer.displayName, "metadata[userId]": userId }))).id;
  const session = await stripe<{ url: string }>(
    "checkout/sessions",
    new URLSearchParams({
      mode: "setup",
      customer: cus,
      currency: customer.currency.toLowerCase(),
      "payment_method_types[0]": "card",
      "metadata[userId]": userId,
      success_url: `${origin}/profile?stripe_link={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/profile?stripe_link=cancelled`,
    }),
  );
  return session.url;
}

/** Records the card saved on Stripe's page, after checking the session with Stripe. */
export async function confirmLink(userId: string, sessionId: string) {
  if (!/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) throw new TopupError("Invalid session");
  const s = await stripe<Session>(`checkout/sessions/${sessionId}?expand[]=setup_intent`);
  if (s.metadata.userId !== userId || !s.customer) throw new TopupError("This link belongs to another user");
  if (s.status !== "complete" || !s.setup_intent || typeof s.setup_intent === "string") throw new TopupError("The card was not saved");
  const pm = await stripe<Card>(`payment_methods/${s.setup_intent.payment_method}`);
  if (pm.customer !== s.customer) throw new TopupError("The card is not attached to this customer");
  const data = { customerId: s.customer, paymentMethodId: pm.id, brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
  const prior = await linkOf(userId);
  await db.stripeLink.upsert({ where: { userId }, update: data, create: { userId, ...data } });
  // Replacing a card: the old one is detached so it can no longer be charged.
  if (prior && prior.paymentMethodId !== pm.id) await stripe(`payment_methods/${prior.paymentMethodId}/detach`, new URLSearchParams()).catch(() => {});
  return data;
}

export async function unlink(userId: string) {
  const link = await linkOf(userId);
  if (!link) return false;
  await stripe(`payment_methods/${link.paymentMethodId}/detach`, new URLSearchParams()).catch(() => {});
  await db.stripeLink.delete({ where: { userId } });
  return true;
}

/** Stripe's minimum charge, in minor units. */
const MIN_CHARGE = { THB: 1_000n, CNY: 400n } as const;

/**
 * Before a debit of `amount` (minor units) from the wallet's bank account: if the balance is
 * short and the owner linked a card, charge the shortfall to it (off-session) and credit it.
 * `key` names the debit, so the same deal is never charged twice. Returns what was charged.
 */
export async function coverShortfall(wallet: string, amount: bigint, key: string): Promise<{ charged: bigint; card: string } | null> {
  const account = await accountOf(wallet);
  if (!account || account.balance >= amount || !account.customerId) return null;
  const customer = await db.bankCustomer.findUnique({ where: { id: account.customerId }, select: { userId: true } });
  const link = customer?.userId ? await linkOf(customer.userId) : null;
  if (!link || !customer?.userId) return null;
  const short = amount - account.balance;
  const charge = short < MIN_CHARGE[account.currency] ? MIN_CHARGE[account.currency] : short;
  const limit = BigInt(await topupLimit(customer.userId, account.currency)) * 100n;
  if (charge > limit) {
    throw new TopupError(`The card can cover up to ${limit / 100n} ${account.currency} at a time${limit <= 100_000n ? " until you verify your identity" : ""}`);
  }
  const pi = await stripe<{ id: string; status: string; amount_received: number; currency: string }>(
    "payment_intents",
    new URLSearchParams({
      amount: String(charge),
      currency: account.currency.toLowerCase(),
      customer: link.customerId,
      payment_method: link.paymentMethodId,
      off_session: "true",
      confirm: "true",
      description: "Agentic Wallet: bank shortfall for a deal (test mode)",
      "metadata[accountId]": account.id,
      "metadata[key]": key,
    }),
    { idempotencyKey: `autofund:${key}` },
  ).catch((e) => {
    throw new TopupError(`Your linked card was declined: ${(e as Error).message}`);
  });
  if (pi.status !== "succeeded") throw new TopupError(`Your linked card needs your confirmation (${pi.status}); top up instead`);
  await transfer({ key: `stripe-auto:${key}`, kind: "TOPUP", fromId: null, toId: account.id, amount: BigInt(pi.amount_received) });
  return { charged: BigInt(pi.amount_received), card: `${link.brand} ••${link.last4}` };
}

/**
 * One-tap top-up from the linked card, no redirect (like a wallet's saved card). `requestId` comes
 * from the client per tap, so a double tap or a retry charges once.
 */
export async function topupFromLink(userId: string, amount: number, requestId: string) {
  const link = await linkOf(userId);
  if (!link) throw new TopupError("Link a card first (Profile page)");
  const { account, currency, minor } = await checkTopup(userId, amount);
  const pi = await stripe<{ id: string; status: string; amount_received: number }>(
    "payment_intents",
    new URLSearchParams({
      amount: String(minor),
      currency: currency.toLowerCase(),
      customer: link.customerId,
      payment_method: link.paymentMethodId,
      off_session: "true",
      confirm: "true",
      description: "Agentic Wallet: top-up from the linked card (test mode)",
      "metadata[accountId]": account.id,
    }),
    { idempotencyKey: `link-topup:${userId}:${requestId}` },
  ).catch((e) => {
    throw new TopupError(`Your linked card was declined: ${(e as Error).message}`);
  });
  if (pi.status !== "succeeded") throw new TopupError(`The card needs your confirmation (${pi.status}); use card top-up instead`);
  await transfer({ key: `stripe-link:${pi.id}`, kind: "TOPUP", fromId: null, toId: account.id, amount: BigInt(pi.amount_received) });
  return { amount: pi.amount_received / 100, currency, card: `${link.brand} ••${link.last4}` };
}
