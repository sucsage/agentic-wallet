// Security tests (owner: @NawaratKhem). They record what the escrows do today when a deal is disputed.
// Tests named "KNOWN GAP" pass on the current code and document a risk from docs/security; when the
// contracts change (for example a dispute timeout) they must be updated on purpose.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { type Hex, keccak256, maxUint256, toHex, zeroHash } from "viem";

const usd = (n: number) => BigInt(Math.round(n * 1e6));
const REVIEW = 3n * 24n * 60n * 60n;
const YEAR = 365n * 24n * 60n * 60n;
const STATUS = { Pending: 0, Delivered: 1, Approved: 2, KeyReleased: 3, Released: 4, Disputed: 5, Refunded: 6, Split: 7 } as const;
const FILE_HASH = keccak256(toHex("final-logo.svg"));
const KEY: Hex = `0x${"ab".repeat(48)}`;
const file = (amount: number) => ({ amount: usd(amount), hasFile: true, workHash: zeroHash });

describe("Disputed funds: who can move them, and what happens when nobody rules", async function () {
  const { viem, networkHelpers } = await network.create();
  const [buyer, seller, arbiter, stranger] = await viem.getWalletClients();

  async function deploy() {
    const usdc = await viem.deployContract("MockUSDC");
    const fileEscrow = await viem.deployContract("FileEscrow", [0n]);
    const milestone = await viem.deployContract("MilestoneEscrow");
    await usdc.write.mint([buyer.account.address, usd(10_000)]);
    const asBuyerToken = await viem.getContractAt("MockUSDC", usdc.address, { client: { wallet: buyer } });
    await asBuyerToken.write.approve([fileEscrow.address, maxUint256]);
    await asBuyerToken.write.approve([milestone.address, maxUint256]);
    const f = (c: typeof buyer) => viem.getContractAt("FileEscrow", fileEscrow.address, { client: { wallet: c } });
    const m = (c: typeof buyer) => viem.getContractAt("MilestoneEscrow", milestone.address, { client: { wallet: c } });
    return {
      usdc, fileEscrow, milestone,
      fBuyer: await f(buyer), fSeller: await f(seller), fArbiter: await f(arbiter), fStranger: await f(stranger),
      mBuyer: await m(buyer), mSeller: await m(seller), mArbiter: await m(arbiter), mStranger: await m(stranger),
    };
  }

  /** One 1,000 file milestone, delivered and then disputed by the buyer. */
  async function disputedFileDeal() {
    const ctx = await networkHelpers.loadFixture(deploy);
    await ctx.fBuyer.write.offerToBuy([seller.account.address, arbiter.account.address, ctx.usdc.address, [file(1_000)], REVIEW, "terms"]);
    await ctx.fSeller.write.accept([0n]);
    await ctx.fSeller.write.deliver([0n, 0n, FILE_HASH, "ipfs://file"]);
    await ctx.fBuyer.write.dispute([0n, 0n]);
    assert.equal((await ctx.fileEscrow.read.getMilestone([0n, 0n])).status, STATUS.Disputed);
    return ctx;
  }

  describe("FileEscrow", () => {
    it("while Disputed, only the arbiter's resolve or the seller's refund can move the money", async () => {
      const c = await disputedFileDeal();
      // Nothing else is callable, by anyone, even after the review window has passed.
      await networkHelpers.time.increase(REVIEW + 1n);
      for (const attempt of [
        () => c.fBuyer.write.approve([0n, 0n]),
        () => c.fBuyer.write.reclaim([0n, 0n]),
        () => c.fBuyer.write.dispute([0n, 0n]),
        () => c.fSeller.write.claim([0n, 0n]),
        () => c.fSeller.write.releaseKey([0n, 0n, KEY]),
        () => c.fSeller.write.deliver([0n, 0n, FILE_HASH, "ipfs://again"]),
        () => c.fStranger.write.resolve([0n, 0n, true]),
        () => c.fBuyer.write.resolve([0n, 0n, false]),
        () => c.fSeller.write.resolve([0n, 0n, true]),
        () => c.fStranger.write.refund([0n, 0n]),
      ]) {
        await assert.rejects(attempt());
      }
      assert.equal(await c.usdc.read.balanceOf([c.fileEscrow.address]), usd(1_000));
    });

    it("the arbiter can award either side, once", async () => {
      const c = await disputedFileDeal();
      await c.fArbiter.write.resolve([0n, 0n, true]);
      assert.equal(await c.usdc.read.balanceOf([seller.account.address]), usd(1_000));
      assert.equal(await c.usdc.read.balanceOf([c.fileEscrow.address]), 0n);
      await assert.rejects(c.fArbiter.write.resolve([0n, 0n, false]));
    });

    it("DC-M-01 fixed: a silent arbiter cannot lock the money for ever (timeoutResolve after 7 days)", async () => {
      const c = await disputedFileDeal();
      await networkHelpers.time.increase(YEAR);
      assert.equal((await c.fileEscrow.read.getMilestone([0n, 0n])).status, STATUS.Disputed);
      await c.fStranger.write.timeoutResolve([0n, 0n]);
      assert.equal((await c.fileEscrow.read.getMilestone([0n, 0n])).status, STATUS.Refunded);
      assert.equal(await c.usdc.read.balanceOf([c.fileEscrow.address]), 0n);
      assert.equal(await c.usdc.read.balanceOf([buyer.account.address]), usd(10_000));
    });

    it("KNOWN GAP (DC-L-01): the seller's refund pre-empts the arbiter, who can then no longer rule", async () => {
      const c = await disputedFileDeal();
      await c.fSeller.write.refund([0n, 0n]);
      assert.equal(await c.usdc.read.balanceOf([buyer.account.address]), usd(10_000));
      await assert.rejects(c.fArbiter.write.resolve([0n, 0n, true]));
    });

    it("DC-H-02 fixed: a settled milestone, split or otherwise, cannot be refunded again", async () => {
      const c = await disputedFileDeal(); // deal 0, 1,000
      // A second, unrelated deal keeps 1,500 of someone else's money in the same escrow.
      await c.fBuyer.write.offerToBuy([stranger.account.address, arbiter.account.address, c.usdc.address, [file(1_500)], REVIEW, "other"]);
      assert.equal(await c.usdc.read.balanceOf([c.fileEscrow.address]), usd(2_500));
      await c.fArbiter.write.resolveSplit([0n, 0n, 3_000]); // seller 300, buyer 700, deal 0 is settled
      assert.equal(await c.usdc.read.balanceOf([c.fileEscrow.address]), usd(1_500));
      await viem.assertions.revertWithCustomErrorWithArgs(c.fSeller.write.refund([0n, 0n]), c.fileEscrow, "WrongStatus", [STATUS.Split]);
      assert.equal((await c.fileEscrow.read.getMilestone([0n, 0n])).status, STATUS.Split);
      assert.equal(await c.usdc.read.balanceOf([c.fileEscrow.address]), usd(1_500)); // the other deal's money is untouched
    });

    it("a stranger cannot call refund on someone else's disputed deal", async () => {
      const c = await disputedFileDeal();
      await assert.rejects(c.fStranger.write.refund([0n, 0n]));
      await assert.rejects(c.fBuyer.write.refund([0n, 0n]));
    });
  });

  describe("FileEscrow: approving after the key is out (DC-H-01 at contract level)", () => {
    async function keyReleasedDeal() {
      const c = await networkHelpers.loadFixture(deploy);
      await c.fBuyer.write.offerToBuy([seller.account.address, arbiter.account.address, c.usdc.address, [file(1_000)], REVIEW, "terms"]);
      await c.fSeller.write.accept([0n]);
      await c.fSeller.write.deliver([0n, 0n, FILE_HASH, "ipfs://file"]);
      await c.fBuyer.write.approve([0n, 0n]);
      // Any nonempty bytes pass: the contract cannot tell whether the key opens the file.
      await c.fSeller.write.releaseKey([0n, 0n, KEY]);
      assert.equal((await c.fileEscrow.read.getMilestone([0n, 0n])).status, STATUS.KeyReleased);
      return c;
    }

    it("the buyer's second approve pays the seller at once, without waiting out the challenge window", async () => {
      const c = await keyReleasedDeal();
      await c.fBuyer.write.approve([0n, 0n]);
      assert.equal((await c.fileEscrow.read.getMilestone([0n, 0n])).status, STATUS.Released);
      assert.equal(await c.usdc.read.balanceOf([seller.account.address]), usd(1_000));
    });

    it("only the buyer's address can do it; the seller and strangers cannot", async () => {
      const c = await keyReleasedDeal();
      await assert.rejects(c.fSeller.write.approve([0n, 0n]));
      await assert.rejects(c.fStranger.write.approve([0n, 0n]));
    });

    it("KNOWN GAP: a key that does not open the file is not detected on chain (the buyer must dispute)", async () => {
      const c = await keyReleasedDeal();
      await c.fBuyer.write.dispute([0n, 0n]);
      assert.equal((await c.fileEscrow.read.getMilestone([0n, 0n])).status, STATUS.Disputed);
    });
  });

  describe("MilestoneEscrow", () => {
    async function disputedDeal() {
      const c = await networkHelpers.loadFixture(deploy);
      await c.mBuyer.write.createDeal([seller.account.address, arbiter.account.address, c.usdc.address, [usd(1_000)], "terms"]);
      await c.mBuyer.write.fund([0n]);
      await c.mBuyer.write.dispute([0n, 0n]);
      return c;
    }

    it("while Disputed, release and refund are closed to both parties", async () => {
      const c = await disputedDeal();
      await assert.rejects(c.mBuyer.write.release([0n, 0n]));
      await assert.rejects(c.mSeller.write.refund([0n, 0n]));
      await assert.rejects(c.mStranger.write.resolve([0n, 0n, true]));
      assert.equal(await c.usdc.read.balanceOf([c.milestone.address]), usd(1_000));
    });

    it("KNOWN GAP (DC-M-01, legacy MilestoneEscrow only): with a silent arbiter the money is locked permanently and no party has an exit", async () => {
      const c = await disputedDeal();
      await networkHelpers.time.increase(YEAR);
      await assert.rejects(c.mBuyer.write.release([0n, 0n]));
      await assert.rejects(c.mSeller.write.refund([0n, 0n]));
      await assert.rejects(c.mBuyer.write.dispute([0n, 0n]));
      assert.equal(await c.usdc.read.balanceOf([c.milestone.address]), usd(1_000));
    });

    it("the arbiter can award either side, once", async () => {
      const c = await disputedDeal();
      await c.mArbiter.write.resolve([0n, 0n, false]);
      assert.equal(await c.usdc.read.balanceOf([buyer.account.address]), usd(10_000));
      await assert.rejects(c.mArbiter.write.resolve([0n, 0n, true]));
    });
  });
});
