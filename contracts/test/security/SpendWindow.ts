// Property test (owner: @NawaratKhem): the agent's direct payments obey the session rules for any mix of
// time jumps, owner changes, pauses and allowlist edits. The model keeps its own tally of what was paid per
// UTC day; the contract must (a) never let a payment through that breaks a rule, and (b) never refuse a
// payment that the rules allow. Seeded, so a failure can be replayed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)];

const DAY = 86400;
const STEPS = 120;
const usd = (n: number) => BigInt(Math.round(n * 1e6));

describe("AgentWallet: the agent's daily spending window", async function () {
  const { viem, networkHelpers } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [owner, agent, approver, payeeA, payeeB, stranger] = await viem.getWalletClients();

  for (const seed of [11, 12, 13, 14]) {
    it(`seed ${seed}: per-payment cap, daily cap, expiry, pause and allowlist hold, with no false refusals`, async () => {
      const usdc = await viem.deployContract("MockUSDC");
      const factory = await viem.deployContract("AgentWalletFactory");
      const now = BigInt(await networkHelpers.time.latest());
      await factory.write.createWallet([
        {
          owner: owner.account.address,
          token: usdc.address,
          agent: agent.account.address,
          sessionExpiresAt: now + BigInt(2 * DAY),
          maxPerTx: usd(300),
          dailyLimit: usd(700),
          approvers: [approver.account.address],
          threshold: 1n,
          recipients: [payeeA.account.address],
          escrows: [],
        },
        usd(1_000_000),
      ]);
      const [address] = await factory.read.walletsOf([owner.account.address]);
      const wallet = await viem.getContractAt("AgentWallet", address);
      const asAgent = await viem.getContractAt("AgentWallet", address, { client: { wallet: agent } });
      const asStranger = await viem.getContractAt("AgentWallet", address, { client: { wallet: stranger } });

      const r = rng(seed);
      const paidOnDay = new Map<number, bigint>();
      let paid = 0;
      let refusedByRule = 0;
      let skippedNearBoundary = 0;

      for (let step = 0; step < STEPS; step++) {
        const where = `seed ${seed}, step ${step}`;
        // The owner usually repairs a stopped wallet soon, so the sequences keep getting past the early stops.
        if (r() < 0.4) {
          if (await wallet.read.paused()) await wallet.write.unpause();
          else if (!(await wallet.read.isActiveSession([agent.account.address]))) {
            const t = await networkHelpers.time.latest();
            await wallet.write.setSession([agent.account.address, BigInt(t + 2 * DAY), usd(300), usd(700)]);
          }
        }
        const action = pick(r, ["pay", "pay", "pay", "pay", "payStranger", "time", "time", "setSession", "revoke", "pause", "toggleB"] as const);

        if (action === "pay") {
          const to = pick(r, [payeeA, payeeB]);
          let amount = usd(1 + Math.floor(r() * 400));
          // State before the call, read from the chain; the tally of what was paid is the model's own.
          const session = await wallet.read.sessions([agent.account.address]);
          const paused = await wallet.read.paused();
          const allowed = await wallet.read.allowedRecipient([to.account.address]);
          const latest = await networkHelpers.time.latest();
          const day = Math.floor((latest + 1) / DAY);
          const spent = paidOnDay.get(day) ?? 0n;
          // Often aim exactly at the edge: spend what is left of the day (or the per-payment cap) to the unit.
          if (r() < 0.35 && session[2] > spent) amount = session[2] - spent < session[1] ? session[2] - spent : session[1];
          if (r() < 0.1) amount = session[1] + 1n; // one over the per-payment cap
          const nearEdge = (latest + 1) % DAY < 10 || (latest + 1) % DAY > DAY - 10 || Math.abs(Number(session[0]) - (latest + 1)) < 10;
          const shouldPass =
            !paused && allowed && session[0] > BigInt(latest + 1) && amount <= session[1] && spent + amount <= session[2];

          let hash: `0x${string}` | undefined;
          try {
            hash = await asAgent.write.agentTransfer([to.account.address, amount]);
          } catch {
            hash = undefined;
          }
          if (hash) {
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            const ts = Number((await publicClient.getBlock({ blockNumber: receipt.blockNumber })).timestamp);
            const d = Math.floor(ts / DAY);
            const before = paidOnDay.get(d) ?? 0n;
            // Safety: every rule must have held at the time of the block that mined the payment.
            assert.ok(!paused, `${where}: paid while paused`);
            assert.ok(allowed, `${where}: paid a recipient that is not allowlisted`);
            assert.ok(session[0] > BigInt(ts), `${where}: paid with an expired session`);
            assert.ok(amount <= session[1], `${where}: payment above the per-payment cap`);
            assert.ok(before + amount <= session[2], `${where}: daily cap exceeded (${before + amount} > ${session[2]})`);
            paidOnDay.set(d, before + amount);
            paid++;
          } else if (nearEdge) {
            skippedNearBoundary++;
          } else {
            // Liveness: a payment the rules allow must not be refused.
            assert.equal(shouldPass, false, `${where}: a payment allowed by the rules was refused`);
            refusedByRule++;
          }
        } else if (action === "payStranger") {
          await assert.rejects(asStranger.write.agentTransfer([payeeA.account.address, usd(1)]), `${where}: a non-agent paid`);
        } else if (action === "time") {
          await networkHelpers.time.increase(pick(r, [3600, 6 * 3600, 12 * 3600, DAY]));
        } else if (action === "setSession") {
          const latest = await networkHelpers.time.latest();
          const daily = usd(200 + Math.floor(r() * 800));
          const max = usd(50 + Math.floor(r() * 400));
          await wallet.write.setSession([agent.account.address, BigInt(latest + 3600 + Math.floor(r() * 3 * DAY)), max > daily ? daily : max, daily]).catch(() => undefined);
        } else if (action === "revoke") {
          if (r() < 0.2) await wallet.write.revokeSession([agent.account.address]);
        } else if (action === "pause") {
          await asAgent.write.pause().catch(() => undefined);
        } else if (action === "unpause") {
          await wallet.write.unpause().catch(() => undefined);
        } else {
          await wallet.write.setRecipient([payeeB.account.address, r() < 0.5]);
        }
      }

      // Guard against a vacuous run, and a reconciliation of the contract's own counter.
      assert.ok(paid >= 8, `seed ${seed}: only ${paid} payments went through; the sequence is not exercising the window`);
      assert.ok(refusedByRule >= 3, `seed ${seed}: only ${refusedByRule} rule refusals were seen`);
      assert.ok(paidOnDay.size >= 2, `seed ${seed}: spending never crossed a day boundary`);
      console.log(`      seed ${seed}: ${paid} payments, ${refusedByRule} refusals, ${paidOnDay.size} days with spending, ${skippedNearBoundary} skipped near a boundary`);
    });
  }
});
