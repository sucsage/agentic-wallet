import { hostname, platform } from "node:os";

import { type Address, type Hex, getAddress } from "viem";
import { type PrivateKeyAccount, generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  type Block,
  type DealEventBody,
  FORMAT_VERSION,
  type IntentBody,
  type SignedBlock,
  ZERO_HASH,
  blockHash,
  eventId,
  eventMessage,
  headLeaf,
  headMessage,
  linkMessage,
  signerOf,
  verifyBlocks,
  verifyProof,
} from "../../web/src/lib/device-chain/format";
import { ApiError, plain, signed } from "./api";
import * as store from "./store";
import { type VaultFile, WrongPassphrase, hasVault, openBackup, openKey, readVault, sealBackup, sealKey, writeVault } from "./vault";

export const DEFAULT_SERVER = "https://agentic-wallet-inky.vercel.app";

type Head = { height: number; hash: Hex; serverSig: Hex; block: SignedBlock } | null;
type Pending = { head: Head; server: Address; events: { event: DealEventBody; serverSig: Hex }[]; requests: WebRequest[] };
export type WebRequest = { id: string; dealId: number; action: string; index: number; reason: string | null; createdAt: string };
type IntentResult = { block: Hex; ok: boolean; result?: unknown; error?: string };

const osName = () => ({ darwin: "macOS", win32: "Windows", linux: "Linux" })[platform() as string] ?? platform();

/**
 * The app's state: the vault (encrypted key), the unlocked key in memory, and the chain in SQLite.
 * Every chain change runs one at a time (a promise queue), so blocks never race each other.
 */
class Wallet {
  vault: VaultFile | null = hasVault() ? readVault() : null;
  account: PrivateKeyAccount | null = null;
  private key: Hex | null = null;
  requests: WebRequest[] = [];
  lastSync: { at: number; ok: boolean; error?: string; added: number } | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  stage(): "setup" | "locked" | "ready" {
    return !this.vault ? "setup" : !this.account ? "locked" : "ready";
  }

  private need() {
    if (!this.vault || !this.account || !this.key) throw new ApiError(423, "Unlock the app first");
    return { vault: this.vault, account: this.account, key: this.key };
  }

  private call<T>(method: "GET" | "POST", path: string, body?: unknown) {
    const { vault, account } = this.need();
    return signed<T>(vault.server, account, method, path, body);
  }

  private async sign(b: Block): Promise<SignedBlock> {
    const { account } = this.need();
    const hash = blockHash(b);
    return { ...b, hash, sig: await account.signMessage({ message: { raw: hash } }) };
  }

  private next<K extends Block["kind"]>(kind: K, body: Extract<Block, { kind: K }>["body"]): Block {
    const h = store.head();
    return { v: FORMAT_VERSION, owner: this.need().account.address, height: h ? h.height + 1 : 0, prev: h ? h.hash : ZERO_HASH, time: Date.now(), kind, body } as Block;
  }

  // ----------------------------------------------------------------------------------------
  // Setup, unlock, restore
  // ----------------------------------------------------------------------------------------

  async setup(input: { server: string; code: string; passphrase: string; deviceName?: string }) {
    if (this.vault) throw new ApiError(409, "This computer is already set up");
    if (input.passphrase.length < 8) throw new ApiError(400, "Use a passphrase of at least 8 characters");
    const server = new URL(input.server.trim() || DEFAULT_SERVER).origin;
    const key = generatePrivateKey();
    const account = privateKeyToAccount(key);
    const code = input.code.trim().toUpperCase();
    const deviceName = (input.deviceName?.trim() || hostname()).slice(0, 60);
    const sig = await account.signMessage({ message: linkMessage(code.replace(/[^A-Z0-9]/g, ""), account.address) });
    const linked = await plain<{ device: Address; wallet: Address; server: Address; user: string }>(server, "/api/device/link", {
      code,
      address: account.address,
      name: deviceName,
      os: osName(),
      sig,
    });
    const vault = sealKey(key, input.passphrase, {
      address: account.address,
      server,
      serverSigner: linked.server,
      wallet: linked.wallet,
      user: linked.user,
      deviceName,
      linkedAt: Date.now(),
    });
    writeVault(vault);
    store.replaceAll([]);
    this.vault = vault;
    this.account = account;
    this.key = key;
    await this.serial(async () => {
      const genesis = await this.sign(this.next("genesis", { wallet: linked.wallet, server: linked.server, linkedAt: vault.linkedAt }));
      store.append([genesis]);
      await this.submit([genesis]);
    });
    return this.sync();
  }

