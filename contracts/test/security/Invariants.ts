// Property tests (owner: @NawaratKhem). Random but seeded sequences of calls, where reverts are expected
// and ignored; after every step the safety properties below must still hold. A failure prints the seed
// and step, so it can be replayed. No external fuzzer is needed: this runs inside `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { type Hex, keccak256, maxUint256, toHex, zeroHash } from "viem";

/** Small deterministic PRNG (mulberry32). */
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
let succeeded = 0; // calls that did not revert, to prove the sequences actually do something
const attempt = async (call: () => Promise<unknown>) => {
  try {
    await call();
    succeeded++;
    return true;
  } catch {
    return false;
  }
};

const SEEDS = [1, 2, 3, 4];
const STEPS = 150;
const HOUR = 3600n;
const DAY = 24n * HOUR;
const id = (label: string) => keccak256(toHex(label));

describe("MockTHB properties", async function () {
  const { viem, networkHelpers } = await network.create();
  const [admin, bank, holder, seller, attacker] = await viem.getWalletClients();
  const people = [holder, seller, attacker];
  const MAX_TX = 500_00n;
  const DAILY = 1_000_00n;

  for (const seed of SEEDS) {
    it(`seed ${seed}: supply equals minted minus redeemed, balances add up, mint caps and roles hold`, async () => {
      const token = await viem.deployContract("MockTHB", [admin.account.address, bank.account.address, MAX_TX, DAILY]);
      const as = (c: typeof bank) => viem.getContractAt("MockTHB", token.address, { client: { wallet: c } });
      const asBank = await as(bank);
      const asAdmin = await as(admin);
      const holders = new Map<Hex, Awaited<ReturnType<typeof as>>>();
      for (const p of people) holders.set(p.account.address, await as(p));

      const r = rng(seed);
      let minted = 0n;
      let redeemed = 0n;
      const usedIds = new Set<string>();
      let counter = 0;
      succeeded = 0;

      for (let step = 0; step < STEPS; step++) {
        const where = `seed ${seed}, step ${step}`;
        const action = pick(r, ["mint", "mint", "mintOverCap", "mintReuse", "attackerMint", "redeem", "transfer", "pause", "unpause", "time"] as const);
        const who = pick(r, people);
        const amount = BigInt(1 + Math.floor(r() * 400)) * 100n;

        if (action === "mint") {
          const fundingId = id(`f-${seed}-${counter++}`);
          if (await attempt(() => asBank.write.mint([who.account.address, amount, fundingId]))) {
            minted += amount;
            usedIds.add(fundingId);
          }
        } else if (action === "mintOverCap") {
          const ok = await attempt(() => asBank.write.mint([who.account.address, MAX_TX + 1n, id(`o-${seed}-${counter++}`)]));
          assert.equal(ok, false, `${where}: a mint above the per-transaction cap succeeded`);
        } else if (action === "mintReuse" && usedIds.size > 0) {
          const reused = pick(r, [...usedIds]) as Hex;
          const ok = await attempt(() => asBank.write.mint([who.account.address, 100n, reused]));
          assert.equal(ok, false, `${where}: a funding id was minted twice`);
        } else if (action === "attackerMint") {
          const ok = await attempt(() => holders.get(attacker.account.address)!.write.mint([attacker.account.address, 100n, id(`a-${seed}-${counter++}`)]));
          assert.equal(ok, false, `${where}: a non-bank key minted`);
        } else if (action === "redeem") {
          const own = await token.read.balanceOf([who.account.address]);
          const burn = own === 0n ? amount : (own * BigInt(1 + Math.floor(r() * 100))) / 100n || 1n;
          if (await attempt(() => holders.get(who.account.address)!.write.redeem([burn, id(`r-${seed}-${counter++}`)]))) redeemed += burn;
        } else if (action === "transfer") {
          const to = pick(r, people);
          const own = await token.read.balanceOf([who.account.address]);
          if (own > 0n) await attempt(() => holders.get(who.account.address)!.write.transfer([to.account.address, own / 2n + 1n > own ? own : own / 2n + 1n]));
        } else if (action === "pause") {
          await attempt(() => asBank.write.pause());
        } else if (action === "unpause") {
          await attempt(() => asAdmin.write.unpause());
        } else {
          await networkHelpers.time.increase(pick(r, [HOUR, 6n * HOUR, DAY, 2n * DAY]));
        }

        // Properties, after every step.
        const supply = await token.read.totalSupply();
        assert.equal(supply, minted - redeemed, `${where}: supply drifted from minted minus redeemed`);
        let sum = 0n;
        for (const p of people) sum += await token.read.balanceOf([p.account.address]);
        assert.equal(sum, supply, `${where}: balances do not add up to the supply`);
        const today = BigInt(Math.floor(Number((await (await viem.getPublicClient()).getBlock()).timestamp) / 86400));
        assert.ok((await token.read.mintedOnDay([today])) <= DAILY, `${where}: the daily mint cap was exceeded`);
      }
      // Guard against a vacuous run: the sequence must actually have minted and moved tokens.
      assert.ok(minted > 0n && succeeded >= 15, `seed ${seed}: only ${succeeded} calls succeeded; the sequence is not exercising the contract`);
    });
  }
});

