/**
 * The block format of the desktop app's device chains, shared by the server (lib/device-chain) and
 * the app (desktop/, which imports this file). No server-only imports here.
 *
 * Every device keeps its own chain: block n names the hash of block n-1, so changing any old block
 * changes every hash after it. Each block is signed by the device key; the server countersigns the
 * head (the latest block) and keeps only that. Deal events are signed by the server and carried in
 * the chains of both parties of the deal: the same event hash in two chains links them.
 */
import { type Address, type Hex, getAddress, keccak256, recoverMessageAddress, toHex } from "viem";

export const FORMAT_VERSION = 1;
export const ZERO_HASH: Hex = `0x${"0".repeat(64)}`;

/** A fact about a deal (what the escrow shows), signed by the server. */
export type DealEventBody = {
  id: Hex;
  dealId: number;
  type: "deal" | "milestone";
  index: number | null;
  /** Deal: Proposed | Active | Cancelled. Milestone: Pending | Delivered | ... | Split. */
  status: string;
  data: Record<string, string | number | boolean | null>;
  parties: string[];
};

export type GenesisBody = { wallet: string; server: string; linkedAt: number };
export type EventBlockBody = { event: DealEventBody; serverSig: Hex };
export type IntentBody = {
  /** 0 for a move that is not on a deal yet (confirm_draft). */
  dealId: number;
  action: "approve" | "dispute" | "accept" | "cancel" | "claim" | "refund" | "reclaim" | "reject" | "deliver" | "confirm_draft" | "payee" | "vote";
  index: number;
  reason?: string;
  /** A move started on the website that the app signs (DeviceRequest id). */
  requestId?: string;
  /** deliver: what was handed over. The file's sha256 is signed here; the file itself goes to the server alongside. */
  note?: string;
  fileName?: string;
  fileSha256?: string;
  carrier?: string;
  tracking?: string;
  /** confirm_draft: the preview the user confirms (the server reads its terms from the database). */
  draftId?: string;
  /** payee: let the wallet pay this contact (true) or stop it (false). */
  friendshipId?: string;
  allowed?: boolean;
  /** vote: a group payment proposal and the signer's answer. */
  proposalId?: string;
  approve?: boolean;
};

export type Block =
  | { v: number; owner: Address; height: number; prev: Hex; time: number; kind: "genesis"; body: GenesisBody }
  | { v: number; owner: Address; height: number; prev: Hex; time: number; kind: "event"; body: EventBlockBody }
  | { v: number; owner: Address; height: number; prev: Hex; time: number; kind: "intent"; body: IntentBody };

export type SignedBlock = Block & { hash: Hex; sig: Hex };

/** JSON with sorted keys and no spaces, so both sides hash the same bytes. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export const hashOf = (value: unknown): Hex => keccak256(toHex(canonical(value)));

/** The id of a deal event: the hash of what it says (without the id itself). */
export const eventId = (e: Omit<DealEventBody, "id">): Hex => hashOf({ ...e, parties: [...e.parties].map((p) => p.toLowerCase()).sort() });

export function blockHash(b: Block): Hex {
  return hashOf({ v: b.v, owner: getAddress(b.owner), height: b.height, prev: b.prev, time: b.time, kind: b.kind, body: b.body });
}

/** What the server signs to countersign a head. */
export const headMessage = (owner: Address, height: number, hash: Hex) => `Agentic Wallet device head\n${getAddress(owner)}\n${height}\n${hash}`;
/** What the server signs for a deal event. */
export const eventMessage = (id: Hex) => `Agentic Wallet deal event\n${id}`;
/** What a device signs to link itself with a one-time code. */
export const linkMessage = (code: string, device: Address) => `Agentic Wallet link device\n${code.toUpperCase()}\n${getAddress(device)}`;
/** What a device signs to make an account (or sign in) and link itself in one step. */
export const accountMessage = (kind: "signup" | "login", email: string, device: Address) => `Agentic Wallet ${kind} device\n${email.trim().toLowerCase()}\n${getAddress(device)}`;
/** What a device signs for every request (method, path, time and the hash of the body's bytes). */
export const requestMessage = (method: string, path: string, time: number, body: string | Uint8Array) =>
  `Agentic Wallet device request\n${method.toUpperCase()}\n${path}\n${time}\n${keccak256(typeof body === "string" ? toHex(body) : body)}`;