  unlock(passphrase: string) {
    if (!this.vault) throw new ApiError(409, "Set up the app first");
    try {
      this.key = openKey(this.vault, passphrase);
    } catch (e) {
      throw e instanceof WrongPassphrase ? new ApiError(401, e.message) : e;
    }
    this.account = privateKeyToAccount(this.key);
    if (this.account.address !== getAddress(this.vault.address)) {
      this.lock();
      throw new ApiError(500, "The vault is damaged (its key does not match its address)");
    }
  }

  lock() {
    this.key = null;
    this.account = null;
    this.requests = [];
  }

  /** A new computer: the key backup file + passphrase, then the chain from the encrypted server backup. */
  async restore(input: { keyBackup: string; passphrase: string }) {
    if (this.vault) throw new ApiError(409, "This computer is already set up");
    let vault: VaultFile;
    try {
      vault = JSON.parse(input.keyBackup);
      if (vault.v !== 1 || !vault.key) throw new Error();
    } catch {
      throw new ApiError(400, "That is not an Agentic Wallet key backup file");
    }
    this.vault = vault;
    try {
      this.unlock(input.passphrase);
      const backup = await this.call<{ data: string | null; height: number | null; head: Head }>("GET", "/api/device/backup");
      if (!backup.head) throw new ApiError(404, "The server has no chain for this device");
      let blocks: SignedBlock[] = [];
      if (backup.data) blocks = JSON.parse(openBackup(this.key!, backup.data));
      const check = await verifyBlocks(blocks, { owner: getAddress(vault.address), server: getAddress(vault.serverSigner) });
      if (!check.ok) throw new ApiError(409, `The backup does not verify: ${check.error}`);
      if (check.head !== backup.head.hash) throw new ApiError(409, "The backup does not end at the head the server countersigned");
      writeVault(vault);
      store.replaceAll(blocks);
    } catch (e) {
      this.vault = null;
      this.lock();
      throw e;
    }
    return this.sync();
  }

  /** This chain fails its check (changed on disk): put back the last encrypted backup, if it verifies and ends at the server's head. */
  repair() {
    return this.serial(async () => {
      const { vault, key } = this.need();
      const backup = await this.call<{ data: string | null; head: Head }>("GET", "/api/device/backup");
      if (!backup.data || !backup.head) throw new ApiError(404, "The server has no backup for this device yet");
      const blocks: SignedBlock[] = JSON.parse(openBackup(key, backup.data));
      const check = await verifyBlocks(blocks, { owner: getAddress(vault.address), server: getAddress(vault.serverSigner) });
      if (!check.ok) throw new ApiError(409, `The backup does not verify either: ${check.error}`);
      if (check.head !== backup.head.hash) throw new ApiError(409, "The backup does not end at the server's head: sync on the computer that made it first");
      store.replaceAll(blocks);
      store.setMeta("backupHeight", String(check.height));
      return { height: check.height };
    });
  }

  keyBackup(): string {
    if (!this.vault) throw new ApiError(409, "Nothing to back up yet");
    return JSON.stringify(this.vault, null, 2);
  }

  // ----------------------------------------------------------------------------------------
  // Sync
  // ----------------------------------------------------------------------------------------

