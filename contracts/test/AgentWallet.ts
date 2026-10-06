import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { encodeFunctionData, getAddress, keccak256, toHex } from "viem";

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

    const as = async <T extends "AgentWallet" | "MilestoneEscrow">(
      name: T,
      address: `0x${string}`,
      client: typeof owner,
    ) => viem.getContractAt(name, address, { client: { wallet: client } });

    return {
      usdc,
      escrow,
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