export async function signerOf(message: string, sig: Hex): Promise<Address> {
  return getAddress(await recoverMessageAddress({ message, signature: sig }));
}

/** Blocks are signed over the 32 bytes of their hash (EIP-191 personal message). */
export async function blockSigner(hash: Hex, sig: Hex): Promise<Address> {
  return getAddress(await recoverMessageAddress({ message: { raw: hash }, signature: sig }));
}

export type ChainCheck = { ok: true; height: number; head: Hex } | { ok: false; height: number; error: string };

/**
 * Checks a run of blocks: each one's hash and device signature, the links between them, and (when
 * given) that it continues from `from` and that events carry the server's signature.
 */
export async function verifyBlocks(
  blocks: SignedBlock[],
  opts: { owner: Address; from?: { height: number; hash: Hex } | null; server?: Address },
): Promise<ChainCheck> {
  let height = opts.from ? opts.from.height : -1;
  let prev = opts.from ? opts.from.hash : ZERO_HASH;
  for (const b of blocks) {
    const at = b.height;
    if (b.v !== FORMAT_VERSION) return { ok: false, height: at, error: `Block ${at}: unknown format ${b.v}` };
    if (getAddress(b.owner) !== getAddress(opts.owner)) return { ok: false, height: at, error: `Block ${at}: belongs to another device` };
    if (b.height !== height + 1) return { ok: false, height: at, error: `Block ${at}: expected height ${height + 1}` };
    if (b.prev !== prev) return { ok: false, height: at, error: `Block ${at}: does not link to the block before it` };
    if ((b.height === 0) !== (b.kind === "genesis")) return { ok: false, height: at, error: `Block ${at}: only block 0 is the genesis` };
    if (blockHash(b) !== b.hash) return { ok: false, height: at, error: `Block ${at}: its content was changed (hash mismatch)` };
    if ((await blockSigner(b.hash, b.sig).catch(() => null)) !== getAddress(opts.owner)) return { ok: false, height: at, error: `Block ${at}: not signed by this device` };
    if (b.kind === "event") {
      const e = b.body.event;
      const { id, ...rest } = e;
      if (eventId(rest) !== id) return { ok: false, height: at, error: `Block ${at}: the deal event was changed` };
      if (opts.server && (await signerOf(eventMessage(id), b.body.serverSig).catch(() => null)) !== getAddress(opts.server)) {
        return { ok: false, height: at, error: `Block ${at}: the deal event is not signed by the server` };
      }
    }
    height = b.height;
    prev = b.hash;
  }
  return { ok: true, height, head: prev };
}

/** Merkle tree over device heads (sorted leaves, sorted pairs), for the public anchor. */
export const headLeaf = (h: { address: string; height: number; hash: string }) => hashOf({ address: getAddress(h.address), height: h.height, hash: h.hash });

function pairHash(a: Hex, b: Hex): Hex {
  return a < b ? keccak256(`0x${a.slice(2)}${b.slice(2)}`) : keccak256(`0x${b.slice(2)}${a.slice(2)}`);
}

export function merkleRoot(leaves: Hex[]): Hex {
  if (!leaves.length) return ZERO_HASH;
  let level = [...leaves].sort();
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? pairHash(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0];
}

export function merkleProof(leaves: Hex[], leaf: Hex): Hex[] | null {
  let level = [...leaves].sort();
  let i = level.indexOf(leaf);
  if (i < 0) return null;
  const proof: Hex[] = [];
  while (level.length > 1) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < level.length) proof.push(level[sibling]);
    const next: Hex[] = [];
    for (let j = 0; j < level.length; j += 2) next.push(j + 1 < level.length ? pairHash(level[j], level[j + 1]) : level[j]);
    level = next;
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  return proof.reduce((h, p) => pairHash(h, p), leaf) === root;
}
