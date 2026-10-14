import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { type Hex, keccak256, maxUint256, toHex, zeroHash } from "viem";

const usd = (n: number) => BigInt(Math.round(n * 1e6));
const REVIEW = 3n * 24n * 60n * 60n; // 3 days, agreed in every offer below
const DEAL = { Proposed: 0, Active: 1, Cancelled: 2 } as const;
const STATUS = { Pending: 0, Delivered: 1, Approved: 2, KeyReleased: 3, Released: 4, Disputed: 5, Refunded: 6 } as const;

const FILE_HASH = keccak256(toHex("final-logo.svg"));
const OTHER_HASH = keccak256(toHex("something-else.svg"));
const ENCRYPTED_KEY: Hex = `0x${"ab".repeat(48)}`;
const DELIVERY = "ipfs://encrypted-file-and-preview";

const file = (amount: number, workHash: Hex = zeroHash) => ({ amount: usd(amount), hasFile: true, workHash });
const noFile = (amount: number) => ({ amount: usd(amount), hasFile: false, workHash: zeroHash });

describe("FileEscrow", async function () {
  const { viem, networkHelpers } = await network.create();
  const [buyer, seller, arbiter, stranger] = await viem.getWalletClients();
  const waitOutWindow = () => networkHelpers.time.increase(REVIEW + 1n);

  async function deploy() {
    const usdc = await viem.deployContract("MockUSDC");
    const escrow = await viem.deployContract("FileEscrow");
    await usdc.write.mint([buyer.account.address, usd(10_000)]);
    const usdcAsBuyer = await viem.getContractAt("MockUSDC", usdc.address, { client: { wallet: buyer } });
    await usdcAsBuyer.write.approve([escrow.address, maxUint256]);

    const as = (client: typeof buyer) => viem.getContractAt("FileEscrow", escrow.address, { client: { wallet: client } });
    return {
      usdc,
      escrow,
      asBuyer: await as(buyer),
      asSeller: await as(seller),
      asArbiter: await as(arbiter),
      asStranger: await as(stranger),
    };
  }

  /** A buyer's offer for one 1,000 file milestone, already accepted by the seller. */
  async function activeFileDeal() {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { usdc, asBuyer, asSeller } = ctx;
    await asBuyer.write.offerToBuy([seller.account.address, arbiter.account.address, usdc.address, [file(1_000)], REVIEW, "terms"]);
    await asSeller.write.accept([0n]);
    return ctx;
  }

  const balance = (ctx: Awaited<ReturnType<typeof deploy>>, who: { account: { address: Hex } }) =>
    ctx.usdc.read.balanceOf([who.account.address]);

  describe("Offers: either side can make one", () => {
    it("a buyer's offer locks the payment up front, then the seller accepts", async () => {
      const ctx = await networkHelpers.loadFixture(deploy);
      const { usdc, escrow, asBuyer, asSeller } = ctx;
      await asBuyer.write.offerToBuy([seller.account.address, arbiter.account.address, usdc.address, [file(1_000)], REVIEW, "terms"]);
      assert.equal(await usdc.read.balanceOf([escrow.address]), usd(1_000));
      assert.equal((await escrow.read.getDeal([0n])).status, DEAL.Proposed);

      await asSeller.write.accept([0n]);
      assert.equal((await escrow.read.getDeal([0n])).status, DEAL.Active);
    });

    it("a seller's offer locks nothing until the buyer accepts", async () => {
      const ctx = await networkHelpers.loadFixture(deploy);
      const { usdc, escrow, asBuyer, asSeller } = ctx;
      await asSeller.write.offerToSell([buyer.account.address, arbiter.account.address, usdc.address, [file(1_000, FILE_HASH)], REVIEW, "terms"]);
      assert.equal(await usdc.read.balanceOf([escrow.address]), 0n);

      await asBuyer.write.accept([0n]);
      assert.equal(await usdc.read.balanceOf([escrow.address]), usd(1_000));
    });

    it("only the counterparty accepts; the creator can cancel and get the money back", async () => {
      const ctx = await networkHelpers.loadFixture(deploy);
      const { usdc, escrow, asBuyer, asSeller, asStranger } = ctx;
      await asBuyer.write.offerToBuy([seller.account.address, arbiter.account.address, usdc.address, [file(1_000)], REVIEW, "terms"]);

      await viem.assertions.revertWithCustomError(asBuyer.write.accept([0n]), escrow, "NotAllowed");
      await viem.assertions.revertWithCustomError(asStranger.write.accept([0n]), escrow, "NotAllowed");
      await viem.assertions.revertWithCustomError(asSeller.write.cancel([0n]), escrow, "NotAllowed");

      await asBuyer.write.cancel([0n]);
      assert.equal(await balance(ctx, buyer), usd(10_000));
      await viem.assertions.revertWithCustomErrorWithArgs(asSeller.write.accept([0n]), escrow, "WrongDealStatus", [DEAL.Cancelled]);
    });

    it("rejects unfair or malformed offers", async () => {
      const { usdc, escrow, asBuyer } = await networkHelpers.loadFixture(deploy);
      const offer = (judge: Hex, terms: ReturnType<typeof file>[], review = REVIEW) =>
        asBuyer.write.offerToBuy([seller.account.address, judge, usdc.address, terms, review, "terms"]);

      // The arbiter must be neither party.
      await viem.assertions.revertWithCustomError(offer(buyer.account.address, [file(1)]), escrow, "ArbiterNotNeutral");
      await viem.assertions.revertWithCustomError(offer(seller.account.address, [file(1)]), escrow, "ArbiterNotNeutral");
      // Only a seller can commit to a file it already has.
      await viem.assertions.revertWithCustomError(offer(arbiter.account.address, [file(1, FILE_HASH)]), escrow, "InvalidOffer");
      // No zero amounts, no windows too short to react in.
      await viem.assertions.revertWithCustomError(offer(arbiter.account.address, [file(0)]), escrow, "InvalidOffer");
      await viem.assertions.revertWithCustomError(offer(arbiter.account.address, [file(1)], 60n), escrow, "InvalidOffer");
    });
  });

  describe("File exchange: approve first, then key for payment", () => {
    it("the buyer gets the key only after approving; the seller is paid after the challenge window", async () => {
      const ctx = await activeFileDeal();
      const { escrow, asBuyer, asSeller } = ctx;
      await asSeller.write.deliver([0n, 0n, FILE_HASH, DELIVERY]);

      // The buyer is still judging the preview: the key cannot be handed over yet.
      await viem.assertions.revertWithCustomError(asSeller.write.releaseKey([0n, 0n, ENCRYPTED_KEY]), escrow, "WindowOpen");

      await asBuyer.write.approve([0n, 0n]);
      await asSeller.write.releaseKey([0n, 0n, ENCRYPTED_KEY]);
      const m = await escrow.read.getMilestone([0n, 0n]);
      assert.equal(m.status, STATUS.KeyReleased);
      assert.equal(m.encryptedKey, ENCRYPTED_KEY);

      // The buyer can still report a bad key, so the payment waits for the window.
      await viem.assertions.revertWithCustomError(asSeller.write.claim([0n, 0n]), escrow, "WindowOpen");
      await waitOutWindow();
      await asSeller.write.claim([0n, 0n]);
      assert.equal(await balance(ctx, seller), usd(1_000));
      assert.equal((await escrow.read.getMilestone([0n, 0n])).status, STATUS.Released);
    });

    it("a buyer who confirms the key pays the seller at once", async () => {
      const ctx = await activeFileDeal();
      const { escrow, asBuyer, asSeller } = ctx;
      await asSeller.write.deliver([0n, 0n, FILE_HASH, DELIVERY]);
      await asBuyer.write.approve([0n, 0n]);
      // Approving twice before the key is out does nothing new: the seller still owes the key.
      await viem.assertions.revertWithCustomErrorWithArgs(asBuyer.write.approve([0n, 0n]), escrow, "WrongStatus", [STATUS.Approved]);
      await asSeller.write.releaseKey([0n, 0n, ENCRYPTED_KEY]);

      await viem.assertions.revertWithCustomError(asSeller.write.approve([0n, 0n]), escrow, "NotAllowed");
      await asBuyer.write.approve([0n, 0n]);
      assert.equal(await balance(ctx, seller), usd(1_000));
      assert.equal((await escrow.read.getMilestone([0n, 0n])).status, STATUS.Released);
    });

    it("a ready-made file must match the hash committed in the seller's offer", async () => {
      const { usdc, escrow, asBuyer, asSeller } = await networkHelpers.loadFixture(deploy);
      await asSeller.write.offerToSell([buyer.account.address, arbiter.account.address, usdc.address, [file(1_000, FILE_HASH)], REVIEW, "terms"]);
      await asBuyer.write.accept([0n]);

      await viem.assertions.revertWithCustomError(asSeller.write.deliver([0n, 0n, OTHER_HASH, DELIVERY]), escrow, "WorkMismatch");
      await asSeller.write.deliver([0n, 0n, FILE_HASH, DELIVERY]);
    });

    it("only the seller delivers and only the buyer approves", async () => {
      const { escrow, asBuyer, asSeller, asStranger } = await activeFileDeal();
      await viem.assertions.revertWithCustomError(asBuyer.write.deliver([0n, 0n, FILE_HASH, DELIVERY]), escrow, "NotAllowed");
      await asSeller.write.deliver([0n, 0n, FILE_HASH, DELIVERY]);
      await viem.assertions.revertWithCustomError(asSeller.write.approve([0n, 0n]), escrow, "NotAllowed");
      await viem.assertions.revertWithCustomError(asStranger.write.approve([0n, 0n]), escrow, "NotAllowed");
    });
  });

  describe("Timeouts: neither side can stall the other", () => {
    it("a silent buyer cannot hold the seller hostage", async () => {
      const ctx = await activeFileDeal();
      const { asSeller } = ctx;
      await asSeller.write.deliver([0n, 0n, FILE_HASH, DELIVERY]);
      await waitOutWindow(); // buyer never answers

      await asSeller.write.releaseKey([0n, 0n, ENCRYPTED_KEY]);
      await waitOutWindow();
      await asSeller.write.claim([0n, 0n]);
      assert.equal(await balance(ctx, seller), usd(1_000));
    });

    it("a seller who withholds the key after approval loses the payment", async () => {
      const ctx = await activeFileDeal();
      const { escrow, asBuyer, asSeller } = ctx;
      await asSeller.write.deliver([0n, 0n, FILE_HASH, DELIVERY]);
      await asBuyer.write.approve([0n, 0n]);

      await viem.assertions.revertWithCustomError(asBuyer.write.reclaim([0n, 0n]), escrow, "WindowOpen");
      await waitOutWindow(); // seller never sends the key
      await viem.assertions.revertWithCustomError(asSeller.write.releaseKey([0n, 0n, ENCRYPTED_KEY]), escrow, "WindowClosed");

      await asBuyer.write.reclaim([0n, 0n]);
      assert.equal(await balance(ctx, buyer), usd(10_000));
      assert.equal((await escrow.read.getMilestone([0n, 0n])).status, STATUS.Refunded);
    });

    it("a no-file milestone is paid on approval, or after the buyer's silence", async () => {
      const ctx = await networkHelpers.loadFixture(deploy);
      const { usdc, escrow, asBuyer, asSeller } = ctx;
      await asBuyer.write.offerToBuy([seller.account.address, arbiter.account.address, usdc.address, [noFile(300), noFile(200)], REVIEW, "terms"]);
      await asSeller.write.accept([0n]);

      await asSeller.write.deliver([0n, 0n, keccak256(toHex("draft approved by email")), "ipfs://evidence"]);
      await asBuyer.write.approve([0n, 0n]);
      assert.equal(await balance(ctx, seller), usd(300));

      await asSeller.write.deliver([0n, 1n, keccak256(toHex("final report")), "ipfs://evidence-2"]);
      await viem.assertions.revertWithCustomError(asSeller.write.claim([0n, 1n]), escrow, "WindowOpen");
      await waitOutWindow();
      await asSeller.write.claim([0n, 1n]);
      assert.equal(await balance(ctx, seller), usd(500));
      await viem.assertions.revertWithCustomError(asSeller.write.releaseKey([0n, 1n, ENCRYPTED_KEY]), escrow, "NoFile");
    });
  });

  describe("Disputes: a neutral arbiter decides", () => {
    it("the buyer can object to the work during review; the arbiter refunds", async () => {
      const ctx = await activeFileDeal();
      const { escrow, asBuyer, asSeller, asArbiter } = ctx;
      await asSeller.write.deliver([0n, 0n, FILE_HASH, DELIVERY]);
      await asBuyer.write.dispute([0n, 0n]);

      await viem.assertions.revertWithCustomError(asSeller.write.resolve([0n, 0n, true]), escrow, "NotAllowed");
      await viem.assertions.revertWithCustomError(asBuyer.write.resolve([0n, 0n, false]), escrow, "NotAllowed");
      await asArbiter.write.resolve([0n, 0n, false]);
      assert.equal(await balance(ctx, buyer), usd(10_000));
    });

    it("the buyer can challenge the key; the arbiter pays the seller if it was fine", async () => {
      const ctx = await activeFileDeal();
      const { asBuyer, asSeller, asArbiter } = ctx;
      await asSeller.write.deliver([0n, 0n, FILE_HASH, DELIVERY]);
      await asBuyer.write.approve([0n, 0n]);
      await asSeller.write.releaseKey([0n, 0n, ENCRYPTED_KEY]);
      await asBuyer.write.dispute([0n, 0n]);

      await asArbiter.write.resolve([0n, 0n, true]);
      assert.equal(await balance(ctx, seller), usd(1_000));
    });

    it("objections close with the window", async () => {
      const { escrow, asBuyer, asSeller } = await activeFileDeal();
      await asSeller.write.deliver([0n, 0n, FILE_HASH, DELIVERY]);
      await waitOutWindow();
      await viem.assertions.revertWithCustomError(asBuyer.write.dispute([0n, 0n]), escrow, "WindowClosed");
    });
  });

  it("the seller can give a milestone's money back any time before it settles", async () => {
    const ctx = await activeFileDeal();
    const { escrow, asSeller } = ctx;
    await asSeller.write.deliver([0n, 0n, FILE_HASH, DELIVERY]);
    await asSeller.write.refund([0n, 0n]);
    assert.equal(await balance(ctx, buyer), usd(10_000));
    await viem.assertions.revertWithCustomErrorWithArgs(asSeller.write.refund([0n, 0n]), escrow, "WrongStatus", [STATUS.Refunded]);
  });

  it("lists each deal under both parties", async () => {
    const { usdc, escrow, asBuyer, asSeller } = await networkHelpers.loadFixture(deploy);
    await asBuyer.write.offerToBuy([seller.account.address, arbiter.account.address, usdc.address, [file(1)], REVIEW, "a"]);
    await asSeller.write.offerToSell([buyer.account.address, arbiter.account.address, usdc.address, [file(1)], REVIEW, "b"]);
    assert.deepEqual(await escrow.read.dealsOf([buyer.account.address]), [0n, 1n]);
    assert.deepEqual(await escrow.read.dealsOf([seller.account.address]), [0n, 1n]);
  });
});
