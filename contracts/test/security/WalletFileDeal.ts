// Security tests (owner: @NawaratKhem) at wallet level: the AI agent's file approvals, and the arbiter rule.
// Tests named "KNOWN GAP" pass on the current code and record a finding from docs/security; they must be
// updated on purpose when the contracts change.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { encodeFunctionData, keccak256, toHex, zeroHash } from "viem";

const usd = (n: number) => BigInt(Math.round(n * 1e6));
const DAY = 24 * 60 * 60;
const REVIEW = 3n * BigInt(DAY);
const STATUS = { Pending: 0, Delivered: 1, Approved: 2, KeyReleased: 3, Released: 4, Disputed: 5, Refunded: 6 } as const;
const KEY: `0x${string}` = `0x${"ab".repeat(48)}`;
const WORK = keccak256(toHex("logo.svg"));
const fileTerms = (n: number) => [{ amount: usd(n), hasFile: true, workHash: zeroHash }];

describe("AgentWallet and FileEscrow: agent approvals and the arbiter rule", async function () {
  const { viem, networkHelpers } = await network.create();
  const [owner, agent, approverA, approverB, seller, arbiter, other] = await viem.getWalletClients();

  async function deploy() {
    const usdc = await viem.deployContract("MockUSDC");
    const fileEscrow = await viem.deployContract("FileEscrow", [0n]);
    const factory = await viem.deployContract("AgentWalletFactory");
    const now = BigInt(await networkHelpers.time.latest());
    await factory.write.createWallet([
      {
        owner: owner.account.address,
        token: usdc.address,
        agent: agent.account.address,
        sessionExpiresAt: now + BigInt(7 * DAY),
        maxPerTx: usd(500),
        dailyLimit: usd(1_000),
        approvers: [approverA.account.address, approverB.account.address],
        threshold: 2n,
        recipients: [seller.account.address],
        escrows: [],
      },
      usd(100_000),
    ]);
    const [walletAddress] = await factory.read.walletsOf([owner.account.address]);
    const wallet = await viem.getContractAt("AgentWallet", walletAddress);
    await wallet.write.setFileEscrow([fileEscrow.address, true]);
    const asAgent = await viem.getContractAt("AgentWallet", wallet.address, { client: { wallet: agent } });
    const asFile = (c: typeof seller) => viem.getContractAt("FileEscrow", fileEscrow.address, { client: { wallet: c } });
    return { usdc, fileEscrow, wallet, asAgent, asSeller: await asFile(seller), asArbiter: await asFile(arbiter) };
  }

  /** The seller offers a 300 file to the wallet; the owner (shortcut) approves the token and accepts. */
  async function acceptedOffer() {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { usdc, fileEscrow, wallet, asSeller } = ctx;
    await asSeller.write.offerToSell([wallet.address, arbiter.account.address, usdc.address, fileTerms(300), REVIEW, ""]);
    await wallet.write.execute([usdc.address, 0n, encodeFunctionData({ abi: usdc.abi, functionName: "approve", args: [fileEscrow.address, usd(300)] })]);
    await wallet.write.execute([fileEscrow.address, 0n, encodeFunctionData({ abi: fileEscrow.abi, functionName: "accept", args: [0n] })]);
    await asSeller.write.deliver([0n, 0n, WORK, "ipfs://enc"]);
    return ctx;
  }

  const status = async (ctx: Awaited<ReturnType<typeof deploy>>) => (await ctx.fileEscrow.read.getMilestone([0n, 0n])).status;

  describe("the agent approves a delivered file (DC-H-01, DC-L-02)", () => {
    it("DC-H-01 fixed: once the key is out, the agent cannot approve again; the buyer confirms it", async () => {
      const ctx = await acceptedOffer();
      const { usdc, wallet, asAgent, asSeller, fileEscrow } = ctx;
      await asAgent.write.agentApproveFile([fileEscrow.address, 0n, 0n]);
      assert.equal(await status(ctx), STATUS.Approved);

      // The contract cannot tell whether this key opens the file: any nonempty bytes are accepted.
      await asSeller.write.releaseKey([0n, 0n, KEY]);
      assert.equal(await status(ctx), STATUS.KeyReleased);

      // The agent's second approval would pay at once without a challenge window: refused.
      await assert.rejects(asAgent.write.agentApproveFile([fileEscrow.address, 0n, 0n]), /MilestoneNotDelivered/);
      assert.equal(await status(ctx), STATUS.KeyReleased);
      assert.equal(await usdc.read.balanceOf([seller.account.address]), 0n);

      // The buyer's own confirmation (owner path) still settles it.
      await wallet.write.execute([fileEscrow.address, 0n, encodeFunctionData({ abi: fileEscrow.abi, functionName: "approve", args: [0n, 0n] })]);
      assert.equal(await status(ctx), STATUS.Released);
      assert.equal(await usdc.read.balanceOf([seller.account.address]), usd(300));
    });

    it("DC-L-02 fixed: a milestone is charged to the agent's cap once", async () => {
      const ctx = await acceptedOffer();
      const { wallet, asAgent, asSeller, fileEscrow } = ctx;
      await asAgent.write.agentApproveFile([fileEscrow.address, 0n, 0n]);
      assert.equal(await wallet.read.remainingToday([agent.account.address]), usd(700));
      await asSeller.write.releaseKey([0n, 0n, KEY]);
      await assert.rejects(asAgent.write.agentApproveFile([fileEscrow.address, 0n, 0n]));
      assert.equal(await wallet.read.remainingToday([agent.account.address]), usd(700));
    });

    it("a paused wallet stops the agent's approval", async () => {
      const ctx = await acceptedOffer();
      const { wallet, asAgent, fileEscrow } = ctx;
      await wallet.write.pause();
      await assert.rejects(asAgent.write.agentApproveFile([fileEscrow.address, 0n, 0n]));
      assert.equal(await status(ctx), STATUS.Delivered);
    });

    it("once settled, the agent cannot approve the same milestone again", async () => {
      const ctx = await acceptedOffer();
      const { wallet, asAgent, asSeller, fileEscrow } = ctx;
      await asAgent.write.agentApproveFile([fileEscrow.address, 0n, 0n]);
      await asSeller.write.releaseKey([0n, 0n, KEY]);
      await wallet.write.execute([fileEscrow.address, 0n, encodeFunctionData({ abi: fileEscrow.abi, functionName: "approve", args: [0n, 0n] })]);
      await assert.rejects(asAgent.write.agentApproveFile([fileEscrow.address, 0n, 0n]));
    });

    it("the buyer can still dispute a released key inside the window, and the agent then cannot approve", async () => {
      const ctx = await acceptedOffer();
      const { wallet, asAgent, asSeller, fileEscrow } = ctx;
      await asAgent.write.agentApproveFile([fileEscrow.address, 0n, 0n]);
      await asSeller.write.releaseKey([0n, 0n, KEY]);
      await wallet.write.execute([fileEscrow.address, 0n, encodeFunctionData({ abi: fileEscrow.abi, functionName: "dispute", args: [0n, 0n] })]);
      assert.equal(await status(ctx), STATUS.Disputed);
      await assert.rejects(asAgent.write.agentApproveFile([fileEscrow.address, 0n, 0n]));
    });
  });

  describe("arbiter neutrality after the deal exists (AW-M-03)", () => {
    it("the wallet refuses an arbiter that is already on its side at setup", async () => {
      const ctx = await networkHelpers.loadFixture(deploy);
      const { usdc, wallet, fileEscrow, asSeller } = ctx;
      await asSeller.write.offerToSell([wallet.address, agent.account.address, usdc.address, fileTerms(300), REVIEW, ""]);
      await wallet.write.execute([usdc.address, 0n, encodeFunctionData({ abi: usdc.abi, functionName: "approve", args: [fileEscrow.address, usd(300)] })]);
      // Owner `execute` is unrestricted, so check the approved path: the agent proposes the accept.
      const asAgent = await viem.getContractAt("AgentWallet", wallet.address, { client: { wallet: agent } });
      const data = encodeFunctionData({ abi: fileEscrow.abi, functionName: "accept", args: [0n] });
      await viem.assertions.revertWithCustomError(asAgent.write.propose([2, fileEscrow.address, 0n, 0n, data, "accept"]), wallet, "ArbiterNotNeutral");
      assert.equal((await fileEscrow.read.getDeal([0n])).status, 0); // still Proposed: nothing was locked
    });

    it("KNOWN GAP (AW-M-03): the owner can make an active deal's arbiter an approver or a session key afterwards", async () => {
      const ctx = await acceptedOffer(); // arbiter is neutral when the deal starts
      const { wallet } = ctx;
      await wallet.write.setApprover([arbiter.account.address, true]);
      await wallet.write.setSession([arbiter.account.address, BigInt(await networkHelpers.time.latest()) + 1000n, usd(1), usd(2)]);
      assert.equal(await wallet.read.isApprover([arbiter.account.address]), true);
      assert.equal(await wallet.read.isActiveSession([arbiter.account.address]), true);
      // The deal is untouched and the arbiter can still resolve it: the buyer side now controls the judge.
      assert.equal((await ctx.fileEscrow.read.getDeal([0n])).arbiter.toLowerCase(), arbiter.account.address.toLowerCase());
    });

    it("an unrelated address stays a stranger to the wallet", async () => {
      const ctx = await acceptedOffer();
      assert.equal(await ctx.wallet.read.isApprover([other.account.address]), false);
      assert.equal(await ctx.wallet.read.isActiveSession([other.account.address]), false);
    });
  });
});
