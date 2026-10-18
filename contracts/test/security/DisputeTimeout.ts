// Security tests (owner: @NawaratKhem) for the dispute timeout in FileEscrow (DC-M-01).
// A milestone that stays Disputed for ARBITER_WINDOW (7 days) can be returned to the buyer by anyone.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { keccak256, maxUint256, toHex, zeroHash } from "viem";

const usd = (n: number) => BigInt(Math.round(n * 1e6));
const DAY = 24n * 60n * 60n;
const REVIEW = 3n * DAY;
const WINDOW = 7n * DAY;
const STATUS = { Pending: 0, Delivered: 1, Approved: 2, KeyReleased: 3, Released: 4, Disputed: 5, Refunded: 6, Split: 7 } as const;
const FILE_HASH = keccak256(toHex("final-logo.svg"));
const file = (amount: number) => ({ amount: usd(amount), hasFile: true, workHash: zeroHash });

describe("FileEscrow dispute timeout (DC-M-01)", async function () {
  const { viem, networkHelpers } = await network.create();
  const [buyer, seller, arbiter, stranger] = await viem.getWalletClients();

  async function deploy() {
    const usdc = await viem.deployContract("MockUSDC");
    const escrow = await viem.deployContract("FileEscrow", [0n]);
    await usdc.write.mint([buyer.account.address, usd(10_000)]);
    const asBuyerToken = await viem.getContractAt("MockUSDC", usdc.address, { client: { wallet: buyer } });
    await asBuyerToken.write.approve([escrow.address, maxUint256]);
    const f = (c: typeof buyer) => viem.getContractAt("FileEscrow", escrow.address, { client: { wallet: c } });
    return { usdc, escrow, fBuyer: await f(buyer), fSeller: await f(seller), fArbiter: await f(arbiter), fStranger: await f(stranger) };
  }

  /** Two 1,000 milestones delivered; the buyer disputes the first one only. */
  async function disputed() {
    const c = await networkHelpers.loadFixture(deploy);
    await c.fBuyer.write.offerToBuy([seller.account.address, arbiter.account.address, c.usdc.address, [file(1_000), file(1_000)], REVIEW, "terms"]);
    await c.fSeller.write.accept([0n]);
    await c.fSeller.write.deliver([0n, 0n, FILE_HASH, "ipfs://a"]);
    await c.fSeller.write.deliver([0n, 1n, FILE_HASH, "ipfs://b"]);
    await c.fBuyer.write.dispute([0n, 0n]);
    return c;
  }
  const status = async (c: Awaited<ReturnType<typeof disputed>>, i = 0n) => (await c.escrow.read.getMilestone([0n, i])).status;

  it("records when the dispute was opened", async () => {
    const c = await disputed();
    assert.ok((await c.escrow.read.disputedAt([0n, 0n])) > 0n);
    assert.equal(await c.escrow.read.disputedAt([0n, 1n]), 0n, "the undisputed milestone has no timestamp");
    assert.equal(await c.escrow.read.ARBITER_WINDOW(), WINDOW);
  });

  it("cannot be called inside the window, by anyone", async () => {
    const c = await disputed();
    for (const who of [c.fStranger, c.fBuyer, c.fSeller, c.fArbiter]) await assert.rejects(who.write.timeoutResolve([0n, 0n]));
    await networkHelpers.time.increase(WINDOW - 60n);
    await assert.rejects(c.fStranger.write.timeoutResolve([0n, 0n]));
    assert.equal(await status(c), STATUS.Disputed);
  });

  it("after the window anyone can return the money to the buyer, once", async () => {
    const c = await disputed();
    await networkHelpers.time.increase(WINDOW + 1n);
    await c.fStranger.write.timeoutResolve([0n, 0n]);
    assert.equal(await status(c), STATUS.Refunded);
    assert.equal(await c.usdc.read.balanceOf([buyer.account.address]), usd(10_000 - 2_000 + 1_000), "the buyer got milestone 0 back");
    assert.equal(await c.usdc.read.balanceOf([seller.account.address]), 0n);
    assert.equal(await c.usdc.read.balanceOf([c.escrow.address]), usd(1_000), "milestone 1 is untouched");
    await assert.rejects(c.fStranger.write.timeoutResolve([0n, 0n]), "a second call must revert");
    assert.equal(await status(c, 1n), STATUS.Delivered);
  });

  it("the arbiter can still rule inside the window, and then the timeout cannot fire", async () => {
    const c = await disputed();
    await networkHelpers.time.increase(WINDOW - 3_600n);
    await c.fArbiter.write.resolve([0n, 0n, true]);
    await networkHelpers.time.increase(WINDOW);
    await assert.rejects(c.fStranger.write.timeoutResolve([0n, 0n]));
    assert.equal(await c.usdc.read.balanceOf([seller.account.address]), usd(1_000));
  });

  it("a split ruling is final: the timeout cannot pay the buyer again (the DC-H-02 class)", async () => {
    const c = await disputed();
    await c.fArbiter.write.resolveSplit([0n, 0n, 6_000]);
    assert.equal(await status(c), STATUS.Split);
    await networkHelpers.time.increase(WINDOW * 2n);
    await assert.rejects(c.fStranger.write.timeoutResolve([0n, 0n]));
    await assert.rejects(c.fSeller.write.refund([0n, 0n]));
    assert.equal(await c.usdc.read.balanceOf([c.escrow.address]), usd(1_000), "only milestone 1 is still held");
  });

  it("does not apply to a milestone that was never disputed", async () => {
    const c = await disputed();
    await networkHelpers.time.increase(WINDOW * 3n);
    await assert.rejects(c.fStranger.write.timeoutResolve([0n, 1n]));
    await assert.rejects(c.fStranger.write.timeoutResolve([0n, 5n]), "an unknown milestone");
    await assert.rejects(c.fStranger.write.timeoutResolve([9n, 0n]), "an unknown deal");
  });

  it("the seller's own refund and the timeout never both pay: the escrow stays solvent", async () => {
    const c = await disputed();
    await c.fSeller.write.refund([0n, 0n]);
    await networkHelpers.time.increase(WINDOW + 1n);
    await assert.rejects(c.fStranger.write.timeoutResolve([0n, 0n]));
    assert.equal(await c.usdc.read.balanceOf([c.escrow.address]), usd(1_000));
  });
  it("every settled status refuses it: Released, Refunded and Split", async () => {
    const c = await networkHelpers.loadFixture(deploy);
    await c.fBuyer.write.offerToBuy([seller.account.address, arbiter.account.address, c.usdc.address, [file(1_000), file(1_000), file(1_000)], REVIEW, "terms"]);
    await c.fSeller.write.accept([0n]);
    for (const i of [0n, 1n, 2n]) await c.fSeller.write.deliver([0n, i, FILE_HASH, "ipfs://x"]);
    for (const i of [0n, 1n, 2n]) await c.fBuyer.write.dispute([0n, i]);
    await c.fArbiter.write.resolve([0n, 0n, true]); // Released
    await c.fArbiter.write.resolve([0n, 1n, false]); // Refunded
    await c.fArbiter.write.resolveSplit([0n, 2n, 4_000]); // Split
    await networkHelpers.time.increase(WINDOW * 4n);
    const held = await c.usdc.read.balanceOf([c.escrow.address]);
    for (const i of [0n, 1n, 2n]) await assert.rejects(c.fStranger.write.timeoutResolve([0n, i]), `milestone ${i}`);
    assert.equal(await c.usdc.read.balanceOf([c.escrow.address]), held, "no token moved");
    assert.equal(held, 0n, "everything was paid out exactly once");
  });
});