describe("FileEscrow properties", async function () {
  const { viem, networkHelpers } = await network.create();
  const [buyer, seller, arbiter] = await viem.getWalletClients();
  const REVIEW = 2n * DAY;
  const START = 10_000n * 1_000_000n;
  const FILE_HASH = keccak256(toHex("work.svg"));
  const KEY: Hex = `0x${"cd".repeat(48)}`;
  const file = (n: bigint) => ({ amount: n * 1_000_000n, hasFile: true, workHash: zeroHash });
  const plain = (n: bigint) => ({ amount: n * 1_000_000n, hasFile: false, workHash: zeroHash });
  const committed = (n: bigint) => ({ amount: n * 1_000_000n, hasFile: true, workHash: FILE_HASH });

  for (const seed of SEEDS) {
    it(`seed ${seed}: tokens are conserved and the escrow always holds exactly the unsettled milestones`, async () => {
      const usdc = await viem.deployContract("MockUSDC");
      const escrow = await viem.deployContract("FileEscrow");
      await usdc.write.mint([buyer.account.address, START]);
      const asBuyerToken = await viem.getContractAt("MockUSDC", usdc.address, { client: { wallet: buyer } });
      await asBuyerToken.write.approve([escrow.address, maxUint256]);
      const as = (c: typeof buyer) => viem.getContractAt("FileEscrow", escrow.address, { client: { wallet: c } });
      const [b, s, a] = [await as(buyer), await as(seller), await as(arbiter)];
      const r = rng(seed * 101);
      succeeded = 0;
      const seen = new Set<number>(); // milestone statuses reached

      for (let step = 0; step < STEPS; step++) {
        const where = `seed ${seed}, step ${step}`;
        const count = Number(await escrow.read.dealCount());
        const dealId = BigInt(count === 0 ? 0 : Math.floor(r() * count));
        const index = BigInt(Math.floor(r() * 2));
        const anyAction = pick(r, [
          "offerToBuy", "offerToSell", "accept", "cancel", "deliver", "approve", "releaseKey",
          "claim", "refund", "dispute", "reclaim", "resolve", "time",
        ] as const);
        // Mostly take a move that is valid for the milestone's current state, so the sequences get deep
        // into the state machine; sometimes take a random (usually invalid) move to test the refusals.
        let action: typeof anyAction = anyAction;
        if (count === 0) action = r() < 0.5 ? "offerToBuy" : "offerToSell";
        else if (r() < 0.8) {
          const deal = await escrow.read.getDeal([dealId]);
          const ms = await escrow.read.getMilestone([dealId, index]).catch(() => undefined);
          if (deal.status === 0) action = r() < 0.9 ? "accept" : "cancel";
          else if (deal.status === 1 && ms) {
            const next: Record<number, readonly (typeof anyAction)[]> = {
              0: ["deliver"],
              1: ["approve", "approve", "dispute", "claim", "time", "refund"],
              2: ["releaseKey", "releaseKey", "time", "reclaim"],
              3: ["approve", "dispute", "claim", "time"],
              5: ["resolve"],
            };
            action = pick(r, next[ms.status] ?? ["time"]);
          } else if (count < 4 && r() < 0.5) action = r() < 0.5 ? "offerToBuy" : "offerToSell";
        }
        const acceptor = async () => {
          const deal = await escrow.read.getDeal([dealId]);
          return deal.creator.toLowerCase() === buyer.account.address.toLowerCase() ? s : b;
        };
        const creator = async () => {
          const deal = await escrow.read.getDeal([dealId]);
          return deal.creator.toLowerCase() === buyer.account.address.toLowerCase() ? b : s;
        };

        if (action === "offerToBuy" && count < 4) {
          await attempt(() => b.write.offerToBuy([seller.account.address, arbiter.account.address, usdc.address, [file(100n), plain(50n)], REVIEW, "t"]));
        } else if (action === "offerToSell" && count < 4) {
          await attempt(() => s.write.offerToSell([buyer.account.address, arbiter.account.address, usdc.address, [committed(100n), plain(50n)], REVIEW, "t"]));
        } else if (action === "accept") {
          if (count > 0) await attempt(async () => (await acceptor()).write.accept([dealId]));
        } else if (action === "cancel") {
          if (count > 0) await attempt(async () => (await creator()).write.cancel([dealId]));
        } else if (action === "deliver") {
          await attempt(() => s.write.deliver([dealId, index, FILE_HASH, "ipfs://x"]));
        } else if (action === "approve") {
          await attempt(() => b.write.approve([dealId, index]));
        } else if (action === "releaseKey") {
          await attempt(() => s.write.releaseKey([dealId, index, KEY]));
        } else if (action === "claim") {
          await attempt(() => s.write.claim([dealId, index]));
        } else if (action === "refund") {
          if (r() < 0.5) await attempt(() => s.write.refund([dealId, index]));
        } else if (action === "dispute") {
          await attempt(() => b.write.dispute([dealId, index]));
        } else if (action === "reclaim") {
          await attempt(() => b.write.reclaim([dealId, index]));
        } else if (action === "resolve") {
          await attempt(() => a.write.resolve([dealId, index, r() < 0.5]));
        } else if (action === "time") {
          await networkHelpers.time.increase(pick(r, [HOUR, REVIEW / 2n, REVIEW + 1n]));
        }

        // Properties, after every step.
        let locked = 0n;
        const total = Number(await escrow.read.dealCount());
        for (let d = 0; d < total; d++) {
          const deal = await escrow.read.getDeal([BigInt(d)]);
          if (deal.status === 0 && deal.creator.toLowerCase() === deal.buyer.toLowerCase()) locked += deal.total; // Proposed buyer offer
          if (deal.status === 1) {
            for (let m = 0; m < Number(deal.milestoneCount); m++) {
              const ms = await escrow.read.getMilestone([BigInt(d), BigInt(m)]);
              seen.add(ms.status);
              if (ms.status !== 4 && ms.status !== 6) locked += ms.amount; // not Released / Refunded
            }
          }
        }
        const held = await usdc.read.balanceOf([escrow.address]);
        assert.equal(held, locked, `${where}: escrow holds ${held} but unsettled milestones add up to ${locked}`);
        const sum = held + (await usdc.read.balanceOf([buyer.account.address])) + (await usdc.read.balanceOf([seller.account.address])) + (await usdc.read.balanceOf([arbiter.account.address]));
        assert.equal(sum, START, `${where}: tokens were created or destroyed`);
      }
      console.log(`      seed ${seed}: ${succeeded} calls succeeded, milestone statuses reached: ${[...seen].sort().join(",")}`);
      assert.ok(succeeded >= 20 && (seen.has(4) || seen.has(6)), `seed ${seed}: the sequence never settled a milestone`);
    });
  }
});
