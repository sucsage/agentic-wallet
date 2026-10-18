import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { after } from "next/server";

import { type Address, type Hex, getAddress, isAddress, isHex, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { Prisma } from "@/generated/prisma/client";

import { chainAnchorAbi } from "../abis";
import { config } from "../config";
import { accountOf } from "../bank/ledger";
import { customerOfUser } from "../bank/customers";
import { type DealMove, DEAL_MOVES, runDealMove } from "../bank/deal-actions";
import { appOrigin, confirmDraft } from "../bank/confirm-draft";
import { dueDates } from "../bank/milestone-due";
import { DealError, dealTerms, deliver, syncDeal } from "../bank/deals";
import { type DraftMilestone, deliveryOf, draftView, listDrafts } from "../bank/drafts";
import { CARRIERS, type Carrier } from "../post";
import { send } from "../chain";
import { actingCompany } from "../company";
import { db } from "../db";
import { HttpError } from "../guard";
import { hmac } from "../kyc";
import { SocialError, listFriends, setFriendPayee, vote } from "../social";
import { readFileDeals } from "../state";
import { primaryWalletAddress } from "../user-wallets";
import {
  type Block,
  type DealEventBody,
  FORMAT_VERSION,
  type IntentBody,
  type SignedBlock,
  ZERO_HASH,
  eventId,
  eventMessage,
  headLeaf,
  headMessage,
  linkMessage,
  merkleProof,
  merkleRoot,
  requestMessage,
  signerOf,
  verifyBlocks,
} from "./format";

/**
 * Device chains: the desktop app (desktop/) is the main way to hold deals. Each linked device makes
 * its own key on the user's computer and keeps its own hash-linked chain of deal blocks there; the
 * server keeps only each device's head (latest block, signed by the device, countersigned here), an
 * encrypted backup it cannot read, and which device recorded which deal event. Two parties' chains
 * link through the same server-signed deal event. Deal moves the user makes in the app are intent
 * blocks signed by the device key, and the server runs them like the website's buttons. Now and
 * then one Merkle root of all heads goes on-chain (ChainAnchor) as a public timestamp.
 */

export class DeviceError extends HttpError {}

const LINK_CODE_MINUTES = 10;
const MAX_SKEW_MS = 5 * 60 * 1000;
const MAX_BLOCKS_PER_SUBMIT = 200;
const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
const REQUEST_DAYS = 7;

/** The server's countersigning key: CHAIN_SIGNER_KEY, else derived from the app secret (stable per deployment). */
function serverAccount() {
  const env = process.env.CHAIN_SIGNER_KEY?.trim();
  const key = (env ? (env.startsWith("0x") ? env : `0x${env}`) : `0x${hmac("device-chain-signer", "v1")}`) as Hex;
  return privateKeyToAccount(key);
}
export const serverSigner = (): Address => serverAccount().address;
const serverSign = (message: string) => serverAccount().signMessage({ message });

// ------------------------------------------------------------------------------------------
// Linking
// ------------------------------------------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const normCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** A one-time code (10 minutes) the signed-in user types into the desktop app to link it. */
export async function createLinkCode(userId: string) {
  const bytes = randomBytes(8);
  const raw = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  const expiresAt = new Date(Date.now() + LINK_CODE_MINUTES * 60_000);
  await db.deviceLinkCode.create({ data: { codeHash: hmac("device-link", normCode(code)), userId, expiresAt } });
  return { code, expiresAt };
}

/** The app proves it holds the device key (signature over the code and its address) and is linked. */
export async function linkDevice(input: { code: string; address: string; name: string; os: string; sig: string }) {
  if (!isAddress(input.address) || !isHex(input.sig)) throw new DeviceError(400, "Invalid device");
  const address = getAddress(input.address);
  const code = normCode(input.code);
  if ((await signerOf(linkMessage(code, address), input.sig as Hex).catch(() => null)) !== address) throw new DeviceError(400, "The device signature does not match");
  const codeHash = hmac("device-link", code);
  // Used once, atomically: a second link with the same code finds nothing to claim.
  const claimed = await db.deviceLinkCode.updateMany({ where: { codeHash, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (!claimed.count) throw new DeviceError(400, "This code is wrong, used or expired: make a new one on the website (Profile → Desktop app)");
  const { userId } = await db.deviceLinkCode.findUniqueOrThrow({ where: { codeHash } });
  const wallet = await primaryWalletAddress(userId);
  if (!wallet) throw new DeviceError(409, "Create your agent wallet on the website first");
  if (await db.device.findUnique({ where: { address } })) throw new DeviceError(409, "This device key is already linked");
  await db.device.create({
    data: { address, userId, walletAddress: wallet, name: input.name.trim().slice(0, 60) || "My computer", os: input.os.trim().slice(0, 30) || "unknown" },
  });
  const user = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  return { device: address, wallet, server: serverSigner(), user: user?.name ?? "" };
}

export async function myDevices(userId: string) {
  const rows = await db.device.findMany({ where: { userId }, orderBy: { linkedAt: "desc" } });
  return rows.map((d) => ({
    address: d.address,
    name: d.name,
    os: d.os,
    linkedAt: d.linkedAt,
    revokedAt: d.revokedAt,
    lastSeenAt: d.lastSeenAt,
    height: d.headHeight,
    head: d.headHash,
  }));
}

export async function revokeDevice(userId: string, address: string) {
  const r = await db.device.updateMany({ where: { userId, address: getAddress(address), revokedAt: null }, data: { revokedAt: new Date() } });
  if (!r.count) throw new DeviceError(404, "Device not found");
}

// ------------------------------------------------------------------------------------------
// Signed requests
// ------------------------------------------------------------------------------------------

/**
 * Every app request carries the device address, a millisecond time and the device's signature over
 * the method, path, time and body. The time must be within 5 minutes, and the same signed request is
 * refused a second time (its signature is remembered for that window), so a copied request cannot be replayed.
 */
export async function authDevice(req: Request, body: string | Uint8Array) {
  const address = req.headers.get("x-aw-device") ?? "";
  const time = Number(req.headers.get("x-aw-time"));
  const sig = req.headers.get("x-aw-sig") ?? "";
  if (!isAddress(address) || !Number.isFinite(time) || !isHex(sig)) throw new DeviceError(401, "Unsigned request");
  if (Math.abs(Date.now() - time) > MAX_SKEW_MS) throw new DeviceError(401, "Your computer's clock is off by more than 5 minutes");
  const device = getAddress(address);
  // The query is signed too (e.g. ?as=<group>); requests without one sign the path alone, as before.
  const u = new URL(req.url);
  const path = u.pathname + u.search;
  if ((await signerOf(requestMessage(req.method, path, time, body), sig as Hex).catch(() => null)) !== device) throw new DeviceError(401, "Bad device signature");
  const row = await db.device.findUnique({ where: { address: device } });
  if (!row || row.revokedAt) throw new DeviceError(401, "This device is not linked (or was removed on the website)");
  try {
    await db.deviceRequestSeen.create({ data: { sigHash: keccak256(sig as Hex) } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DeviceError(401, "Replayed request");
    throw e;
  }
  if (Math.random() < 0.05) await db.deviceRequestSeen.deleteMany({ where: { at: { lt: new Date(Date.now() - 2 * MAX_SKEW_MS) } } });
  await db.device.update({ where: { address: device }, data: { lastSeenAt: new Date() } });
  return row;
}

export type DeviceRow = Awaited<ReturnType<typeof authDevice>>;

/** The device's wallet; an account made in the app has none until its identity check and wallet are done. */
/**
 * Acting for a group or company (the desktop app's "Act as"): the same device, with the shared
 * wallet in place of the user's own for this one request or move. Only a member gets it; what the
 * shared wallet pays still waits for its signers' vote (runDealMove, confirmDraft).
 */
export async function actingDevice<T extends { userId: string; walletAddress: string }>(device: T, companyId: string | null | undefined): Promise<T> {
  if (!companyId) return device;
  if (companyId.length > 40) throw new DeviceError(400, "Unknown group");
  const company = await actingCompany(device.userId, companyId);
  if (!company) throw new DeviceError(404, "You are not in that group (or it has no wallet)");
  return { ...device, walletAddress: company.walletAddress };
}

export function deviceWallet(device: { walletAddress: string }): Address {
  if (!device.walletAddress) throw new DeviceError(409, "Finish setting up your account first (identity check, then the wallet)");
  return getAddress(device.walletAddress);
}

// ------------------------------------------------------------------------------------------
// Deal events
// ------------------------------------------------------------------------------------------

/** Records what the escrow shows now for the wallet's deals as events (each status once). */
export async function refreshEvents(wallet: Address) {
  const deals = await readFileDeals(wallet);
  const rows: { id: string; dealId: number; type: string; index: number | null; data: Prisma.InputJsonValue; parties: string[]; serverSig: string }[] = [];
  for (const d of deals) {
    const buyer = d.role === "buyer" ? wallet : d.counterparty;
    const seller = d.role === "seller" ? wallet : d.counterparty;
    const parties = [buyer.toLowerCase(), seller.toLowerCase()].sort();
    const facts: Omit<DealEventBody, "id">[] = [
      { dealId: d.id, type: "deal", index: null, status: d.status, data: { total: d.total, milestones: d.milestones.length, reviewHours: d.reviewHours, buyer: buyer.toLowerCase(), seller: seller.toLowerCase() }, parties },
      ...d.milestones.map((m) => ({
        dealId: d.id,
        type: "milestone" as const,
        index: m.index,
        status: m.status,
        data: { amount: m.amount, ...(m.split ? { toSeller: m.split.toSeller, toBuyer: m.split.toBuyer } : {}) },
        parties,
      })),
    ];
    for (const f of facts) {
      const id = eventId(f);
      rows.push({ id, dealId: f.dealId, type: f.type, index: f.index, data: { status: f.status, ...f.data }, parties, serverSig: await serverSign(eventMessage(id)) });
    }
  }
  if (rows.length) await db.dealEvent.createMany({ data: rows, skipDuplicates: true });
}

function eventBody(e: { id: string; dealId: number; type: string; index: number | null; data: Prisma.JsonValue; parties: string[] }): DealEventBody {
  const { status, ...data } = e.data as Record<string, string | number | boolean | null>;
  return { id: e.id as Hex, dealId: e.dealId, type: e.type as "deal" | "milestone", index: e.index, status: String(status), data, parties: e.parties };
}

/** Deal events this device has not recorded yet, oldest first, and website moves waiting for its signature. */
export async function pendingFor(device: DeviceRow) {
  if (device.walletAddress) await refreshEvents(deviceWallet(device)).catch((e) => console.error("refreshEvents", e));
  const events = await db.dealEvent.findMany({
    where: { parties: { has: device.walletAddress.toLowerCase() }, acks: { none: { deviceAddress: device.address } } },
    orderBy: [{ createdAt: "asc" }, { dealId: "asc" }, { index: "asc" }],
    take: MAX_BLOCKS_PER_SUBMIT,
  });
  const requests = await db.deviceRequest.findMany({ where: { userId: device.userId, status: "PENDING" }, orderBy: { createdAt: "asc" } });
  const live = requests.filter((r) => r.createdAt.getTime() > Date.now() - REQUEST_DAYS * 86_400_000);
  if (live.length < requests.length) await db.deviceRequest.updateMany({ where: { id: { in: requests.filter((r) => !live.includes(r)).map((r) => r.id) } }, data: { status: "EXPIRED", doneAt: new Date() } });
  return {
    head: headOf(device),
    server: serverSigner(),
    events: events.map((e) => ({ event: eventBody(e), serverSig: e.serverSig as Hex })),
    requests: live.map((r) => ({ id: r.id, dealId: r.dealId, action: r.action, index: r.index, reason: r.reason, createdAt: r.createdAt })),
  };
}

const headOf = (d: { headHeight: number | null; headHash: string | null; headServerSig: string | null; headBlock: Prisma.JsonValue }) =>
  d.headHeight === null ? null : { height: d.headHeight, hash: d.headHash as Hex, serverSig: d.headServerSig as Hex, block: d.headBlock as unknown as SignedBlock };

// ------------------------------------------------------------------------------------------
// Blocks
// ------------------------------------------------------------------------------------------

const Moves = new Set<string>([...DEAL_MOVES, "reject", "deliver", "confirm_draft", "payee", "vote"]);

export type Upload = { name: string; mime: string; bytes: Buffer };

/**
 * The device sends the blocks it appended since its last head. Checked: every hash and device
 * signature, that they continue from the head kept here, that event blocks carry this server's
 * signed events for the device's wallet, and that intents are well-formed. The new head is stored
 * (countersigned) before any intent runs, so a move can never happen without being on the chain.
 */
export async function submitBlocks(device: DeviceRow, blocks: SignedBlock[], upload: Upload | null = null) {
  if (!Array.isArray(blocks) || !blocks.length) throw new DeviceError(400, "No blocks");
  if (blocks.length > MAX_BLOCKS_PER_SUBMIT) throw new DeviceError(400, `Up to ${MAX_BLOCKS_PER_SUBMIT} blocks at a time`);
  const owner = getAddress(device.address);
  const from = device.headHeight === null ? null : { height: device.headHeight, hash: device.headHash as Hex };
  const check = await verifyBlocks(blocks, { owner, from, server: serverSigner() });
  if (!check.ok) throw new DeviceError(409, `${check.error}. Sync again (the app rebuilds from the server's head)`);
  const wallet = device.walletAddress.toLowerCase();
  const eventIds: string[] = [];
  const intents: (Block & { kind: "intent"; hash: Hex })[] = [];
  for (const b of blocks) {
    if (b.kind === "genesis") {
      if (getAddress(b.body.wallet) !== deviceWallet(device) || getAddress(b.body.server) !== serverSigner()) throw new DeviceError(409, "The genesis block names another wallet or server");
    } else if (b.kind === "event") {
      if (!b.body.event.parties.includes(wallet)) throw new DeviceError(409, `Block ${b.height}: that deal is not yours`);
      eventIds.push(b.body.event.id);
    } else {
      const i = b.body as IntentBody;
      if (!Moves.has(i.action) || !Number.isInteger(i.dealId) || !Number.isInteger(i.index) || i.index < 0 || i.index > 20) throw new DeviceError(400, `Block ${b.height}: not a deal move`);
      if (i.reason !== undefined && (typeof i.reason !== "string" || i.reason.length > 2000)) throw new DeviceError(400, `Block ${b.height}: reason too long`);
      if (i.action === "deliver") {
        if (i.note !== undefined && (typeof i.note !== "string" || i.note.length > 4000)) throw new DeviceError(400, `Block ${b.height}: note too long`);
        if (i.fileSha256 !== undefined && !/^[0-9a-f]{64}$/.test(String(i.fileSha256))) throw new DeviceError(400, `Block ${b.height}: bad file hash`);
        if (i.carrier !== undefined && !(CARRIERS as readonly string[]).includes(String(i.carrier))) throw new DeviceError(400, `Block ${b.height}: unknown carrier`);
        if ((i.fileName?.length ?? 0) > 200 || (i.tracking?.length ?? 0) > 40) throw new DeviceError(400, `Block ${b.height}: too long`);
      }
      if (i.action === "confirm_draft" && (typeof i.draftId !== "string" || i.draftId.length > 40)) throw new DeviceError(400, `Block ${b.height}: which preview?`);
      if (i.as !== undefined && (typeof i.as !== "string" || i.as.length > 40 || i.action === "payee" || i.action === "vote")) throw new DeviceError(400, `Block ${b.height}: acting for a group is for deal moves and previews only`);
      if (i.action === "vote" && (typeof i.proposalId !== "string" || i.proposalId.length > 40 || typeof i.approve !== "boolean")) throw new DeviceError(400, `Block ${b.height}: which proposal?`);
      if (i.action === "payee" && (typeof i.friendshipId !== "string" || i.friendshipId.length > 40 || typeof i.allowed !== "boolean")) throw new DeviceError(400, `Block ${b.height}: which contact?`);
      if (Math.abs(Date.now() - b.time) > MAX_SKEW_MS) throw new DeviceError(400, `Block ${b.height}: a deal move must be sent when it is signed`);
      intents.push(b as Block & { kind: "intent"; hash: Hex });
    }
  }
  const delivers = intents.filter((b) => b.body.action === "deliver");
  if (delivers.length > 1) throw new DeviceError(400, "One delivery at a time");
  if (upload && !delivers.some((b) => b.body.fileSha256)) throw new DeviceError(400, "A file needs a signed delivery that names its hash");
  if (upload && createHash("sha256").update(upload.bytes).digest("hex") !== delivers[0].body.fileSha256) throw new DeviceError(400, "The file is not the one the delivery block signed (sha256 differs)");
  if (delivers[0]?.body.fileSha256 && !upload) throw new DeviceError(400, "The delivery block names a file that was not sent");
  const known = await db.dealEvent.findMany({ where: { id: { in: eventIds } }, select: { id: true } });
  if (known.length !== new Set(eventIds).size) throw new DeviceError(409, "A deal event in these blocks is not one this server signed");

  const last = blocks[blocks.length - 1];
  const serverSig = await serverSign(headMessage(owner, last.height, last.hash));
  // Only one submit can move the head from the one it started at.
  const moved = await db.device.updateMany({
    where: { address: owner, headHash: from ? from.hash : null },
    data: { headHeight: last.height, headHash: last.hash, headBlock: last as unknown as Prisma.InputJsonValue, headServerSig: serverSig, headAt: new Date() },
  });
  if (!moved.count) throw new DeviceError(409, "Another sync moved this device's head first. Sync again");
  await db.dealEventAck.createMany({
    data: blocks.filter((b) => b.kind === "event").map((b) => ({ eventId: (b.body as { event: DealEventBody }).event.id, deviceAddress: owner, height: b.height, blockHash: b.hash })),
    skipDuplicates: true,
  });

  const results = [];
  for (const b of intents) results.push(await runIntent(device, b, upload));
  return { head: { height: last.height, hash: last.hash, serverSig }, intents: results };
}

/** Results can hold bigints (amounts in minor units): stored as strings. */
const jsonSafe = (v: unknown) =>
  v === undefined || v === null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x))) as Prisma.InputJsonValue);

async function runIntent(device: DeviceRow, b: Block & { kind: "intent"; hash: Hex }, upload: Upload | null) {
  const i = b.body;
  const record = (status: string, result: unknown) =>
    db.deviceIntent.create({
      data: {
        blockHash: b.hash,
        deviceAddress: device.address,
        userId: device.userId,
        height: b.height,
        dealId: i.dealId,
        action: i.action,
        index: i.index,
        requestId: i.requestId ?? null,
        status,
        result: jsonSafe(result),
      },
    });
  let request = null;
  if (i.requestId) {
    request = await db.deviceRequest.findFirst({ where: { id: i.requestId, userId: device.userId, status: "PENDING" } });
    if (!request || request.dealId !== i.dealId || request.index !== i.index || (i.action !== "reject" && request.action !== i.action)) {
      await record("failed", { error: "That website request is gone or does not match" });
      return { block: b.hash, ok: false, error: "That website request is gone or does not match" };
    }
  }
  if (i.action === "reject") {
    if (request) await db.deviceRequest.update({ where: { id: request.id }, data: { status: "REJECTED", doneAt: new Date() } });
    await record("done", { rejected: true });
    return { block: b.hash, ok: true, result: { rejected: true } };
  }
  try {
    const customer = await customerOfUser(device.userId);
    if (!customer) throw new DeviceError(403, "Sign in through the Mock Bank on the website first");
    // A move signed "as" a group runs on the group's wallet (checked: the user is a member).
    const acting = await actingDevice(device, i.as);
    const wallet = deviceWallet(acting);
    if (i.action === "deliver") {
      const result = await deliver(device.userId, wallet, i.dealId, i.index, {
        note: i.note ?? "",
        file: upload ? { name: (i.fileName || upload.name).slice(0, 200), mime: upload.mime, bytes: upload.bytes } : null,
        parcel: i.carrier ? { carrier: i.carrier as Carrier, tracking: i.tracking || undefined } : null,
      }).catch((e) => {
        throw e instanceof DealError ? new DeviceError(400, e.message) : e;
      });
      after(() => syncDeal(wallet, i.dealId).catch((e) => console.error("syncDeal", i.dealId, e)));
      await record("done", result);
      return { block: b.hash, ok: true, result: jsonSafe(result) };
    }
    if (i.action === "vote") {
      const r = await vote(device.userId, i.proposalId!, i.approve!).catch((e) => {
        throw e instanceof SocialError ? new DeviceError(400, e.message) : e;
      });
      await record("done", r);
      return { block: b.hash, ok: true, result: jsonSafe(r) };
    }
    if (i.action === "payee") {
      const outcome = await setFriendPayee(device.userId, i.friendshipId!, i.allowed!, wallet).catch((e) => {
        throw e instanceof SocialError ? new DeviceError(400, e.message) : e;
      });
      if (outcome.status !== "success") throw new DeviceError(400, outcome.error);
      await record("done", outcome);
      return { block: b.hash, ok: true, result: jsonSafe(outcome) };
    }
    if (i.action === "confirm_draft") {
      const result = await confirmDraft(device.userId, wallet, i.draftId!, appOrigin());
      await record("done", { draft: i.draftId });
      return { block: b.hash, ok: true, result: jsonSafe(result) };
    }
    const result = await runDealMove(
      { userId: device.userId, currency: customer.currency, wallet },
      i.dealId,
      i.action as DealMove,
      i.index,
      i.reason ?? request?.reason ?? undefined,
    );
    if (request) await db.deviceRequest.update({ where: { id: request.id }, data: { status: "SIGNED", doneAt: new Date() } });
    await record("done", result);
    return { block: b.hash, ok: true, result: jsonSafe(result) };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Failed";
    await record("failed", { error });
    return { block: b.hash, ok: false, error };
  }
}

// ------------------------------------------------------------------------------------------
// Website moves the app signs
// ------------------------------------------------------------------------------------------

/**
 * With "My desktop app signs deal moves" on (and a linked device), a move pressed on the website
 * waits for the app: it shows the request, and the user signs (or rejects) it there.
 */
export async function requestDeviceSignature(userId: string, wallet: Address, move: { dealId: number; action: DealMove; index: number; reason?: string }) {
  const pref = await db.userPreference.findUnique({ where: { userId }, select: { deviceSigns: true } });
  if (!pref?.deviceSigns) return null;
  const device = await db.device.findFirst({ where: { userId, walletAddress: getAddress(wallet), revokedAt: null } });
  if (!device) return null;
  const same = await db.deviceRequest.findFirst({ where: { userId, dealId: move.dealId, index: move.index, action: move.action, status: "PENDING" } });
  if (same) return { id: same.id, device: device.name };
  const r = await db.deviceRequest.create({ data: { userId, dealId: move.dealId, action: move.action, index: move.index, reason: move.reason?.slice(0, 2000) ?? null } });
  return { id: r.id, device: device.name };
}

export async function setDeviceSigns(userId: string, on: boolean) {
  if (on && !(await db.device.findFirst({ where: { userId, revokedAt: null } }))) throw new DeviceError(400, "Link a desktop app first");
  await db.userPreference.upsert({ where: { userId }, update: { deviceSigns: on }, create: { userId, deviceSigns: on } });
}

export async function deviceSettings(userId: string) {
  const [pref, devices, requests] = await Promise.all([
    db.userPreference.findUnique({ where: { userId }, select: { deviceSigns: true } }),
    myDevices(userId),
    db.deviceRequest.count({ where: { userId, status: "PENDING" } }),
  ]);
  return { deviceSigns: pref?.deviceSigns ?? false, devices, pendingRequests: requests, server: serverSigner(), downloads: process.env.DESKTOP_DOWNLOAD_URL ?? "/download" };
}

// ------------------------------------------------------------------------------------------
// What the app shows
// ------------------------------------------------------------------------------------------

export async function deviceAccount(device: DeviceRow) {
  const wallet = deviceWallet(device);
  const [user, account] = await Promise.all([db.user.findUnique({ where: { id: device.userId }, select: { name: true } }), accountOf(wallet)]);
  return {
    name: user?.name ?? "",
    wallet,
    device: device.address,
    deviceName: device.name,
    currency: account?.currency ?? "THB",
    balance: account ? Number(account.balance) / 100 : 0,
    server: serverSigner(),
  };
}

/** The wallet's deals with titles and which side's chains recorded each event. */
export async function deviceDeals(device: DeviceRow) {
  const wallet = deviceWallet(device);
  const deals = await readFileDeals(wallet);
  const terms = await Promise.all(deals.map((d) => dealTerms(d.id, d.role === "buyer" ? wallet : d.counterparty, d.role === "seller" ? wallet : d.counterparty)));
  const counterDevices = await db.device.findMany({ where: { walletAddress: { in: [...new Set(deals.map((d) => d.counterparty))] }, revokedAt: null }, select: { walletAddress: true } });
  const withApp = new Set(counterDevices.map((d) => d.walletAddress.toLowerCase()));
  const dues = await Promise.all(deals.map((d) => dueDates(wallet, d.id).catch(() => [])));
  // Delivered files (name and type only), so the app can offer the watermarked preview.
  const files = await db.dealDelivery.findMany({
    where: { dealId: { in: deals.map((d) => d.id) }, ciphertext: { not: null } },
    select: { escrow: true, dealId: true, index: true, fileName: true, mime: true },
  });
  return deals.map((d, i) => {
    const names = Array.isArray(terms[i]?.milestones) ? (terms[i]!.milestones as DraftMilestone[]) : [];
    return {
      id: d.id,
      title: terms[i]?.title ?? `Deal D-${d.id}`,
      role: d.role,
      counterparty: d.counterparty,
      counterpartyLabel: d.counterpartyLabel,
      counterpartyHasApp: withApp.has(d.counterparty.toLowerCase()),
      offeredBy: d.offeredBy,
      total: d.total,
      status: d.status,
      reviewHours: d.reviewHours,
      milestones: d.milestones.map((m) => {
        const t = names[m.index];
        return {
          index: m.index,
          name: t?.name ?? `Milestone ${m.index + 1}`,
          amount: m.amount,
          status: m.status,
          deadline: m.deadline,
          split: m.split ?? null,
          delivery: t ? (t.deposit ? "deposit" : deliveryOf(t)) : m.hasFile ? "file" : "note",
          acceptance: t?.acceptance ?? null,
          fileTypes: t?.fileTypes ?? [],
          due: dues[i]?.find((x) => x.index === m.index) ?? null,
          file: (() => {
            const f = files.find((x) => x.dealId === d.id && x.index === m.index && x.escrow.toLowerCase() === config.fileEscrowOf(d.id).toLowerCase());
            if (!f) return null;
            const pdf = f.mime === "application/pdf" || /\.pdf$/i.test(f.fileName ?? "");
            return { name: f.fileName ?? "file", mime: f.mime, preview: pdf || Boolean(f.mime?.startsWith("image/")) };
          })(),
        };
      }),
    };
  });
}

/** For each event the device recorded: whether the other party's chain carries it too (linked). */
export async function eventLinks(device: DeviceRow, ids: string[]) {
  const acks = await db.dealEventAck.findMany({
    where: { eventId: { in: ids.slice(0, 500) }, deviceAddress: { not: device.address } },
    select: { eventId: true, height: true, blockHash: true, device: { select: { walletAddress: true } } },
  });
  return acks
    .filter((a) => a.device.walletAddress.toLowerCase() !== device.walletAddress.toLowerCase())
    .map((a) => ({ event: a.eventId, height: a.height, block: a.blockHash }));
}

/** Friends and whether the wallet may pay each (payee). */
export async function deviceContacts(device: DeviceRow) {
  const friends = await listFriends(device.userId, deviceWallet(device));
  return friends.filter((f) => f.status === "ACCEPTED").map((f) => ({ friendshipId: f.friendshipId, name: f.name, username: f.username, hasWallet: Boolean(f.wallet), payee: f.allowlisted }));
}

/** Previews and drafts not locked yet (what the AI drafted): the app confirms them with a signed block. */
export async function deviceDrafts(device: DeviceRow) {
  const drafts = await listDrafts(device.userId, deviceWallet(device));
  const open = drafts.filter((d) => ["PREVIEW", "DRAFT", "FAILED", "NEED_INFO"].includes(d.status));
  const views = await Promise.all(open.map((d) => draftView(d)));
  return JSON.parse(JSON.stringify(views, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const KIND_LABEL: Record<string, string> = {
  DEPOSIT: "Opening deposit",
  FUND: "Locked for a deal",
  REFUND: "Refund from a deal",
  PAYOUT: "Payment received",
  WITHDRAW: "Payment from a deal (invited seller)",
  TOPUP: "Top-up",
  TRANSFER: "Sent / received",
  PLAN: "Split payment (held until the last part)",
};

/** The wallet's money in and out (the Mock Bank statement), newest first. */
export async function deviceActivity(device: DeviceRow) {
  const account = await accountOf(deviceWallet(device));
  if (!account) return { balance: 0, currency: "THB", rows: [] };
  const rows = await db.bankTransfer.findMany({
    where: { OR: [{ fromId: account.id }, { toId: account.id }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    include: { from: { select: { kind: true, label: true } }, to: { select: { kind: true, label: true } } },
  });
  return {
    balance: Number(account.balance) / 100,
    currency: account.currency,
    rows: rows.map((t) => {
      const incoming = t.toId === account.id;
      const other = incoming ? t.from : t.to;
      return {
        id: t.id,
        kind: t.kind,
        label: KIND_LABEL[t.kind] ?? t.kind,
        direction: incoming ? "in" : "out",
        amount: Number(t.amount) / 100,
        counterparty: !other ? "Mock Bank" : other.kind === "RESERVE" ? "Agentic Wallet escrow" : other.label,
        txHash: t.txHash,
        at: t.createdAt,
      };
    }),
  };
}

// ------------------------------------------------------------------------------------------
// Backup
// ------------------------------------------------------------------------------------------

export async function saveBackup(device: DeviceRow, data: string, height: number) {
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > MAX_BACKUP_BYTES) throw new DeviceError(400, "Backup too large");
  if (device.headHeight === null || height !== device.headHeight) throw new DeviceError(409, "Back up after syncing (the backup must end at the head)");
  await db.device.update({ where: { address: device.address }, data: { backup: new Uint8Array(bytes), backupHeight: height, backupAt: new Date() } });
}

export async function loadBackup(device: DeviceRow) {
  const d = await db.device.findUniqueOrThrow({ where: { address: device.address }, select: { backup: true, backupHeight: true, backupAt: true } });
  return { data: d.backup ? Buffer.from(d.backup).toString("base64") : null, height: d.backupHeight, at: d.backupAt, head: headOf(device) };
}

// ------------------------------------------------------------------------------------------
// Public anchor
// ------------------------------------------------------------------------------------------

/**
 * One Merkle root over every linked device's head, sent to ChainAnchor when CHAIN_ANCHOR_ADDRESS is
 * set (else kept here as LOCAL, so proofs still work). Skipped when nothing moved since the last one.
 */
export async function anchorHeads() {
  const devices = await db.device.findMany({ where: { revokedAt: null, headHash: { not: null } }, select: { address: true, headHeight: true, headHash: true } });
  const heads = devices.map((d) => ({ address: d.address, height: d.headHeight!, hash: d.headHash! })).sort((a, b) => (a.address < b.address ? -1 : 1));
  if (!heads.length) return { skipped: "no heads" };
  const root = merkleRoot(heads.map(headLeaf));
  const last = await db.chainAnchorRecord.findFirst({ orderBy: { createdAt: "desc" } });
  if (last?.root === root && last.status !== "FAILED") return { skipped: "unchanged", root };
  const contract = process.env.CHAIN_ANCHOR_ADDRESS;
  let status = "LOCAL";
  let txHash: string | null = null;
  if (contract && isAddress(contract)) {
    const out = await send("bank", { address: getAddress(contract), abi: chainAnchorAbi, functionName: "anchor", args: [root, BigInt(heads.length)] });
    status = out.status === "success" ? "SENT" : "FAILED";
    txHash = "hash" in out ? out.hash : null;
    if (out.status !== "success") console.error("anchor", out);
  }
  const rec = await db.chainAnchorRecord.create({ data: { root, heads, count: heads.length, txHash, status } });
  return { root, count: heads.length, status, txHash, id: rec.id };
}

/** The latest anchor that holds one of this device's heads, with its Merkle proof. */
export async function anchorProof(device: DeviceRow) {
  const anchors = await db.chainAnchorRecord.findMany({ where: { status: { in: ["SENT", "LOCAL"] } }, orderBy: { createdAt: "desc" }, take: 20 });
  for (const a of anchors) {
    const heads = a.heads as { address: string; height: number; hash: string }[];
    const mine = heads.find((h) => h.address === device.address);
    if (!mine) continue;
    const leaves = heads.map(headLeaf);
    return {
      root: a.root,
      at: a.createdAt,
      status: a.status,
      txHash: a.txHash,
      contract: process.env.CHAIN_ANCHOR_ADDRESS ?? null,
      head: mine,
      proof: merkleProof(leaves, headLeaf(mine)),
    };
  }
  return null;
}

export { FORMAT_VERSION, ZERO_HASH };
