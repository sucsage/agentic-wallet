// Finding AW-H-01: pre-queue simulations can return a stale wallet address for concurrent creations.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";

describe("AW-H-01 stale factory simulation return", async function () {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [owner] = await viem.getWalletClients();

  it("two pre-send simulations predict one address, but the second transaction deploys another", async () => {
    const token = await viem.deployContract("MockUSDC");
    const factory = await viem.deployContract("AgentWalletFactory");
    const config = {
      owner: owner.account.address,
      token: token.address,
      agent: "0x0000000000000000000000000000000000000000" as const,
      sessionExpiresAt: 0n,
      maxPerTx: 0n,
      dailyLimit: 0n,
      approvers: [],
      threshold: 0n,
      recipients: [],
      escrows: [],
    };
    const call = {
      address: factory.address,
      abi: factory.abi,
      functionName: "createWallet" as const,
      args: [config, 0n] as const,
      account: owner.account,
    };

    // This is the ordering in web/src/lib/chain.ts: every request simulates before
    // entering the role queue, so concurrent requests can both reach this point.
    const firstSimulation = await publicClient.simulateContract(call);
    const secondSimulation = await publicClient.simulateContract(call);
    assert.equal(secondSimulation.result, firstSimulation.result);

    const firstHash = await owner.writeContract(call);
    await publicClient.waitForTransactionReceipt({ hash: firstHash });
    const secondHash = await owner.writeContract(call);
    await publicClient.waitForTransactionReceipt({ hash: secondHash });

    const deployed = await factory.read.walletsOf([owner.account.address]);
    assert.equal(deployed.length, 2);
    assert.equal(firstSimulation.result, deployed[0]);
    assert.notEqual(secondSimulation.result, deployed[1]);
  });
});
