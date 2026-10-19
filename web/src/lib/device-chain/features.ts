import "server-only";

import { randomUUID } from "node:crypto";

import { customerOfUser } from "../bank/customers";
import { issueSlip, paySlip } from "../bank/counter";
import { inviteLinkFor } from "../bank/invites";
import { RelinkError, relinkInvite } from "../bank/relink";
import { linkOf, topupFromLink } from "../bank/stripe-link";
import { TopupError, confirmTopup, startTopup, topupHistory, topupLimit } from "../bank/topup";
import { dealTerms } from "../bank/deals";
import { CompanyError, createGroupWallet, fundCompany } from "../company";
import { db } from "../db";
import { LinkAccessError, issueOtp, resetWithCode } from "../link-access";
import { SocialError, acceptFriend, answerGroupInvite, createGroup, listFriends, listGroups, myGroupInvites, pendingVotes, proposePayout, removeFriend, requestFriend, searchCustomers, setUsername } from "../social";
import { readFileDeals } from "../state";
import { type DeviceRow, DeviceError, deviceWallet } from ".";

/**
 * What used to need the website, for the desktop app: friends, top-ups, the private links of
 * people without an account, and groups. Plain signed requests (the device key); moves that commit
 * money or consent (payees, group votes, deal moves) are signed blocks instead (index.ts).
 */

const social = <T>(p: Promise<T>) =>
  p.catch((e) => {
    throw e instanceof SocialError || e instanceof CompanyError || e instanceof TopupError || e instanceof LinkAccessError || e instanceof RelinkError ? new DeviceError(400, e.message) : e;
  });

async function customer(device: DeviceRow) {
  const c = await customerOfUser(device.userId);
  if (!c) throw new DeviceError(409, "Verify your identity first: it opens your wallet account");
  return c;
}

// ------------------------------------------------------------------------------------------
// Friends
// ------------------------------------------------------------------------------------------

export async function deviceFriends(device: DeviceRow) {
  const friends = await listFriends(device.userId, device.walletAddress ? deviceWallet(device) : undefined);
  return friends.map((f) => ({ friendshipId: f.friendshipId, userId: f.userId, name: f.name, username: f.username, status: f.status, direction: f.direction, hasWallet: Boolean(f.wallet), payee: f.allowlisted }));
}

/** The friends list with the user's own username (how friends find them; w_… until they choose one). */
export async function deviceFriendsView(device: DeviceRow) {
  const [friends, me] = await Promise.all([deviceFriends(device), db.bankCustomer.findUnique({ where: { userId: device.userId }, select: { username: true } })]);
  return { friends, me: me ? { username: me.username, chosen: !me.username.startsWith("w_") } : null };
}

type FriendInput =
  | { op: "request"; username: string }
  | { op: "accept" | "remove"; friendshipId: string }
  | { op: "search"; q: string }
  | { op: "username"; username: string };

export async function friendAction(device: DeviceRow, input: FriendInput) {
  if (input.op === "search") {
    const c = await customer(device);
    return { results: await social(searchCustomers(device.userId, c.currency, input.q)) };
  }
  if (input.op === "request") {
    const c = await customer(device);
    await social(requestFriend(device.userId, c.currency, input.username.trim()));
  } else if (input.op === "username") await social(setUsername(device.userId, input.username));
  else if (input.op === "accept") await social(acceptFriend(device.userId, input.friendshipId));
  else await social(removeFriend(device.userId, input.friendshipId));
  return deviceFriendsView(device);
}

// ------------------------------------------------------------------------------------------
// Top-ups
// ------------------------------------------------------------------------------------------

export async function topupInfo(device: DeviceRow) {
  const c = await customer(device);
  const [limit, link, history] = await Promise.all([topupLimit(device.userId, c.currency), linkOf(device.userId), topupHistory(device.userId)]);
  return { currency: c.currency, limit, enabled: Boolean(process.env.STRIPE_SECRET_KEY), card: link ? { brand: link.brand, last4: link.last4 } : null, counter: Boolean(process.env.MOCK_IDP_SECRET), history };
}

/** The browser comes back to the app's own local page after Stripe Checkout (only a loopback URL is accepted). */
const LOCAL_RETURN = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/topup-done$/;

export async function topupStart(device: DeviceRow, origin: string, input: { amount: number; method: "card" | "promptpay" | "linked" | "counter"; returnTo?: string }) {
  await customer(device);
  if (!(input.amount > 0 && input.amount <= 1_000_000)) throw new DeviceError(400, "Enter an amount");
  if (input.method === "linked") return { linked: await social(topupFromLink(device.userId, input.amount, randomUUID())) };
  if (input.method === "counter") return { slip: await social(issueSlip(device.userId, input.amount)) };
  if (!input.returnTo || !LOCAL_RETURN.test(input.returnTo)) throw new DeviceError(400, "Bad return address");
  const url = await social(startTopup(device.userId, input.amount, origin, input.method, { success: `${input.returnTo}?session={CHECKOUT_SESSION_ID}`, cancel: `${input.returnTo}?cancelled=1` }));
  return { url };
}

export const topupConfirm = (device: DeviceRow, sessionId: string) => social(confirmTopup(device.userId, sessionId));
/** Demo: the simulated cashier takes the cash for a counter-service slip. */
export const counterPay = (device: DeviceRow, slip: string) => social(paySlip(device.userId, slip));

