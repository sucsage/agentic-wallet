import { createHash } from "node:crypto";
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
  accountMessage,
  linkMessage,
  signerOf,
  verifyBlocks,
  verifyProof,
} from "../../web/src/lib/device-chain/format";
import { ApiError, plain, signed, signedForm } from "./api";
import * as store from "./store";
import { type VaultFile, WrongPassphrase, hasVault, openBackup, openKey, openLocal, readVault, sealBackup, sealKey, sealLocal, writeVault } from "./vault";

export const DEFAULT_SERVER = "https://agentic-wallet-inky.vercel.app";

type Head = { height: number; hash: Hex; serverSig: Hex; block: SignedBlock } | null;
type Pending = { head: Head; server: Address; events: { event: DealEventBody; serverSig: Hex }[]; requests: WebRequest[] };
export type AgentRequest = {
  id: string;
  client: string;
  kind: "move" | "confirm_draft" | "payee";
  dealId?: number;
  action?: string;
  index?: number;
  reason?: string;
  draftId?: string;
  friendshipId?: string;
  allowed?: boolean;
  why?: string;
  status: "PENDING" | "SIGNED" | "REJECTED" | "FAILED";
  error?: string;
  block?: string;
  createdAt: number;
  answeredAt?: number;
};
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

  stage(): "setup" | "locked" | "onboarding" | "ready" {
    return !this.vault ? "setup" : !this.account ? "locked" : !this.vault.wallet ? "onboarding" : "ready";
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

  /**
   * A new computer: makes the device key here, links it (a code from the website, or signing in /
   * making an account right here), encrypts the key with the passphrase and starts the chain.
   */
  async setup(input: { mode?: "code" | "login" | "signup"; server: string; code?: string; email?: string; password?: string; name?: string; passphrase: string; deviceName?: string }) {
    if (this.vault) throw new ApiError(409, "This computer is already set up");
    if (input.passphrase.length < 8) throw new ApiError(400, "Use a passphrase of at least 8 characters");
    const server = new URL(input.server.trim() || DEFAULT_SERVER).origin;
    const key = generatePrivateKey();
    const account = privateKeyToAccount(key);
    const deviceName = (input.deviceName?.trim() || hostname()).slice(0, 60);
    const mode = input.mode ?? "code";
    let linked: { wallet: Address | null; server: Address; user: string };
    if (mode === "code") {
      const code = (input.code ?? "").trim().toUpperCase();
      const sig = await account.signMessage({ message: linkMessage(code.replace(/[^A-Z0-9]/g, ""), account.address) });
      linked = await plain(server, "/api/device/link", { code, address: account.address, name: deviceName, os: osName(), sig });
    } else {
      const email = (input.email ?? "").trim();
      const sig = await account.signMessage({ message: accountMessage(mode, email, account.address) });
      linked = await plain(server, `/api/device/${mode}`, { email, password: input.password ?? "", name: input.name, address: account.address, deviceName, os: osName(), sig });
    }
    const vault = sealKey(key, input.passphrase, {
      address: account.address,
      server,
      serverSigner: linked.server,
      wallet: linked.wallet ?? "",
      user: linked.user,
      deviceName,
      linkedAt: Date.now(),
    });
    writeVault(vault);
    store.replaceAll([]);
    this.vault = vault;
    this.account = account;
    this.key = key;
    if (!vault.wallet) return { onboarding: true };
    return this.startChain();
  }

  /** The first block (once the wallet exists), then a sync. */
  private async startChain() {
    const vault = this.need().vault;
    await this.serial(async () => {
      if (store.head()) return;
      const genesis = await this.sign(this.next("genesis", { wallet: vault.wallet, server: vault.serverSigner, linkedAt: vault.linkedAt }));
      store.append([genesis]);
      await this.submit([genesis]);
    });
    return this.sync();
  }

  // ----------------------------------------------------------------------------------------
  // Onboarding (an account made in the app): identity check, then the wallet
  // ----------------------------------------------------------------------------------------

  setupStatus() {
    return this.call<{ identity: string; lastCheck: string | null; account: string | null; wallet: string | null }>("GET", "/api/device/setup");
  }

  kycStart(country: "TH" | "CN") {
    return this.call<{ url: string }>("POST", "/api/device/kyc/start", { country });
  }

  async finishSetup() {
    const { vault } = this.need();
    const status = await this.setupStatus();
    const wallet = status.wallet ?? (await this.call<{ wallet: string }>("POST", "/api/device/setup/finish")).wallet;
    const next = { ...vault, wallet };
    writeVault(next);
    this.vault = next;
    return this.startChain();
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
  private async submit(blocks: SignedBlock[], file?: { name: string; mime: string; bytes: Uint8Array }): Promise<IntentResult[]> {
    try {
      type Out = { head: { height: number; hash: Hex; serverSig: Hex }; intents: IntentResult[] };
      let r: Out;
      if (file) {
        const { vault, account } = this.need();
        const form = new FormData();
        form.set("blocks", JSON.stringify(blocks));
        form.set("file", new File([file.bytes as Uint8Array<ArrayBuffer>], file.name, { type: file.mime || "application/octet-stream" }));
        r = await signedForm<Out>(vault.server, account, "/api/device/deliver", form);
      } else {
        r = await this.call<Out>("POST", "/api/device/blocks", { blocks });
      }
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
    if (!vault.wallet) return { added: 0, requests: 0 };
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

  /** Delivers a milestone: the block signs the note and the file's sha256; the file goes with it. */
  deliver(input: { dealId: number; index: number; note: string; file?: { name: string; mime: string; bytes: Uint8Array }; carrier?: string; tracking?: string }) {
    return this.serial(async () => {
      const body: IntentBody = { dealId: input.dealId, action: "deliver", index: input.index, note: input.note.trim().slice(0, 4000) };
      if (input.file) {
        body.fileName = input.file.name.slice(0, 200);
        body.fileSha256 = createHash("sha256").update(input.file.bytes).digest("hex");
      }
      if (input.carrier) body.carrier = input.carrier;
      if (input.tracking) body.tracking = input.tracking.slice(0, 40);
      const b = await this.sign(this.next("intent", body));
      store.append([b]);
      const [result] = await this.submit([b], input.file);
      return { ...result, block: b.hash, height: b.height };
    }).finally(() => this.sync().catch(() => undefined));
  }

  /** Confirms a preview the AI drafted (the server reads its terms from the database). */
  confirmDraft(draftId: string) {
    return this.serial(async () => {
      const b = await this.sign(this.next("intent", { dealId: 0, action: "confirm_draft", index: 0, draftId }));
      store.append([b]);
      const [result] = await this.submit([b]);
      return { ...result, block: b.hash, height: b.height };
    }).finally(() => this.sync().catch(() => undefined));
  }

  /** Lets the wallet pay a contact (or stops it): a block signed here, carried out on-chain by the server. */
  payee(friendshipId: string, allowed: boolean) {
    return this.serial(async () => {
      const b = await this.sign(this.next("intent", { dealId: 0, action: "payee", index: 0, friendshipId, allowed }));
      store.append([b]);
      const [result] = await this.submit([b]);
      return { ...result, block: b.hash, height: b.height };
    }).finally(() => this.sync().catch(() => undefined));
  }

  contacts() {
    return this.call<{ contacts: unknown[] }>("GET", "/api/device/contacts");
  }

  friends() {
    return this.call<{ friends: unknown[] }>("GET", "/api/device/friends");
  }
  friendAction(body: unknown) {
    return this.call<{ friends: unknown[] }>("POST", "/api/device/friends", body);
  }
  topupInfo() {
    return this.call<unknown>("GET", "/api/device/topup");
  }
  topupStart(body: { amount: number; method: string; returnTo?: string }) {
    return this.call<{ url?: string; slip?: unknown; linked?: unknown }>("POST", "/api/device/topup", body);
  }
  topupConfirm(sessionId: string) {
    return this.call<{ status: string; amount: number; currency: string }>("POST", "/api/device/topup/confirm", { sessionId });
  }
  counterPay(slip: string) {
    return this.call<unknown>("POST", "/api/device/topup/counter", { slip });
  }
  inviteLinks() {
    return this.call<{ links: unknown[] }>("GET", "/api/device/invite-links");
  }
  inviteLinkAction(body: unknown) {
    return this.call<unknown>("POST", "/api/device/invite-links", body);
  }
  groups() {
    return this.call<unknown>("GET", "/api/device/groups");
  }
  groupAction(body: unknown) {
    return this.call<unknown>("POST", "/api/device/groups", body);
  }

  /** A signer's vote on a group payment: a block signed here. */
  vote(proposalId: string, approve: boolean) {
    return this.serial(async () => {
      const b = await this.sign(this.next("intent", { dealId: 0, action: "vote", index: 0, proposalId, approve }));
      store.append([b]);
      const [result] = await this.submit([b]);
      return { ...result, block: b.hash, height: b.height };
    }).finally(() => this.sync().catch(() => undefined));
  }

  drafts() {
    return this.call<{ drafts: unknown[] }>("GET", "/api/device/drafts");
  }

  activity() {
    return this.call<{ balance: number; currency: string; rows: unknown[] }>("GET", "/api/device/activity");
  }

  /** The AI chat. Its history stays on this computer (the last 30 turns go with each message). */
  chatHistory(): { role: "user" | "assistant"; text: string; at: number; steps?: unknown[]; model?: string | null }[] {
    return JSON.parse(store.getMeta("chat") ?? "[]");
  }

  // ----------------------------------------------------------------------------------------
  // Requests from outside AI agents (MCP): queued here until the user signs or rejects them
  // ----------------------------------------------------------------------------------------

  agentRequests(): AgentRequest[] {
    return JSON.parse(store.getMeta("agentRequests") ?? "[]");
  }

  private saveAgentRequests(list: AgentRequest[]) {
    // Keep every pending one and the latest 50 answered.
    const pending = list.filter((r) => r.status === "PENDING");
    const done = list.filter((r) => r.status !== "PENDING").slice(-50);
    store.setMeta("agentRequests", JSON.stringify([...done, ...pending]));
  }

  addAgentRequest(client: string, input: Record<string, unknown>): AgentRequest {
    this.need();
    const kind = input.kind;
    const MOVES = ["approve", "dispute", "accept", "cancel", "claim", "refund", "reclaim"];
    const r: AgentRequest = { id: crypto.randomUUID(), client: client.slice(0, 60) || "an AI agent", kind: "move", status: "PENDING", createdAt: Date.now(), why: typeof input.why === "string" ? input.why.slice(0, 300) : undefined };
    if (kind === "move") {
      if (!MOVES.includes(String(input.action))) throw new ApiError(400, `action must be one of ${MOVES.join(", ")}`);
      const dealId = Number(input.dealId), index = Number(input.index ?? 0);
      if (!Number.isInteger(dealId) || dealId < 0 || !Number.isInteger(index) || index < 0 || index > 20) throw new ApiError(400, "dealId and index must be whole numbers");
      Object.assign(r, { kind: "move", dealId, action: String(input.action), index, reason: typeof input.reason === "string" ? input.reason.slice(0, 2000) : undefined });
    } else if (kind === "confirm_draft") {
      if (typeof input.draftId !== "string" || input.draftId.length > 40) throw new ApiError(400, "draftId is needed");
      Object.assign(r, { kind: "confirm_draft", draftId: input.draftId });
    } else if (kind === "payee") {
      if (typeof input.friendshipId !== "string" || input.friendshipId.length > 40 || typeof input.allowed !== "boolean") throw new ApiError(400, "friendshipId and allowed are needed");
      Object.assign(r, { kind: "payee", friendshipId: input.friendshipId, allowed: input.allowed });
    } else throw new ApiError(400, "Unknown request kind");
    const list = this.agentRequests();
    if (list.filter((x) => x.status === "PENDING").length >= 20) throw new ApiError(429, "20 requests already wait for the user: ask them to answer those first");
    list.push(r);
    this.saveAgentRequests(list);
    return r;
  }

  /** The user's answer to an agent's request: Sign runs it as a signed block, Reject drops it. */
  async decideAgentRequest(id: string, sign: boolean) {
    const list = this.agentRequests();
    const r = list.find((x) => x.id === id && x.status === "PENDING");
    if (!r) throw new ApiError(404, "That request is gone or already answered");
    if (!sign) {
      r.status = "REJECTED";
    } else {
      const out =
        r.kind === "move"
          ? await this.move({ dealId: r.dealId!, action: r.action as IntentBody["action"], index: r.index ?? 0, reason: r.reason })
          : r.kind === "confirm_draft"
            ? await this.confirmDraft(r.draftId!)
            : await this.payee(r.friendshipId!, r.allowed!);
      r.status = out.ok ? "SIGNED" : "FAILED";
      r.error = out.ok ? undefined : out.error;
      r.block = out.block;
    }
    r.answeredAt = Date.now();
    this.saveAgentRequests(list);
    return r;
  }

  /** An outside agent asks the wallet's own AI (its own history, kept apart from the user's chat). */
  async agentAsk(client: string, message: string, lang: "en" | "th" = "en") {
    const history: { role: "user" | "assistant"; text: string }[] = JSON.parse(store.getMeta("mcpChat") ?? "[]");
    const text = `[Sent by ${client.slice(0, 60)}, an outside AI agent the user connected. Draft what it asks like any request of the user; it cannot confirm or sign.]\n${message.slice(0, 4000)}`;
    const r = await this.call<{ reply: string; steps: unknown[] }>("POST", "/api/device/chat", {
      history: history.slice(-30),
      message: text,
      lang,
      byok: this.byok() ?? undefined,
    });
    store.setMeta("mcpChat", JSON.stringify([...history, { role: "user", text }, { role: "assistant", text: r.reply }].slice(-60)));
    return { reply: r.reply, previews: "Previews it made wait in the app (list_drafts); the user confirms them." };
  }

  // ----------------------------------------------------------------------------------------
  // AI settings: the user's own key (kept here, sealed) and instructions (kept on the server)
  // ----------------------------------------------------------------------------------------

  private byok(): { provider: "anthropic" | "openrouter"; apiKey: string; model: string } | null {
    const sealed = store.getMeta("byok");
    if (!sealed) return null;
    try {
      return JSON.parse(openLocal(this.need().key, sealed));
    } catch {
      return null;
    }
  }

  aiSettings() {
    const b = this.byok();
    return { own: b ? { provider: b.provider, model: b.model, key: `${b.apiKey.slice(0, 6)}…${b.apiKey.slice(-4)}` } : null };
  }

  setByok(input: { provider?: string; apiKey?: string; model?: string } | null) {
    const { key } = this.need();
    if (!input) {
      store.setMeta("byok", "");
      return this.aiSettings();
    }
    const provider = input.provider === "anthropic" ? "anthropic" : input.provider === "openrouter" ? "openrouter" : null;
    const apiKey = (input.apiKey ?? "").trim();
    const model = (input.model ?? "").trim();
    if (!provider) throw new ApiError(400, "Choose Anthropic or OpenRouter");
    if (apiKey.length < 20) throw new ApiError(400, "Paste the whole API key");
    if (!/^[\w.:/-]{2,120}$/.test(model)) throw new ApiError(400, "Enter a model name, e.g. claude-sonnet-5-5 or openai/gpt-5.5");
    store.setMeta("byok", sealLocal(key, JSON.stringify({ provider, apiKey, model })));
    return this.aiSettings();
  }

  instructions() {
    return this.call<{ aiInstructions: string }>("GET", "/api/device/preferences");
  }

  setInstructions(text: string) {
    return this.call<{ aiInstructions: string }>("POST", "/api/device/preferences", { aiInstructions: String(text ?? "").slice(0, 1000) });
  }

  async chat(input: { message: string; lang?: "en" | "th"; attachment?: unknown }) {
    const history = this.chatHistory();
    const asked = { role: "user" as const, text: input.message || "(document)", at: Date.now() };
    const r = await this.call<{ reply: string; steps: unknown[]; flags: unknown[]; model: string | null }>("POST", "/api/device/chat", {
      history: history.slice(-30).map(({ role, text }) => ({ role, text: text.slice(0, 8000) })),
      message: input.message,
      lang: input.lang ?? "en",
      attachment: input.attachment,
      byok: this.byok() ?? undefined,
    });
    const next = [...history, asked, { role: "assistant" as const, text: r.reply, at: Date.now(), steps: r.steps, model: r.model }].slice(-200);
    store.setMeta("chat", JSON.stringify(next));
    return { reply: r.reply, steps: r.steps, flags: r.flags };
  }

  clearChat() {
    store.setMeta("chat", "[]");
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
      agentRequests: this.vault && this.account ? this.agentRequests().filter((r) => r.status === "PENDING") : [],
      defaultServer: DEFAULT_SERVER,
      hostname: hostname(),
    };
  }
}

export const wallet = new Wallet();