  /** Sends blocks to the server. If it refuses them, they are dropped (they were never countersigned). */
  private async submit(blocks: SignedBlock[]): Promise<IntentResult[]> {
    try {
      const r = await this.call<{ head: { height: number; hash: Hex; serverSig: Hex }; intents: IntentResult[] }>("POST", "/api/device/blocks", { blocks });
      await this.checkServerHead(r.head);
      store.setMeta("serverHead", JSON.stringify(r.head));
      return r.intents;
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) store.truncateAbove(blocks[0].height - 1);
      throw e;
    }
  }

  private async checkServerHead(h: { height: number; hash: Hex; serverSig: Hex }) {
    const signer = await signerOf(headMessage(this.need().account.address, h.height, h.hash), h.serverSig).catch(() => null);
    if (signer !== getAddress(this.need().vault.serverSigner)) throw new ApiError(502, "The server's countersignature does not match the server this app was linked to");
  }

  sync(): Promise<{ added: number; requests: number }> {
    return this.serial(async () => {
      try {
        const out = await this.syncOnce();
        this.lastSync = { at: Date.now(), ok: true, added: out.added };
        return out;
      } catch (e) {
        this.lastSync = { at: Date.now(), ok: false, error: e instanceof Error ? e.message : String(e), added: 0 };
        throw e;
      }
    });
  }

  private async syncOnce() {
    const { vault, key } = this.need();
    const p = await this.call<Pending>("GET", "/api/device/sync");
    if (getAddress(p.server) !== getAddress(vault.serverSigner)) throw new ApiError(502, "The server's signing key changed since this app was linked");
    const local = store.head();
    // 1. Line up with the head the server countersigned.
    if (p.head) {
      await this.checkServerHead(p.head);
      const mine = store.blockAt(p.head.height);
      if (!mine) throw new ApiError(409, `The server has blocks up to ${p.head.height} that this computer does not: restore from your backup`);
      if (mine.hash !== p.head.hash) throw new ApiError(409, `Block ${p.head.height} here differs from the one the server countersigned: this chain was changed`);
      if (local && local.height > p.head.height) await this.submit(store.blocksFrom(p.head.height + 1));
    } else if (local) {
      await this.submit(store.blocksFrom(0));
    } else {
      // Linked, but the genesis never reached the server (e.g. offline at setup): make it now.
      const genesis = await this.sign(this.next("genesis", { wallet: vault.wallet, server: vault.serverSigner, linkedAt: vault.linkedAt }));
      store.append([genesis]);
      await this.submit([genesis]);
    }
    // 2. Append the new deal events (each checked: its id and the server's signature).
    const fresh: SignedBlock[] = [];
    const have = new Set(store.eventIds());
    for (const { event, serverSig } of p.events) {
      if (have.has(event.id)) continue;
      const { id, ...rest } = event;
      if (eventId(rest) !== id) throw new ApiError(502, "The server sent a deal event whose id does not match its content");
      if ((await signerOf(eventMessage(id), serverSig).catch(() => null)) !== getAddress(vault.serverSigner)) throw new ApiError(502, "A deal event is not signed by the server");
      const b = await this.sign(this.next("event", { event, serverSig }));
      store.append([b]);
      fresh.push(b);
      have.add(id);
    }
    if (fresh.length) await this.submit(fresh);
    this.requests = p.requests;
    // 3. Encrypted backup of the whole chain, when it grew.
    const h = store.head();
    if (h && store.getMeta("backupHeight") !== String(h.height)) {
      await this.call("POST", "/api/device/backup", { data: sealBackup(key, JSON.stringify(store.allBlocks())), height: h.height });
      store.setMeta("backupHeight", String(h.height));
    }
    return { added: fresh.length, requests: p.requests.length };
  }

  /** A deal move, signed here as an intent block; the server runs it once the block is on the chain. */
  move(input: { dealId: number; action: IntentBody["action"]; index: number; reason?: string; requestId?: string }) {
    return this.serial(async () => {
      const body: IntentBody = { dealId: input.dealId, action: input.action, index: input.index };
      if (input.reason?.trim()) body.reason = input.reason.trim().slice(0, 2000);
      if (input.requestId) body.requestId = input.requestId;
      const b = await this.sign(this.next("intent", body));
      store.append([b]);
      const [result] = await this.submit([b]);
      return { ...result, block: b.hash, height: b.height };
    }).finally(() => this.sync().catch(() => undefined));
  }

  // ----------------------------------------------------------------------------------------
  // Reading and checking
  // ----------------------------------------------------------------------------------------

  account_() {
    return this.call<{ name: string; wallet: Address; device: Address; deviceName: string; currency: string; balance: number }>("GET", "/api/device/me");
  }

  deals() {
    return this.call<{ deals: unknown[] }>("GET", "/api/device/deals");
  }

  async chain(limit = 200) {
    const blocks = store.lastBlocks(limit);
    const ids = blocks.filter((b) => b.kind === "event").map((b) => (b.body as { event: DealEventBody }).event.id);
    let links: { event: string; height: number; block: string }[] = [];
    if (ids.length) links = await this.call<{ links: typeof links }>("POST", "/api/device/links", { ids }).then((r) => r.links).catch(() => []);
    const serverHead = store.getMeta("serverHead");
    return { total: store.count(), blocks, links, serverHead: serverHead ? JSON.parse(serverHead) : null };
  }

  /** Re-checks every block here, the head against the server's, and the latest public anchor. */
  async verify() {
    const { vault } = this.need();
    const blocks = store.allBlocks();
    const local = await verifyBlocks(blocks, { owner: getAddress(vault.address), server: getAddress(vault.serverSigner) });
    let server: { ok: boolean; detail: string };
    try {
      const p = await this.call<Pending>("GET", "/api/device/sync");
      if (!p.head) server = { ok: false, detail: "The server has no head for this device yet" };
      else {
        await this.checkServerHead(p.head);
        const mine = store.blockAt(p.head.height);
        server = mine?.hash === p.head.hash ? { ok: true, detail: `Block ${p.head.height} matches the head the server countersigned` } : { ok: false, detail: `Block ${p.head.height} differs from the server's head` };
      }
    } catch (e) {
      server = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
    let anchor: { ok: boolean; detail: string; txHash?: string | null; at?: string };
    try {
      const { anchor: a } = await this.call<{ anchor: null | { root: Hex; at: string; status: string; txHash: string | null; contract: string | null; head: { address: string; height: number; hash: Hex }; proof: Hex[] } }>("GET", "/api/device/anchor");
      if (!a) anchor = { ok: false, detail: "Not anchored yet (the server anchors heads hourly)" };
      else {
        const mine = store.blockAt(a.head.height);
        const inProof = verifyProof(headLeaf(a.head), a.proof, a.root);
        const onChain = a.status === "SENT" && a.txHash && a.contract ? await this.anchorOnChain(a.txHash, a.contract, a.root) : null;
        anchor =
          mine?.hash !== a.head.hash || !inProof
            ? { ok: false, detail: "The anchored head does not match this chain" }
            : onChain === false
              ? { ok: false, detail: `The anchor transaction does not carry root ${a.root.slice(0, 10)}…`, txHash: a.txHash }
              : {
                  ok: true,
                  detail: `Block ${a.head.height} is in anchor ${a.root.slice(0, 10)}… ${onChain ? "· the transaction receipt on the chain carries that root" : a.status === "SENT" ? "on the chain" : "(kept by the server; no anchor contract yet)"}`,
                  txHash: a.txHash,
                  at: a.at,
                };
      }
    } catch (e) {
      anchor = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
    return { local: local.ok ? { ok: true, detail: `${blocks.length} blocks: every hash, link and signature checks out` } : { ok: false, detail: local.error }, server, anchor };
  }

  /** Reads the anchor's receipt from the chain (read-only JSON-RPC): an Anchored event of the contract with this root. */
  private async anchorOnChain(txHash: string, contract: string, root: Hex): Promise<boolean | null> {
    try {
      const res = await fetch(new URL("/api/rpc", this.need().vault.server), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [txHash] }),
      });
      const r = (await res.json()) as { result?: { status: string; logs: { address: string; topics: string[] }[] } };
      if (!r.result) return null;
      return r.result.status === "0x1" && r.result.logs.some((l) => l.address.toLowerCase() === contract.toLowerCase() && l.topics[2]?.toLowerCase() === root.toLowerCase());
    } catch {
      return null;
    }
  }

  info() {
    const v = this.vault;
    return {
      stage: this.stage(),
      device: v ? { address: v.address, name: v.deviceName, user: v.user, wallet: v.wallet, server: v.server, linkedAt: v.linkedAt } : null,
      height: store.head()?.height ?? null,
      lastSync: this.lastSync,
      requests: this.requests,
      defaultServer: DEFAULT_SERVER,
      hostname: hostname(),
    };
  }
}

export const wallet = new Wallet();