// ------------------------------------------------------------------------------------------
// Private links of people without an account
// ------------------------------------------------------------------------------------------

export async function deviceLinks(device: DeviceRow, origin: string) {
  const wallet = deviceWallet(device);
  const deals = await readFileDeals(wallet);
  const out = [];
  const seen = new Set<string>();
  for (const d of deals) {
    if (seen.has(d.counterparty)) continue;
    const link = await inviteLinkFor(device.userId, d.counterparty, origin);
    if (!link) continue;
    seen.add(d.counterparty);
    const terms = await dealTerms(d.id, d.role === "buyer" ? wallet : d.counterparty, d.role === "seller" ? wallet : d.counterparty);
    out.push({ dealId: d.id, counterparty: d.counterparty.toLowerCase(), title: terms?.title ?? `Deal D-${d.id}`, status: d.status, kind: link.kind, name: link.name, link: link.link, linked: link.linked, expiresAt: link.expiresAt, access: link.access });
  }
  return out;
}

export async function linkAction(device: DeviceRow, origin: string, input: { dealId: number; action: "otp" | "reset" | "rotate"; code?: string }) {
  const wallet = deviceWallet(device);
  const deal = (await readFileDeals(wallet)).find((d) => d.id === input.dealId);
  if (!deal) throw new DeviceError(404, "Deal not found");
  const link = await inviteLinkFor(device.userId, deal.counterparty, origin);
  if (!link) throw new DeviceError(404, "You did not invite the other side of this deal");
  if (input.action === "rotate") return social(relinkInvite(device.userId, link, input.code, origin));
  const invite = link.kind === "seller" ? await db.sellerInvite.findUniqueOrThrow({ where: { id: link.id } }) : await db.buyerInvite.findUniqueOrThrow({ where: { id: link.id } });
  if (input.action === "otp") {
    if (invite.accessPassword) throw new DeviceError(409, "They already set a password. If they lost it, they press “Forgot password” on their link and send you the reset code.");
    return social(issueOtp(link.kind, invite));
  }
  return social(resetWithCode(link.kind, invite, String(input.code ?? "")));
}

// ------------------------------------------------------------------------------------------
// Groups
// ------------------------------------------------------------------------------------------

export async function deviceGroups(device: DeviceRow) {
  const [groups, invites, votes] = await Promise.all([listGroups(device.userId), myGroupInvites(device.userId), pendingVotes(device.userId)]);
  // Each group's shared wallet (if opened): its account number and balance.
  const accounts = await db.bankAccount.findMany({
    where: { ownerAddress: { in: groups.flatMap((g) => (g.company ? [g.company.walletAddress.toLowerCase()] : [])) } },
    select: { ownerAddress: true, accountNo: true, balance: true },
  });
  return {
    groups: groups.map((g) => {
      const me = g.members.find((m) => m.userId === device.userId);
      const acct = g.company ? accounts.find((a) => a.ownerAddress === g.company!.walletAddress.toLowerCase()) : undefined;
      return {
        id: g.id,
        name: g.name,
        currency: g.currency,
        threshold: g.threshold,
        myRole: me?.role ?? "MEMBER",
        iSign: me?.canSign ?? false,
        members: g.members.map((m) => ({ userId: m.user.id, name: m.user.name, role: m.role, canSign: m.canSign })),
        openProposals: g.proposals.length,
        invited: g.invites.length,
        wallet: g.company
          ? { companyId: g.company.id, kind: g.company.kind, name: g.company.name, accountNo: acct?.accountNo ?? null, balance: acct ? Number(acct.balance) / 100 : 0 }
          : null,
      };
    }),
    invites: JSON.parse(JSON.stringify(invites, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
    votes,
  };
}

export async function groupAction(
  device: DeviceRow,
  input:
    | { op: "create"; name: string; members: { userId: string; canSign: boolean }[]; threshold: number }
    | { op: "invite"; inviteId: string; accept: boolean }
    | { op: "wallet"; groupId: string }
    | { op: "fund"; companyId: string; amount: number; requestId: string }
    | { op: "payout"; groupId: string; recipients: { userId: string; amount: number }[] },
) {
  // The owner opens the group's shared wallet (it hires and sells in the group's name; money moves by the signers' vote).
  if (input.op === "wallet") {
    await social(createGroupWallet(device.userId, input.groupId));
    return deviceGroups(device);
  }
  // A member moves money from their own wallet into the group's account.
  if (input.op === "fund") {
    await social(fundCompany(device.userId, input.companyId, input.amount, input.requestId));
    return deviceGroups(device);
  }
  // A signer proposes paying members from the group's account: it happens after the vote (votes are signed blocks).
  if (input.op === "payout") {
    const r = await social(proposePayout(device.userId, input.groupId, input.recipients));
    return { payout: JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v))), ...(await deviceGroups(device)) };
  }
  if (input.op === "create") {
    const c = await customer(device);
    const g = await social(createGroup(device.userId, c.currency, { name: input.name, members: input.members.slice(0, 20), threshold: input.threshold }));
    return { id: g.id, ...(await deviceGroups(device)) };
  }
  await social(answerGroupInvite(device.userId, input.inviteId, input.accept));
  return deviceGroups(device);
}

