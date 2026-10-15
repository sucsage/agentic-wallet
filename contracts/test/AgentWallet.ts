import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { encodeFunctionData, getAddress, hashTypedData, keccak256, toHex, zeroHash } from "viem";

const usd = (n: number) => BigInt(Math.round(n * 1e6));
const DAY = 24 * 60 * 60;

describe("AgentWallet", async function () {
  const { viem, networkHelpers } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [owner, agent, approverA, approverB, contractor, evil, arbiter, stranger] = await viem.getWalletClients();

  async function deploy() {
    const usdc = await viem.deployContract("MockUSDC");
    const escrow = await viem.deployContract("MilestoneEscrow");
    const factory = await viem.deployContract("AgentWalletFactory");

    // One transaction: deploy a fully configured wallet and seed it with test stablecoin.
    const now = BigInt(await networkHelpers.time.latest());
    const config = {
      owner: owner.account.address,
      token: usdc.address,
      agent: agent.account.address,
      sessionExpiresAt: now + BigInt(7 * DAY),
      maxPerTx: usd(500),
      dailyLimit: usd(1_000),
      approvers: [approverA.account.address, approverB.account.address],
      threshold: 2n,
      recipients: [contractor.account.address],
      escrows: [escrow.address],
    };
    await factory.write.createWallet([config, usd(100_000)]);
    const [walletAddress] = await factory.read.walletsOf([owner.account.address]);
    const wallet = await viem.getContractAt("AgentWallet", walletAddress);

    // Owner sets up a funded deal: deposit 300, FAT 2000, SAT 700.
    const amounts = [usd(300), usd(2_000), usd(700)];
    await wallet.write.execute([
      usdc.address,
      0n,
      encodeFunctionData({ abi: usdc.abi, functionName: "approve", args: [escrow.address, usd(3_000)] }),
    ]);
    await wallet.write.execute([
      escrow.address,
      0n,
      encodeFunctionData({
        abi: escrow.abi,
        functionName: "createDeal",
        args: [contractor.account.address, arbiter.account.address, usdc.address, amounts, "ipfs://po-0001"],
      }),
    ]);
    await wallet.write.execute([
      escrow.address,
      0n,
      encodeFunctionData({ abi: escrow.abi, functionName: "fund", args: [0n] }),
    ]);

    const fileEscrow = await viem.deployContract("FileEscrow");
    await wallet.write.setFileEscrow([fileEscrow.address, true]);

    const as = async <T extends "AgentWallet" | "MilestoneEscrow">(
      name: T,
      address: `0x${string}`,
      client: typeof owner,
    ) => viem.getContractAt(name, address, { client: { wallet: client } });

    return {
      usdc,
      escrow,
      fileEscrow,
      wallet,
      asAgent: await as("AgentWallet", wallet.address, agent),
      asA: await as("AgentWallet", wallet.address, approverA),
      asB: await as("AgentWallet", wallet.address, approverB),
      asEvil: await as("AgentWallet", wallet.address, evil),
      asStranger: await as("AgentWallet", wallet.address, stranger),
      escrowAsContractor: await as("MilestoneEscrow", escrow.address, contractor),
      escrowAsArbiter: await as("MilestoneEscrow", escrow.address, arbiter),
    };
  }

  describe("Tier 2: autonomous, capped actions", () => {
    it("agent releases a small milestone on its own", async () => {
      const { usdc, escrow, asAgent, wallet } = await networkHelpers.loadFixture(deploy);
      await asAgent.write.agentReleaseMilestone([escrow.address, 0n, 0n]);
      assert.equal(await usdc.read.balanceOf([contractor.account.address]), usd(300));
      assert.equal(await wallet.read.remainingToday([agent.account.address]), usd(700));
      const m = await escrow.read.getMilestone([0n, 0n]);
      assert.equal(m.status, 2); // Released
    });

    it("agent cannot release a milestone above its per-tx cap", async () => {
      const { escrow, asAgent, wallet } = await networkHelpers.loadFixture(deploy);
      await viem.assertions.revertWithCustomErrorWithArgs(
        asAgent.write.agentReleaseMilestone([escrow.address, 0n, 1n]),
        wallet,
        "ExceedsPerTxLimit",
        [usd(2_000), usd(500)],
      );
    });

    it("enforces the daily limit and resets the next day", async () => {
      const { usdc, asAgent, wallet } = await networkHelpers.loadFixture(deploy);
      await asAgent.write.agentTransfer([contractor.account.address, usd(500)]);
      await asAgent.write.agentTransfer([contractor.account.address, usd(500)]);
      await viem.assertions.revertWithCustomErrorWithArgs(
        asAgent.write.agentTransfer([contractor.account.address, usd(1)]),
        wallet,
        "ExceedsDailyLimit",
        [usd(1), 0n],
      );
      await networkHelpers.time.increase(DAY);
      await asAgent.write.agentTransfer([contractor.account.address, usd(1)]);
      assert.equal(await usdc.read.balanceOf([contractor.account.address]), usd(1_001));
    });

    it("only the agent's session key can use agent functions", async () => {
      const { asStranger, wallet } = await networkHelpers.loadFixture(deploy);
      await viem.assertions.revertWithCustomError(
        asStranger.write.agentTransfer([contractor.account.address, usd(1)]),
        wallet,
        "NotAgent",
      );
    });

    it("session keys expire", async () => {
      const { asAgent, wallet } = await networkHelpers.loadFixture(deploy);
      await networkHelpers.time.increase(8 * DAY);
      await viem.assertions.revertWithCustomError(
        asAgent.write.agentTransfer([contractor.account.address, usd(1)]),
        wallet,
        "NotAgent",
      );
    });
  });

  describe("Attack scenarios (prompt injection / hallucination)", () => {
    it("blocks 'transfer all funds to 0xEvil' on every path", async () => {
      const { usdc, asAgent, wallet } = await networkHelpers.loadFixture(deploy);
      const all = await usdc.read.balanceOf([wallet.address]);
      const evilAddr = getAddress(evil.account.address);

      // Direct transfer.
      await viem.assertions.revertWithCustomErrorWithArgs(
        asAgent.write.agentTransfer([evilAddr, all]),
        wallet,
        "RecipientNotAllowed",
        [evilAddr],
      );
      // Even a tiny amount within caps.
      await viem.assertions.revertWithCustomErrorWithArgs(
        asAgent.write.agentTransfer([evilAddr, usd(1)]),
        wallet,
        "RecipientNotAllowed",
        [evilAddr],
      );
      // Proposing it for human approval.
      await viem.assertions.revertWithCustomErrorWithArgs(
        asAgent.write.propose([0, evilAddr, all, 0n, "0x", "urgent vendor payment"]),
        wallet,
        "RecipientNotAllowed",
        [evilAddr],
      );
      // Smuggling it through a generic call to the token.
      const transferData = encodeFunctionData({ abi: usdc.abi, functionName: "transfer", args: [evilAddr, all] });
      await viem.assertions.revertWithCustomError(
        asAgent.write.propose([2, usdc.address, 0n, 0n, transferData, "routine"]),
        wallet,
        "InvalidProposal",
      );
      // Granting the attacker an allowance.
      const approveData = encodeFunctionData({ abi: usdc.abi, functionName: "approve", args: [evilAddr, all] });
      await viem.assertions.revertWithCustomErrorWithArgs(
        asAgent.write.propose([2, usdc.address, 0n, 0n, approveData, "routine"]),
        wallet,
        "EscrowNotAllowed",
        [evilAddr],
      );

      assert.equal(await usdc.read.balanceOf([wallet.address]), all);
      assert.equal(await usdc.read.balanceOf([evilAddr]), 0n);
    });

    it("blocks an escrow deal that would pay a non-allowlisted payee", async () => {
      const { usdc, escrow, asAgent, wallet } = await networkHelpers.loadFixture(deploy);
      const evilAddr = getAddress(evil.account.address);
      const data = encodeFunctionData({
        abi: escrow.abi,
        functionName: "createDeal",
        args: [evilAddr, arbiter.account.address, usdc.address, [usd(10_000)], "ipfs://fake"],
      });
      await viem.assertions.revertWithCustomErrorWithArgs(
        asAgent.write.propose([2, escrow.address, 0n, 0n, data, "new supplier"]),
        wallet,
        "RecipientNotAllowed",
        [evilAddr],
      );
    });

    it("blocks releasing from a non-allowlisted escrow or a deal the wallet does not pay", async () => {
      const { usdc, escrow, asAgent, wallet } = await networkHelpers.loadFixture(deploy);
      const rogueEscrow = await viem.deployContract("MilestoneEscrow");
      await viem.assertions.revertWithCustomErrorWithArgs(
        asAgent.write.agentReleaseMilestone([rogueEscrow.address, 0n, 0n]),
        wallet,
        "EscrowNotAllowed",
        [getAddress(rogueEscrow.address)],
      );

      // Someone else's deal on the allowlisted escrow.
      const escrowAsStranger = await viem.getContractAt("MilestoneEscrow", escrow.address, {
        client: { wallet: stranger },
      });
      await escrowAsStranger.write.createDeal([
        contractor.account.address,
        arbiter.account.address,
        usdc.address,
        [usd(100)],
        "ipfs://other",
      ]);
      await viem.assertions.revertWithCustomError(
        asAgent.write.agentReleaseMilestone([escrow.address, 1n, 0n]),
        wallet,
        "NotPayerOfDeal",
      );
    });
  });

  describe("Tier 1: propose -> multisig approval", () => {
    it("large milestone executes only after 2-of-2 approvals", async () => {
      const { usdc, escrow, asAgent, asA, asB, wallet } = await networkHelpers.loadFixture(deploy);
      await asAgent.write.propose([1, escrow.address, 0n, 1n, "0x", "FAT report verified: all 42 I/O points pass"]);

      await asA.write.approve([0n]);
      assert.equal(await usdc.read.balanceOf([contractor.account.address]), 0n);
      await viem.assertions.revertWithCustomError(asA.write.approve([0n]), wallet, "AlreadyApproved");

      await viem.assertions.emitWithArgs(asB.write.approve([0n]), wallet, "ProposalExecuted", [0n]);
      assert.equal(await usdc.read.balanceOf([contractor.account.address]), usd(2_000));
      assert.equal((await escrow.read.getMilestone([0n, 1n])).status, 2);
      await viem.assertions.revertWithCustomError(asA.write.approve([0n]), wallet, "ProposalClosed");
    });

    it("SetupDeal creates and funds a deal in one approval round", async () => {
      const { usdc, escrow, asAgent, asA, asB, wallet } = await networkHelpers.loadFixture(deploy);
      const data = encodeFunctionData({
        abi: escrow.abi,
        functionName: "createDeal",
        args: [
          contractor.account.address,
          arbiter.account.address,
          usdc.address,
          [usd(400), usd(600)],
          'data:application/json,{"po":"PO-2"}',
        ],
      });
      await asAgent.write.propose([3, escrow.address, 0n, 0n, data, "PO-2 parsed: 2 milestones"]);
      await asA.write.approve([0n]);
      await asB.write.approve([0n]);

      const [asPayer] = await escrow.read.dealsOf([wallet.address]);
      assert.deepEqual(asPayer, [0n, 1n]);
      const deal = await escrow.read.getDeal([1n]);
      assert.equal(deal.funded, true);
      assert.equal(deal.total, usd(1_000));
      assert.equal(await usdc.read.allowance([wallet.address, escrow.address]), 0n);
    });

    it("SetupDeal rejects a non-allowlisted payee or a wrong token", async () => {
      const { usdc, escrow, asAgent, wallet } = await networkHelpers.loadFixture(deploy);
      const evilAddr = getAddress(evil.account.address);
      const mk = (payee: `0x${string}`, token: `0x${string}`) =>
        encodeFunctionData({
          abi: escrow.abi,
          functionName: "createDeal",
          args: [payee, arbiter.account.address, token, [usd(1)], ""],
        });
      await viem.assertions.revertWithCustomErrorWithArgs(
        asAgent.write.propose([3, escrow.address, 0n, 0n, mk(evilAddr, usdc.address), "x"]),
        wallet,
        "RecipientNotAllowed",
        [evilAddr],
      );
      const otherToken = await viem.deployContract("MockUSDC");
      await viem.assertions.revertWithCustomError(
        asAgent.write.propose([3, escrow.address, 0n, 0n, mk(contractor.account.address, otherToken.address), "x"]),
        wallet,
        "WrongToken",
      );
    });

    it("rejects a deal whose arbiter is on the buyer's side", async () => {
      const { usdc, escrow, asAgent, wallet } = await networkHelpers.loadFixture(deploy);
      const mk = (judge: `0x${string}`) =>
        encodeFunctionData({
          abi: escrow.abi,
          functionName: "createDeal",
          args: [contractor.account.address, judge, usdc.address, [usd(1)], ""],
        });
      for (const judge of [owner, agent, approverA].map((c) => getAddress(c.account.address))) {
        // SetupDeal path.
        await viem.assertions.revertWithCustomErrorWithArgs(
          asAgent.write.propose([3, escrow.address, 0n, 0n, mk(judge), "x"]),
          wallet,
          "ArbiterNotNeutral",
          [judge],
        );
        // Generic Call path.
        await viem.assertions.revertWithCustomErrorWithArgs(
          asAgent.write.propose([2, escrow.address, 0n, 0n, mk(judge), "x"]),
          wallet,
          "ArbiterNotNeutral",
          [judge],
        );
      }
    });

    describe("SetupFileDeal: a FileEscrow offer to buy", () => {
      const REVIEW = 3n * BigInt(DAY);
      const fileTerms = (...amounts: number[]) =>
        amounts.map((n) => ({ amount: usd(n), hasFile: true, workHash: zeroHash }));

      it("locks the payment in the offer in one approval round", async () => {
        const { usdc, fileEscrow, asAgent, asA, asB, wallet } = await networkHelpers.loadFixture(deploy);
        const data = encodeFunctionData({
          abi: fileEscrow.abi,
          functionName: "offerToBuy",
          args: [contractor.account.address, arbiter.account.address, usdc.address, fileTerms(400, 600), REVIEW, "logo"],
        });
        await asAgent.write.propose([4, fileEscrow.address, usd(1_000), 0n, data, "logo commission, 2 milestones"]);
        await asA.write.approve([0n]);
        await asB.write.approve([0n]);

        const deal = await fileEscrow.read.getDeal([0n]);
        assert.equal(deal.buyer, getAddress(wallet.address));
        assert.equal(deal.seller, getAddress(contractor.account.address));
        assert.equal(deal.total, usd(1_000));
        assert.equal(deal.status, 0); // Proposed: waiting for the seller to accept
        assert.equal(await usdc.read.balanceOf([fileEscrow.address]), usd(1_000));
        assert.equal(await usdc.read.allowance([wallet.address, fileEscrow.address]), 0n);
      });

      it("rejects an offer that is unsafe for the buyer", async () => {
        const { usdc, escrow, fileEscrow, asAgent, wallet } = await networkHelpers.loadFixture(deploy);
        const evilAddr = getAddress(evil.account.address);
        const ownerAddr = getAddress(owner.account.address);
        const otherToken = await viem.deployContract("MockUSDC");
        const offer = (seller: `0x${string}`, judge: `0x${string}`, token: `0x${string}`) =>
          encodeFunctionData({
            abi: fileEscrow.abi,
            functionName: "offerToBuy",
            args: [seller, judge, token, fileTerms(100), REVIEW, ""],
          });
        const good = offer(contractor.account.address, arbiter.account.address, usdc.address);

        // Only allowlisted FileEscrows, and never a MilestoneEscrow in their place.
        const rogue = await viem.deployContract("FileEscrow");
        await viem.assertions.revertWithCustomErrorWithArgs(
          asAgent.write.propose([4, rogue.address, 0n, 0n, good, "x"]),
          wallet,
          "FileEscrowNotAllowed",
          [getAddress(rogue.address)],
        );
        await viem.assertions.revertWithCustomErrorWithArgs(
          asAgent.write.propose([4, escrow.address, 0n, 0n, good, "x"]),
          wallet,
          "FileEscrowNotAllowed",
          [getAddress(escrow.address)],
        );
        // Seller must be allowlisted, the arbiter neutral, the token the wallet's own.
        await viem.assertions.revertWithCustomErrorWithArgs(
          asAgent.write.propose([4, fileEscrow.address, 0n, 0n, offer(evilAddr, arbiter.account.address, usdc.address), "x"]),
          wallet,
          "RecipientNotAllowed",
          [evilAddr],
        );
        await viem.assertions.revertWithCustomErrorWithArgs(
          asAgent.write.propose([4, fileEscrow.address, 0n, 0n, offer(contractor.account.address, ownerAddr, usdc.address), "x"]),
          wallet,
          "ArbiterNotNeutral",
          [ownerAddr],
        );
        await viem.assertions.revertWithCustomError(
          asAgent.write.propose([4, fileEscrow.address, 0n, 0n, offer(contractor.account.address, arbiter.account.address, otherToken.address), "x"]),
          wallet,
          "WrongToken",
        );
        // Only offerToBuy, and no stray amount/index.
        const sell = encodeFunctionData({
          abi: fileEscrow.abi,
          functionName: "offerToSell",
          args: [contractor.account.address, arbiter.account.address, usdc.address, fileTerms(100), REVIEW, ""],
        });
        await viem.assertions.revertWithCustomError(
          asAgent.write.propose([4, fileEscrow.address, 0n, 0n, sell, "x"]),
          wallet,
          "InvalidProposal",
        );
        // `amount` must state the 100 the offer locks: not more, less or zero.
        for (const wrong of [0n, usd(99), usd(101)]) {
          await viem.assertions.revertWithCustomError(
            asAgent.write.propose([4, fileEscrow.address, wrong, 0n, good, "x"]),
            wallet,
            "InvalidProposal",
          );
        }
        await viem.assertions.revertWithCustomError(
          asAgent.write.propose([4, fileEscrow.address, usd(100), 1n, good, "x"]),
          wallet,
          "InvalidProposal",
        );
      });

      it("re-checks the seller when the proposal executes", async () => {
        const { usdc, fileEscrow, asAgent, asA, asB, wallet } = await networkHelpers.loadFixture(deploy);
        const data = encodeFunctionData({
          abi: fileEscrow.abi,
          functionName: "offerToBuy",
          args: [contractor.account.address, arbiter.account.address, usdc.address, fileTerms(100), REVIEW, ""],
        });
        await asAgent.write.propose([4, fileEscrow.address, usd(100), 0n, data, "x"]);
        await wallet.write.setRecipient([contractor.account.address, false]);
        await asA.write.approve([0n]);
        await viem.assertions.revertWithCustomErrorWithArgs(
          asB.write.approve([0n]),
          wallet,
          "RecipientNotAllowed",
          [getAddress(contractor.account.address)],
        );
      });

      describe("the buyer's moves on a FileEscrow deal, through approved calls", () => {
        const KEY: `0x${string}` = `0x${"ab".repeat(48)}`;
        const fileEscrowAs = (fileEscrow: { address: `0x${string}` }, client: typeof owner) =>
          viem.getContractAt("FileEscrow", fileEscrow.address, { client: { wallet: client } });

        /** Proposes a Call and has both approvers sign it off. */
        async function runCall(
          ctx: Awaited<ReturnType<typeof deploy>>,
          target: `0x${string}`,
          data: `0x${string}`,
        ) {
          const id = await ctx.wallet.read.proposalCount();
          await ctx.asAgent.write.propose([2, target, 0n, 0n, data, "buyer action"]);
          await ctx.asA.write.approve([id]);
          return ctx.asB.write.approve([id]);
        }

        /** The contractor offers a 300 file to the wallet; the wallet approves the token and accepts. */
        async function acceptedSellerOffer() {
          const ctx = await networkHelpers.loadFixture(deploy);
          const { usdc, fileEscrow, wallet } = ctx;
          const asSeller = await fileEscrowAs(fileEscrow, contractor);
          await asSeller.write.offerToSell([wallet.address, arbiter.account.address, usdc.address, fileTerms(300), REVIEW, ""]);
          await runCall(ctx, usdc.address, encodeFunctionData({ abi: usdc.abi, functionName: "approve", args: [fileEscrow.address, usd(300)] }));
          await runCall(ctx, fileEscrow.address, encodeFunctionData({ abi: fileEscrow.abi, functionName: "accept", args: [0n] }));
          return { ...ctx, asSeller };
        }

        const call = (
          fileEscrow: { abi: unknown },
          functionName: "accept" | "cancel" | "approve" | "dispute" | "reclaim",
          args: readonly bigint[],
        ) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          encodeFunctionData({ abi: fileEscrow.abi as any, functionName, args } as any);

        it("accepts a seller's offer: the payment gets locked", async () => {
          const { usdc, fileEscrow } = await acceptedSellerOffer();
          assert.equal((await fileEscrow.read.getDeal([0n])).status, 1); // Active
          assert.equal(await usdc.read.balanceOf([fileEscrow.address]), usd(300));
        });

        it("approves delivered work, then reclaims the money if the key never comes", async () => {
          const ctx = await acceptedSellerOffer();
          const { usdc, fileEscrow, wallet, asSeller } = ctx;
          const before = await usdc.read.balanceOf([wallet.address]);
          await asSeller.write.deliver([0n, 0n, keccak256(toHex("logo.svg")), "ipfs://enc"]);

          await runCall(ctx, fileEscrow.address, call(fileEscrow, "approve", [0n, 0n]));
          assert.equal((await fileEscrow.read.getMilestone([0n, 0n])).status, 2); // Approved

          await networkHelpers.time.increase(REVIEW + 1n); // the seller never releases the key
          await runCall(ctx, fileEscrow.address, call(fileEscrow, "reclaim", [0n, 0n]));
          assert.equal((await fileEscrow.read.getMilestone([0n, 0n])).status, 6); // Refunded
          assert.equal(await usdc.read.balanceOf([wallet.address]), before + usd(300));
        });

        it("disputes delivered work, and cancels its own unaccepted offer", async () => {
          const ctx = await acceptedSellerOffer();
          const { usdc, fileEscrow, wallet, asSeller } = ctx;
          await asSeller.write.deliver([0n, 0n, keccak256(toHex("logo.svg")), "ipfs://enc"]);
          await runCall(ctx, fileEscrow.address, call(fileEscrow, "dispute", [0n, 0n]));
          assert.equal((await fileEscrow.read.getMilestone([0n, 0n])).status, 5); // Disputed

          // The wallet's own offer (deal 1), withdrawn before the seller accepts.
          const before = await usdc.read.balanceOf([wallet.address]);
          const offer = encodeFunctionData({
            abi: fileEscrow.abi,
            functionName: "offerToBuy",
            args: [contractor.account.address, arbiter.account.address, usdc.address, fileTerms(200), REVIEW, ""],
          });
          const id = await wallet.read.proposalCount();
          await ctx.asAgent.write.propose([4, fileEscrow.address, usd(200), 0n, offer, "x"]);
          await ctx.asA.write.approve([id]);
          await ctx.asB.write.approve([id]);
          await runCall(ctx, fileEscrow.address, call(fileEscrow, "cancel", [1n]));
          assert.equal((await fileEscrow.read.getDeal([1n])).status, 2); // Cancelled
          assert.equal(await usdc.read.balanceOf([wallet.address]), before);
        });

        it("refuses deals it is not the buyer of, unsafe accepts and the seller's moves", async () => {
          const { usdc, fileEscrow, asAgent, wallet } = await networkHelpers.loadFixture(deploy);
          const propose = (data: `0x${string}`) => asAgent.write.propose([2, fileEscrow.address, 0n, 0n, data, "x"]);
          const evilAddr = getAddress(evil.account.address);
          const ownerAddr = getAddress(owner.account.address);

          // Deal 0: between two strangers. The wallet is not the buyer.
          const asStrangerSeller = await fileEscrowAs(fileEscrow, stranger);
          await asStrangerSeller.write.offerToSell([evil.account.address, arbiter.account.address, usdc.address, fileTerms(1), REVIEW, ""]);
          await viem.assertions.revertWithCustomError(propose(call(fileEscrow, "accept", [0n])), wallet, "NotPayerOfDeal");

          // Deal 1: offered to the wallet by a seller who is not allowlisted.
          const asEvilSeller = await fileEscrowAs(fileEscrow, evil);
          await asEvilSeller.write.offerToSell([wallet.address, arbiter.account.address, usdc.address, fileTerms(1), REVIEW, ""]);
          await viem.assertions.revertWithCustomErrorWithArgs(propose(call(fileEscrow, "accept", [1n])), wallet, "RecipientNotAllowed", [evilAddr]);

          // Deal 2: an allowlisted seller, but the wallet's own owner as the "neutral" arbiter.
          const asSeller = await fileEscrowAs(fileEscrow, contractor);
          await asSeller.write.offerToSell([wallet.address, ownerAddr, usdc.address, fileTerms(1), REVIEW, ""]);
          await viem.assertions.revertWithCustomErrorWithArgs(propose(call(fileEscrow, "accept", [2n])), wallet, "ArbiterNotNeutral", [ownerAddr]);

          // The seller's moves on a deal the wallet does not sell, and malformed calldata, are refused.
          const claim = encodeFunctionData({ abi: fileEscrow.abi, functionName: "claim", args: [0n, 0n] });
          await viem.assertions.revertWithCustomError(propose(claim), wallet, "NotSellerOfDeal");
          const padded = `${call(fileEscrow, "accept", [0n])}${"00".repeat(32)}` as `0x${string}`;
          await viem.assertions.revertWithCustomError(propose(padded), wallet, "InvalidProposal");
        });

        it("agent approves small delivered work on its own, counted against its caps", async () => {
          const { fileEscrow, asAgent, wallet, asSeller } = await acceptedSellerOffer();
          await asSeller.write.deliver([0n, 0n, keccak256(toHex("logo.svg")), "ipfs://enc"]);

          await viem.assertions.emitWithArgs(
            asAgent.write.agentApproveFile([fileEscrow.address, 0n, 0n]),
            wallet,
            "AgentFileApproved",
            [getAddress(agent.account.address), getAddress(fileEscrow.address), 0n, 0n, usd(300)],
          );
          assert.equal((await fileEscrow.read.getMilestone([0n, 0n])).status, 2); // Approved
          assert.equal(await wallet.read.remainingToday([agent.account.address]), usd(700));
        });

        it("agent cannot approve above its cap, on others' deals, from a rogue escrow, or for a dropped seller", async () => {
          const ctx = await acceptedSellerOffer();
          const { usdc, fileEscrow, asAgent, asStranger, wallet, asSeller } = ctx;

          // Deal 1: a delivered 800 milestone, above the agent's 500 per-tx cap.
          await asSeller.write.offerToSell([wallet.address, arbiter.account.address, usdc.address, fileTerms(800), REVIEW, ""]);
          await runCall(ctx, usdc.address, encodeFunctionData({ abi: usdc.abi, functionName: "approve", args: [fileEscrow.address, usd(800)] }));
          await runCall(ctx, fileEscrow.address, call(fileEscrow, "accept", [1n]));
          await asSeller.write.deliver([1n, 0n, keccak256(toHex("big.svg")), "ipfs://enc"]);
          await viem.assertions.revertWithCustomErrorWithArgs(
            asAgent.write.agentApproveFile([fileEscrow.address, 1n, 0n]),
            wallet,
            "ExceedsPerTxLimit",
            [usd(800), usd(500)],
          );

          // Deal 2: between strangers.
          const asStrangerSeller = await fileEscrowAs(fileEscrow, stranger);
          await asStrangerSeller.write.offerToSell([evil.account.address, arbiter.account.address, usdc.address, fileTerms(1), REVIEW, ""]);
          await viem.assertions.revertWithCustomError(asAgent.write.agentApproveFile([fileEscrow.address, 2n, 0n]), wallet, "NotPayerOfDeal");

          // A FileEscrow the owner never allowlisted, and a caller that is not the agent.
          const rogue = await viem.deployContract("FileEscrow");
          await viem.assertions.revertWithCustomErrorWithArgs(
            asAgent.write.agentApproveFile([rogue.address, 0n, 0n]),
            wallet,
            "FileEscrowNotAllowed",
            [getAddress(rogue.address)],
          );
          await viem.assertions.revertWithCustomError(asStranger.write.agentApproveFile([fileEscrow.address, 0n, 0n]), wallet, "NotAgent");

          // The owner drops the seller: the agent can no longer approve their work.
          await asSeller.write.deliver([0n, 0n, keccak256(toHex("logo.svg")), "ipfs://enc"]);
          await wallet.write.setRecipient([contractor.account.address, false]);
          await viem.assertions.revertWithCustomErrorWithArgs(
            asAgent.write.agentApproveFile([fileEscrow.address, 0n, 0n]),
            wallet,
            "RecipientNotAllowed",
            [getAddress(contractor.account.address)],
          );
        });
      });

      describe("the seller's moves when the wallet sells, through approved calls", () => {
        const fileEscrowAs = (fileEscrow: { address: `0x${string}` }, client: typeof owner) =>
          viem.getContractAt("FileEscrow", fileEscrow.address, { client: { wallet: client } });

        async function runCall(ctx: Awaited<ReturnType<typeof deploy>>, data: `0x${string}`) {
          const id = await ctx.wallet.read.proposalCount();
          await ctx.asAgent.write.propose([2, ctx.fileEscrow.address, 0n, 0n, data, "seller action"]);
          await ctx.asA.write.approve([id]);
          return ctx.asB.write.approve([id]);
        }

        /** A buyer (the contractor key, funded) offers 300 for a file to the wallet as the seller. */
        async function buyerOffer(arbiterAddr = arbiter.account.address) {
          const ctx = await networkHelpers.loadFixture(deploy);
          const { usdc, fileEscrow, wallet } = ctx;
          await usdc.write.mint([contractor.account.address, usd(1_000)]);
          const usdcAsBuyer = await viem.getContractAt("MockUSDC", usdc.address, { client: { wallet: contractor } });
          await usdcAsBuyer.write.approve([fileEscrow.address, usd(1_000)]);
          const asBuyer = await fileEscrowAs(fileEscrow, contractor);
          await asBuyer.write.offerToBuy([wallet.address, arbiterAddr, usdc.address, fileTerms(300), REVIEW, ""]);
          return { ...ctx, asBuyer };
        }

        it("accepts a buyer's offer, delivers, releases the key and claims the payment", async () => {
          const ctx = await buyerOffer();
          const { usdc, fileEscrow, wallet, asBuyer } = ctx;
          const f = fileEscrow.abi;
          await runCall(ctx, encodeFunctionData({ abi: f, functionName: "accept", args: [0n] }));
          assert.equal((await fileEscrow.read.getDeal([0n])).status, 1); // Active

          await runCall(ctx, encodeFunctionData({ abi: f, functionName: "deliver", args: [0n, 0n, keccak256(toHex("logo.svg")), "app:delivery"] }));
          assert.equal((await fileEscrow.read.getMilestone([0n, 0n])).status, 1); // Delivered

          await asBuyer.write.approve([0n, 0n]);
          await runCall(ctx, encodeFunctionData({ abi: f, functionName: "releaseKey", args: [0n, 0n, keccak256(toHex("key"))] }));
          assert.equal((await fileEscrow.read.getMilestone([0n, 0n])).status, 3); // KeyReleased

          const before = await usdc.read.balanceOf([wallet.address]);
          await networkHelpers.time.increase(REVIEW + 1n);
          await runCall(ctx, encodeFunctionData({ abi: f, functionName: "claim", args: [0n, 0n] }));
          assert.equal((await fileEscrow.read.getMilestone([0n, 0n])).status, 4); // Released
          assert.equal(await usdc.read.balanceOf([wallet.address]), before + usd(300));
        });

        it("offers its own work for sale; the buyer accepts and pays in", async () => {
          const ctx = await networkHelpers.loadFixture(deploy);
          const { usdc, fileEscrow, wallet } = ctx;
          const f = fileEscrow.abi;
          const offer = (arb: `0x${string}`, tok: `0x${string}`) =>
            encodeFunctionData({ abi: f, functionName: "offerToSell", args: [contractor.account.address, arb, tok, fileTerms(300), REVIEW, ""] });
          await runCall(ctx, offer(arbiter.account.address, usdc.address));
          const deal = await fileEscrow.read.getDeal([0n]);
          assert.equal(deal.seller, getAddress(wallet.address));
          assert.equal(deal.creator, getAddress(wallet.address));

          // The buyer accepts and pays in; the wallet delivers as usual.
          await usdc.write.mint([contractor.account.address, usd(300)]);
          const usdcAsBuyer = await viem.getContractAt("MockUSDC", usdc.address, { client: { wallet: contractor } });
          await usdcAsBuyer.write.approve([fileEscrow.address, usd(300)]);
          await (await fileEscrowAs(fileEscrow, contractor)).write.accept([0n]);
          assert.equal((await fileEscrow.read.getDeal([0n])).status, 1); // Active
          await runCall(ctx, encodeFunctionData({ abi: f, functionName: "deliver", args: [0n, 0n, keccak256(toHex("logo.svg")), "app:delivery"] }));

          // It can withdraw an offer nobody accepted yet, but not a buyer's offer to it.
          await runCall(ctx, offer(arbiter.account.address, usdc.address));
          await runCall(ctx, encodeFunctionData({ abi: f, functionName: "cancel", args: [1n] }));
          assert.equal((await fileEscrow.read.getDeal([1n])).status, 2); // Cancelled

          // Its own owner as arbiter, or another token, is refused.
          const propose = (data: `0x${string}`) => ctx.asAgent.write.propose([2, fileEscrow.address, 0n, 0n, data, "x"]);
          await viem.assertions.revertWithCustomErrorWithArgs(
            propose(offer(owner.account.address, usdc.address)), wallet, "ArbiterNotNeutral", [getAddress(owner.account.address)],
          );
          await viem.assertions.revertWithCustomError(propose(offer(arbiter.account.address, fileEscrow.address)), wallet, "WrongToken");
        });

        it("can give the buyer's money back before it settles", async () => {
          const ctx = await buyerOffer();
          const { usdc, fileEscrow } = ctx;
          await runCall(ctx, encodeFunctionData({ abi: fileEscrow.abi, functionName: "accept", args: [0n] }));
          const before = await usdc.read.balanceOf([contractor.account.address]);
          await runCall(ctx, encodeFunctionData({ abi: fileEscrow.abi, functionName: "refund", args: [0n, 0n] }));
          assert.equal((await fileEscrow.read.getMilestone([0n, 0n])).status, 6); // Refunded
          assert.equal(await usdc.read.balanceOf([contractor.account.address]), before + usd(300));
        });

        it("refuses a non-neutral arbiter, another token, and deals it does not sell", async () => {
          const propose = (ctx: Awaited<ReturnType<typeof deploy>>, data: `0x${string}`) =>
            ctx.asAgent.write.propose([2, ctx.fileEscrow.address, 0n, 0n, data, "x"]);
          const ownerAddr = getAddress(owner.account.address);

          // The buyer names the wallet's own owner as the arbiter.
          const ctx = await buyerOffer(owner.account.address);
          const accept = encodeFunctionData({ abi: ctx.fileEscrow.abi, functionName: "accept", args: [0n] });
          await viem.assertions.revertWithCustomErrorWithArgs(propose(ctx, accept), ctx.wallet, "ArbiterNotNeutral", [ownerAddr]);

          // Paid in a token that is not the wallet's.
          const other = await viem.deployContract("MockUSDC");
          await other.write.mint([contractor.account.address, usd(10)]);
          const otherAsBuyer = await viem.getContractAt("MockUSDC", other.address, { client: { wallet: contractor } });
          await otherAsBuyer.write.approve([ctx.fileEscrow.address, usd(10)]);
          await ctx.asBuyer.write.offerToBuy([ctx.wallet.address, arbiter.account.address, other.address, fileTerms(1), REVIEW, ""]);
          const acceptOther = encodeFunctionData({ abi: ctx.fileEscrow.abi, functionName: "accept", args: [1n] });
          await viem.assertions.revertWithCustomError(propose(ctx, acceptOther), ctx.wallet, "WrongToken");

          // A deal between strangers: delivering on it is not the wallet's move.
          const asStranger = await fileEscrowAs(ctx.fileEscrow, stranger);
          const usdcAsStranger = await viem.getContractAt("MockUSDC", ctx.usdc.address, { client: { wallet: stranger } });
          await ctx.usdc.write.mint([stranger.account.address, usd(10)]);
          await usdcAsStranger.write.approve([ctx.fileEscrow.address, usd(10)]);
          await asStranger.write.offerToBuy([evil.account.address, arbiter.account.address, ctx.usdc.address, fileTerms(1), REVIEW, ""]);
          const deliver = encodeFunctionData({ abi: ctx.fileEscrow.abi, functionName: "deliver", args: [2n, 0n, keccak256(toHex("x")), ""] });
          await viem.assertions.revertWithCustomError(propose(ctx, deliver), ctx.wallet, "NotSellerOfDeal");
        });
      });

      it("only the owner manages the FileEscrow allowlist", async () => {
        const { fileEscrow, asStranger, wallet } = await networkHelpers.loadFixture(deploy);
        await viem.assertions.revertWithCustomError(
          asStranger.write.setFileEscrow([fileEscrow.address, false]),
          wallet,
          "OwnableUnauthorizedAccount",
        );
      });
    });

    it("agent can draft deal setup calls that humans approve", async () => {
      const { usdc, escrow, asAgent, asA, asB } = await networkHelpers.loadFixture(deploy);
      const calls = [
        {
          target: usdc.address,
          data: encodeFunctionData({ abi: usdc.abi, functionName: "approve", args: [escrow.address, usd(1_000)] }),
        },
        {
          target: escrow.address,
          data: encodeFunctionData({
            abi: escrow.abi,
            functionName: "createDeal",
            args: [contractor.account.address, arbiter.account.address, usdc.address, [usd(1_000)], "ipfs://po-2"],
          }),
        },
        {
          target: escrow.address,
          data: encodeFunctionData({ abi: escrow.abi, functionName: "fund", args: [1n] }),
        },
      ];
      for (const [i, c] of calls.entries()) {
        await asAgent.write.propose([2, c.target, 0n, 0n, c.data, "set up PO-2"]);
        await asA.write.approve([BigInt(i)]);
        await asB.write.approve([BigInt(i)]);
      }
      const deal = await escrow.read.getDeal([1n]);
      assert.equal(deal.funded, true);
      assert.equal(await usdc.read.balanceOf([escrow.address]), usd(3_000) + usd(1_000));
    });

    it("proposals go stale when approvers change and expire after the TTL", async () => {
      const { escrow, asAgent, asA, wallet } = await networkHelpers.loadFixture(deploy);
      await asAgent.write.propose([1, escrow.address, 0n, 1n, "0x", "FAT"]);
      await wallet.write.setApprover([stranger.account.address, true]);
      await viem.assertions.revertWithCustomError(asA.write.approve([0n]), wallet, "ProposalStale");

      await asAgent.write.propose([1, escrow.address, 0n, 1n, "0x", "FAT again"]);
      await networkHelpers.time.increase(3 * DAY + 1);
      await viem.assertions.revertWithCustomError(asA.write.approve([1n]), wallet, "ProposalExpired");
    });

    it("non-approvers cannot approve", async () => {
      const { escrow, asAgent, wallet } = await networkHelpers.loadFixture(deploy);
      await asAgent.write.propose([1, escrow.address, 0n, 1n, "0x", "FAT"]);
      await viem.assertions.revertWithCustomError(asAgent.write.approve([0n]), wallet, "NotApprover");
    });
  });

  describe("Tier 3: emergency stop", () => {
    it("agent can pause itself; only the owner can unpause", async () => {
      const { asAgent, asA, wallet } = await networkHelpers.loadFixture(deploy);
      await asAgent.write.pause();
      await viem.assertions.revertWithCustomError(
        asAgent.write.agentTransfer([contractor.account.address, usd(1)]),
        wallet,
        "WalletPaused",
      );
      await viem.assertions.revertWithCustomError(
        asA.write.unpause(),
        wallet,
        "OwnableUnauthorizedAccount",
      );
      await wallet.write.unpause();
      await asAgent.write.agentTransfer([contractor.account.address, usd(1)]);
    });

    it("strangers cannot pause; owner can revoke the session key instantly", async () => {
      const { asAgent, asStranger, wallet } = await networkHelpers.loadFixture(deploy);
      await viem.assertions.revertWithCustomError(asStranger.write.pause(), wallet, "NotAuthorized");
      await wallet.write.revokeSession([agent.account.address]);
      await viem.assertions.revertWithCustomError(
        asAgent.write.agentTransfer([contractor.account.address, usd(1)]),
        wallet,
        "NotAgent",
      );
    });
  });

  describe("Owner mandates: approve by EIP-712 signature", () => {
    const MANDATE_TYPES = {
      Mandate: [
        { name: "kind", type: "uint8" },
        { name: "target", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "index", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "reasonHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint64" },
      ],
    } as const;

    type Mandate = {
      kind: number;
      target: `0x${string}`;
      amount: bigint;
      index: bigint;
      data: `0x${string}`;
      reasonHash: `0x${string}`;
      nonce: bigint;
      deadline: bigint;
    };

    async function domain(walletAddress: `0x${string}`) {
      return { name: "AgentWallet", version: "1", chainId: await publicClient.getChainId(), verifyingContract: walletAddress };
    }

    async function sign(signer: typeof owner, walletAddress: `0x${string}`, m: Mandate) {
      return signer.signTypedData({ domain: await domain(walletAddress), types: MANDATE_TYPES, primaryType: "Mandate", message: m });
    }

    /** The owner pays the contractor 2,000: four times the agent's per-tx cap. */
    async function payContractor(nonce: bigint, overrides: Partial<Mandate> = {}): Promise<Mandate> {
      const now = BigInt(await networkHelpers.time.latest());
      return {
        kind: 0,
        target: getAddress(contractor.account.address),
        amount: usd(2_000),
        index: 0n,
        data: "0x",
        // The reason's text stays off-chain (PDPA); only its hash is signed.
        reasonHash: keccak256(toHex("FAT passed, signed off by the owner")),
        nonce,
        deadline: now + BigInt(DAY),
        ...overrides,
      };
    }

    it("the owner signs, anyone relays it, and it runs at once", async () => {
      const { usdc, asAgent, wallet } = await networkHelpers.loadFixture(deploy);
      const m = await payContractor(1n);
      const signature = await sign(owner, wallet.address, m);

      await asAgent.write.executeMandate([m, signature]);
      assert.equal(await usdc.read.balanceOf([contractor.account.address]), usd(2_000));

      const digest = hashTypedData({ domain: await domain(wallet.address), types: MANDATE_TYPES, primaryType: "Mandate", message: m });
      assert.equal(await wallet.read.mandateDigest([m]), digest);
      const p = await wallet.read.getProposal([0n]);
      assert.equal(p.mandateHash, digest);
      assert.equal(p.executed, true);
      assert.equal(p.approvals, 0);
      assert.equal(p.reason, ""); // nothing personal stored on-chain
    });

    it("a file-deal mandate states the total it locks, and must match the offer", async () => {
      const { usdc, fileEscrow, asAgent, wallet } = await networkHelpers.loadFixture(deploy);
      const offer = encodeFunctionData({
        abi: fileEscrow.abi,
        functionName: "offerToBuy",
        args: [
          contractor.account.address,
          arbiter.account.address,
          usdc.address,
          [{ amount: usd(300), hasFile: true, workHash: zeroHash }],
          3n * BigInt(DAY),
          "",
        ],
      });
      const fileDeal = (amount: bigint) =>
        payContractor(1n, { kind: 4, target: getAddress(fileEscrow.address), amount, data: offer });

      // Signed as 100 while the offer locks 300: refused, so the signing prompt can't understate it.
      const understated = await fileDeal(usd(100));
      await viem.assertions.revertWithCustomError(
        asAgent.write.executeMandate([understated, await sign(owner, wallet.address, understated)]),
        wallet,
        "InvalidProposal",
      );

      const m = await fileDeal(usd(300));
      await asAgent.write.executeMandate([m, await sign(owner, wallet.address, m)]);
      const deal = await fileEscrow.read.getDeal([0n]);
      assert.equal(deal.buyer, getAddress(wallet.address));
      assert.equal(deal.total, usd(300));
    });

    it("cannot be replayed, altered, forged, used late, or used to bypass the policy", async () => {
      const { asAgent, asA, wallet } = await networkHelpers.loadFixture(deploy);
      const m = await payContractor(1n);
      const signature = await sign(owner, wallet.address, m);
      await asAgent.write.executeMandate([m, signature]);

      await viem.assertions.revertWithCustomError(asAgent.write.executeMandate([m, signature]), wallet, "MandateAlreadyUsed");

      const m2 = await payContractor(2n);
      const sig2 = await sign(owner, wallet.address, m2);
      await viem.assertions.revertWithCustomError(
        asAgent.write.executeMandate([{ ...m2, amount: usd(3_000) }, sig2]),
        wallet,
        "InvalidMandate",
      );
      await viem.assertions.revertWithCustomError(
        asAgent.write.executeMandate([m2, await sign(approverA, wallet.address, m2)]),
        wallet,
        "InvalidMandate",
      );

      // Even the owner's own signature cannot pay someone off the allowlist.
      const evilAddr = getAddress(evil.account.address);
      const toEvil = await payContractor(3n, { target: evilAddr });
      await viem.assertions.revertWithCustomErrorWithArgs(
        asAgent.write.executeMandate([toEvil, await sign(owner, wallet.address, toEvil)]),
        wallet,
        "RecipientNotAllowed",
        [evilAddr],
      );

      await asA.write.pause();
      await viem.assertions.revertWithCustomError(asAgent.write.executeMandate([m2, sig2]), wallet, "WalletPaused");
      await wallet.write.unpause();

      await networkHelpers.time.increase(DAY + 1);
      await viem.assertions.revertWithCustomError(asAgent.write.executeMandate([m2, sig2]), wallet, "MandateExpired");
    });

    it("the owner can revoke a signed mandate, and a new owner voids the old owner's signatures", async () => {
      const { asAgent, asStranger, wallet } = await networkHelpers.loadFixture(deploy);
      const m = await payContractor(1n);
      const signature = await sign(owner, wallet.address, m);
      const digest = await wallet.read.mandateDigest([m]);

      await viem.assertions.revertWithCustomError(asStranger.write.revokeMandate([digest]), wallet, "OwnableUnauthorizedAccount");
      await wallet.write.revokeMandate([digest]);
      await viem.assertions.revertWithCustomError(asAgent.write.executeMandate([m, signature]), wallet, "MandateAlreadyUsed");

      const m2 = await payContractor(2n);
      const sig2 = await sign(owner, wallet.address, m2);
      await wallet.write.transferOwnership([stranger.account.address]);
      await asStranger.write.acceptOwnership();
      await viem.assertions.revertWithCustomError(asAgent.write.executeMandate([m2, sig2]), wallet, "InvalidMandate");
    });
  });

  describe("MilestoneEscrow", () => {
    it("records evidence, handles disputes via the arbiter", async () => {
      const { usdc, escrow, escrowAsContractor, escrowAsArbiter, asAgent, asA, asB, wallet } =
        await networkHelpers.loadFixture(deploy);
      const hash = keccak256(toHex("SAT report v1"));
      await escrowAsContractor.write.submitEvidence([0n, 2n, hash, "ipfs://sat-report"]);
      const m = await escrow.read.getMilestone([0n, 2n]);
      assert.equal(m.status, 1);
      assert.equal(m.evidenceHash, hash);

      await escrowAsContractor.write.dispute([0n, 2n]);
      // A disputed milestone can no longer be released, even with human approval.
      await asAgent.write.propose([1, escrow.address, 0n, 2n, "0x", "SAT"]);
      await asA.write.approve([0n]);
      await viem.assertions.revertWithCustomErrorWithArgs(asB.write.approve([0n]), escrow, "BadStatus", [3]);
      await escrowAsArbiter.write.resolve([0n, 2n, false]);
      assert.equal((await escrow.read.getMilestone([0n, 2n])).status, 4);
      assert.equal(await usdc.read.balanceOf([wallet.address]), usd(100_000) - usd(3_000) + usd(700));
    });

    it("rejects an arbiter who is the payer or the payee", async () => {
      const { usdc, escrow } = await networkHelpers.loadFixture(deploy);
      const escrowAsStranger = await viem.getContractAt("MilestoneEscrow", escrow.address, {
        client: { wallet: stranger },
      });
      for (const judge of [stranger.account.address, contractor.account.address]) {
        await viem.assertions.revertWithCustomError(
          escrowAsStranger.write.createDeal([contractor.account.address, judge, usdc.address, [usd(1)], ""]),
          escrow,
          "ArbiterNotNeutral",
        );
      }
    });

    it("only the payer can release", async () => {
      const { escrow, escrowAsContractor } = await networkHelpers.loadFixture(deploy);
      await viem.assertions.revertWithCustomError(escrowAsContractor.write.release([0n, 0n]), escrow, "NotPayer");
    });
  });

  it("emits an audit trail for agent actions", async () => {
    const { escrow, asAgent, wallet } = await networkHelpers.loadFixture(deploy);
    const from = await publicClient.getBlockNumber();
    await asAgent.write.agentReleaseMilestone([escrow.address, 0n, 0n]);
    const events = await publicClient.getContractEvents({
      address: wallet.address,
      abi: wallet.abi,
      eventName: "AgentMilestoneReleased",
      fromBlock: from,
      strict: true,
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].args.amount, usd(300));
  });
});
