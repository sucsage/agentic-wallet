// Security tests for the device-chain format shared with the server (web/src/lib/device-chain/format.ts).
import { describe, expect, test } from "bun:test";
import { keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  type Block,
  type DealEventBody,
  FORMAT_VERSION,
  type SignedBlock,
  ZERO_HASH,
  blockHash,
  canonical,
  eventId,
  eventMessage,
  headLeaf,
  merkleProof,
  merkleRoot,
  requestMessage,
  verifyBlocks,
  verifyProof,
} from "../../web/src/lib/device-chain/format";

const device = privateKeyToAccount(generatePrivateKey());
const server = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

async function sign(b: Block, who = device): Promise<SignedBlock> {
  const hash = blockHash(b);
  return { ...b, hash, sig: await who.signMessage({ message: { raw: hash } }) };
}
const base = (height: number, prev: string) => ({ v: FORMAT_VERSION, owner: device.address, height, prev: prev as `0x${string}`, time: 1_800_000_000_000 + height });

async function event(status: string, signer = server) {
  const e: Omit<DealEventBody, "id"> = { dealId: 7, type: "milestone", index: 0, status, data: { amount: "300" }, parties: ["0xaa", "0xbb"] };
  const id = eventId(e);
  return { event: { id, ...e }, serverSig: await signer.signMessage({ message: eventMessage(id) }) };
}

async function chain(): Promise<SignedBlock[]> {
  const g = await sign({ ...base(0, ZERO_HASH), kind: "genesis", body: { wallet: "0x00000000000000000000000000000000000000aa", server: server.address, linkedAt: 1 } });
  const e1 = await sign({ ...base(1, g.hash), kind: "event", body: await event("Delivered") });
  const i2 = await sign({ ...base(2, e1.hash), kind: "intent", body: { dealId: 7, action: "approve", index: 0 } });
  const e3 = await sign({ ...base(3, i2.hash), kind: "event", body: await event("Released") });
  return [g, e1, i2, e3];
}
const opts = { owner: device.address, server: server.address };

describe("device chain verification", () => {
  test("an honest chain verifies", async () => {
    const r = await verifyBlocks(await chain(), opts);
    expect(r.ok).toBe(true);
  });

  test("changing any field of an old block is caught (hash mismatch)", async () => {
    const c = await chain();
    c[1] = { ...c[1], body: { ...c[1].body, event: { ...(c[1].body as { event: DealEventBody }).event, data: { amount: "999999" } } } } as SignedBlock;
    const r = await verifyBlocks(c, opts);
    expect(r.ok).toBe(false);
  });

  test("recomputing the hash after an edit still fails: the device signature no longer matches", async () => {
    const c = await chain();
    const edited = { ...c[2], body: { dealId: 7, action: "dispute", index: 0, reason: "changed later" } } as SignedBlock;
    edited.hash = blockHash(edited);
    c[2] = edited;
    const r = await verifyBlocks(c, opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("not signed by this device");
  });

  test("a block signed by another key is refused", async () => {
    const c = await chain();
    c.push(await sign({ ...base(4, c[3].hash), kind: "intent", body: { dealId: 7, action: "refund", index: 0 } }, stranger));
    expect((await verifyBlocks(c, opts)).ok).toBe(false);
  });

  test("a block that skips a height or links to the wrong block is refused (no forks, no gaps)", async () => {
    const c = await chain();
    const gap = await sign({ ...base(5, c[3].hash), kind: "intent", body: { dealId: 7, action: "approve", index: 1 } });
    expect((await verifyBlocks([...c, gap], opts)).ok).toBe(false);
    const fork = await sign({ ...base(4, c[1].hash), kind: "intent", body: { dealId: 7, action: "approve", index: 1 } });
    expect((await verifyBlocks([...c, fork], opts)).ok).toBe(false);
  });

  test("a deal event not signed by the server is refused", async () => {
    const c = await chain();
    c.push(await sign({ ...base(4, c[3].hash), kind: "event", body: await event("Refunded", stranger) }));
    const r = await verifyBlocks(c, opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("not signed by the server");
  });

  test("a deal event whose content does not match its id is refused", async () => {
    const c = await chain();
    const ev = await event("Released");
    ev.event.status = "Refunded"; // id still says Released
    c.push(await sign({ ...base(4, c[3].hash), kind: "event", body: ev }));
    expect((await verifyBlocks(c, opts)).ok).toBe(false);
  });

  test("only block 0 may be a genesis", async () => {
    const c = await chain();
    c.push(await sign({ ...base(4, c[3].hash), kind: "genesis", body: { wallet: "0x00000000000000000000000000000000000000bb", server: server.address, linkedAt: 2 } }));
    expect((await verifyBlocks(c, opts)).ok).toBe(false);
  });

  test("continuing from a countersigned head: only blocks that extend it", async () => {
    const c = await chain();
    const from = { height: 1, hash: c[1].hash };
    expect((await verifyBlocks(c.slice(2), { ...opts, from })).ok).toBe(true);
    expect((await verifyBlocks(c.slice(3), { ...opts, from })).ok).toBe(false);
  });
});

describe("canonical form and request signatures", () => {
  test("key order does not change the hash", () => {
    expect(canonical({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(canonical({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }));
  });
  test("a string body and its bytes sign the same message", () => {
    const body = '{"x":"ไทย"}';
    expect(requestMessage("POST", "/p", 1, body)).toBe(requestMessage("POST", "/p", 1, new TextEncoder().encode(body)));
  });
  test("method, path, time and body are all covered", () => {
    const m = requestMessage("POST", "/api/device/blocks", 1, "{}");
    expect(requestMessage("GET", "/api/device/blocks", 1, "{}")).not.toBe(m);
    expect(requestMessage("POST", "/api/device/deliver", 1, "{}")).not.toBe(m);
    expect(requestMessage("POST", "/api/device/blocks", 2, "{}")).not.toBe(m);
    expect(requestMessage("POST", "/api/device/blocks", 1, "{ }")).not.toBe(m);
  });
});

describe("public anchor (Merkle proofs)", () => {
  const heads = Array.from({ length: 7 }, (_, i) => ({ address: privateKeyToAccount(generatePrivateKey()).address, height: i, hash: keccak256(toHex(`head ${i}`)) }));
  const leaves = heads.map(headLeaf);
  const root = merkleRoot(leaves);
  test("every head proves its place in the root", () => {
    for (const h of heads) expect(verifyProof(headLeaf(h), merkleProof(leaves, headLeaf(h))!, root)).toBe(true);
  });
  test("a swapped head does not verify against the anchored root", () => {
    const fake = { ...heads[3], hash: keccak256(toHex("rewritten")) };
    expect(verifyProof(headLeaf(fake), merkleProof(leaves, headLeaf(heads[3]))!, root)).toBe(false);
    expect(merkleProof(leaves, headLeaf(fake))).toBeNull();
  });
});
