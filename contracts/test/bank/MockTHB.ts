import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, keccak256, toHex } from "viem";

const thb = (baht: number) => BigInt(Math.round(baht * 100)); // satang
const DAY = 24 * 60 * 60;
const id = (label: string) => keccak256(toHex(label));

describe("MockTHB", async function () {
  const { viem, networkHelpers } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [admin, bank, holder, seller, attacker] = await viem.getWalletClients();

  async function deploy() {
    const token = await viem.deployContract("MockTHB", [admin.account.address, bank.account.address, thb(50_000), thb(100_000)]);
    const as = (client: typeof admin) => viem.getContractAt("MockTHB", token.address, { client: { wallet: client } });
    return {
      token,
      asBank: await as(bank),
      asHolder: await as(holder),
      asSeller: await as(seller),
      asAttacker: await as(attacker),
    };
  }

  it("MockCNY is the same token under its own name, with the same minting rules", async () => {
    const cny = await viem.deployContract("MockCNY", [admin.account.address, bank.account.address, thb(50_000), thb(100_000)]);
    assert.equal(await cny.read.name(), "Mock Chinese Yuan");
    assert.equal(await cny.read.symbol(), "mCNY");
    assert.equal(await cny.read.decimals(), 2);
    const asBank = await viem.getContractAt("MockCNY", cny.address, { client: { wallet: bank } });
    await asBank.write.mint([holder.account.address, 12_345n, id("cny-1")]);
    assert.equal(await cny.read.balanceOf([holder.account.address]), 12_345n);
    const asAttacker = await viem.getContractAt("MockCNY", cny.address, { client: { wallet: attacker } });
    await viem.assertions.revertWithCustomError(asAttacker.write.mint([attacker.account.address, 1n, id("cny-2")]), cny, "AccessControlUnauthorizedAccount");
  });

  it("counts in satang, like the Mock Bank", async () => {
    const { token } = await networkHelpers.loadFixture(deploy);
    assert.equal(await token.read.decimals(), 2);
  });

  describe("Minting: only the bank, once per funding record, within caps", () => {
    it("mints once per funding id: a retry after a timeout can never mint twice", async () => {
      const { token, asBank } = await networkHelpers.loadFixture(deploy);
      await viem.assertions.emitWithArgs(
        asBank.write.mint([holder.account.address, thb(5_000), id("deal-123:fund")]),
        token,
        "Minted",
        [id("deal-123:fund"), getAddress(holder.account.address), thb(5_000)],
      );
      assert.equal(await token.read.minted([id("deal-123:fund")]), true);

      await viem.assertions.revertWithCustomErrorWithArgs(
        asBank.write.mint([holder.account.address, thb(5_000), id("deal-123:fund")]),
        token,
        "IdAlreadyUsed",
        [id("deal-123:fund")],
      );
      assert.equal(await token.read.balanceOf([holder.account.address]), thb(5_000));

      await viem.assertions.revertWithCustomError(
        asBank.write.mint([holder.account.address, thb(1), `0x${"00".repeat(32)}`]),
        token,
        "InvalidId",
      );
      await viem.assertions.revertWithCustomError(
        asBank.write.mint([holder.account.address, 0n, id("deal-124:fund")]),
        token,
        "InvalidAmount",
      );
    });

    it("nobody else can mint, not even the admin", async () => {
      const { token, asAttacker } = await networkHelpers.loadFixture(deploy);
      await viem.assertions.revertWithCustomError(
        asAttacker.write.mint([attacker.account.address, thb(1_000_000), id("free money")]),
        token,
        "AccessControlUnauthorizedAccount",
      );
      await viem.assertions.revertWithCustomError(
        token.write.mint([admin.account.address, thb(1), id("admin mint")]),
        token,
        "AccessControlUnauthorizedAccount",
      );
      assert.equal(await token.read.totalSupply(), 0n);
    });

    it("caps what a stolen bank key can mint, per mint and per day", async () => {
      const { token, asBank } = await networkHelpers.loadFixture(deploy);
      await viem.assertions.revertWithCustomErrorWithArgs(
        asBank.write.mint([holder.account.address, thb(50_001), id("too big")]),
        token,
        "ExceedsMintPerTx",
        [thb(50_001), thb(50_000)],
      );

      await asBank.write.mint([holder.account.address, thb(50_000), id("a")]);
      await asBank.write.mint([holder.account.address, thb(50_000), id("b")]);
      await viem.assertions.revertWithCustomErrorWithArgs(
        asBank.write.mint([holder.account.address, thb(1), id("c")]),
        token,
        "ExceedsDailyMintCap",
        [thb(1), 0n],
      );

      await networkHelpers.time.increase(DAY);
      await asBank.write.mint([holder.account.address, thb(1), id("c")]);
      assert.equal(await token.read.totalSupply(), thb(100_001));
    });
  });

  describe("Redeeming: only the holder burns, once per id", () => {
    it("a holder redeems its own tokens; that holder cannot reuse the id, others can", async () => {
      const { token, asBank, asSeller, asHolder } = await networkHelpers.loadFixture(deploy);
      await asBank.write.mint([seller.account.address, thb(5_000), id("fund-1")]);
      await asBank.write.mint([holder.account.address, thb(100), id("fund-2")]);

      await viem.assertions.emitWithArgs(
        asSeller.write.redeem([thb(5_000), id("deal-123:release:seller")]),
        token,
        "Redeemed",
        [getAddress(seller.account.address), id("deal-123:release:seller"), thb(5_000)],
      );
      assert.equal(await token.read.balanceOf([seller.account.address]), 0n);
      assert.equal(await token.read.redeemed([seller.account.address, id("deal-123:release:seller")]), true);

      await viem.assertions.revertWithCustomErrorWithArgs(
        asSeller.write.redeem([thb(1), id("deal-123:release:seller")]),
        token,
        "IdAlreadyUsed",
        [id("deal-123:release:seller")],
      );
      // Ids are per holder, so nobody can block someone else's payout by using their id first.
      await asHolder.write.redeem([thb(100), id("deal-123:release:seller")]);
    });

    it("the bank key cannot burn anyone's tokens", async () => {
      const { token, asBank } = await networkHelpers.loadFixture(deploy);
      await asBank.write.mint([seller.account.address, thb(5_000), id("fund-1")]);
      // redeem only ever burns the caller's own balance, and the bank holds none.
      await viem.assertions.revertWithCustomError(
        asBank.write.redeem([thb(5_000), id("steal")]),
        token,
        "ERC20InsufficientBalance",
      );
      assert.equal(await token.read.balanceOf([seller.account.address]), thb(5_000));
    });
  });

  describe("Emergency pause", () => {
    it("bank or admin stops minting and redeeming, transfers keep settling deals, only the admin resumes", async () => {
      const { token, asBank, asHolder, asAttacker } = await networkHelpers.loadFixture(deploy);
      await asBank.write.mint([holder.account.address, thb(1_000), id("fund-1")]);

      await viem.assertions.revertWithCustomError(asAttacker.write.pause(), token, "AccessControlUnauthorizedAccount");
      await asBank.write.pause();

      await viem.assertions.revertWithCustomError(
        asBank.write.mint([holder.account.address, thb(1), id("fund-2")]),
        token,
        "EnforcedPause",
      );
      await viem.assertions.revertWithCustomError(asHolder.write.redeem([thb(1), id("r-1")]), token, "EnforcedPause");
      await asHolder.write.transfer([seller.account.address, thb(400)]);
      assert.equal(await token.read.balanceOf([seller.account.address]), thb(400));

      await viem.assertions.revertWithCustomError(asBank.write.unpause(), token, "AccessControlUnauthorizedAccount");
      await token.write.unpause();
      await asBank.write.mint([holder.account.address, thb(1), id("fund-2")]);
    });
  });

  describe("Admin", () => {
    it("only the admin sets caps, and they must make sense", async () => {
      const { token, asAttacker } = await networkHelpers.loadFixture(deploy);
      await viem.assertions.revertWithCustomError(
        asAttacker.write.setMintCaps([thb(10_000_000), thb(10_000_000)]),
        token,
        "AccessControlUnauthorizedAccount",
      );
      await viem.assertions.revertWithCustomError(token.write.setMintCaps([0n, thb(1)]), token, "InvalidCaps");
      await viem.assertions.revertWithCustomError(token.write.setMintCaps([thb(2), thb(1)]), token, "InvalidCaps");
      await token.write.setMintCaps([thb(1_000), thb(5_000)]);
      assert.equal(await token.read.maxMintPerTx(), thb(1_000));
    });

    it("the admin and the bank must be different keys", async () => {
      await assert.rejects(
        viem.deployContract("MockTHB", [admin.account.address, admin.account.address, thb(1), thb(1)]),
        /AdminMustNotMint/,
      );
    });
  });

  it("supply always equals minted minus redeemed: what the reconciler checks against the reserve", async () => {
    const { token, asBank, asSeller, asHolder } = await networkHelpers.loadFixture(deploy);
    await asBank.write.mint([holder.account.address, thb(5_000), id("f1")]);
    await asBank.write.mint([seller.account.address, thb(1_250.5), id("f2")]);
    await asHolder.write.transfer([seller.account.address, thb(2_000)]);
    await asSeller.write.redeem([thb(3_000), id("r1")]);

    const block = await publicClient.getBlockNumber();
    const supply = await token.read.totalSupply({ blockNumber: block });
    assert.equal(supply, thb(5_000) + thb(1_250.5) - thb(3_000));
  });
});
