import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, keccak256, toHex, zeroHash } from "viem";

describe("ChainAnchor", async function () {
  const { viem } = await network.create();
  const [server, stranger] = await viem.getWalletClients();
  const ROOT = keccak256(toHex("heads"));

  it("records roots from the anchorer only, in order", async function () {
    const anchor = await viem.deployContract("ChainAnchor", [server.account.address]);
    assert.equal(getAddress(await anchor.read.anchorer()), getAddress(server.account.address));
    await anchor.write.anchor([ROOT, 3n]);
    await anchor.write.anchor([keccak256(toHex("later")), 5n]);
    assert.equal(await anchor.read.anchorCount(), 2n);
    const first = await anchor.read.getAnchor([0n]);
    assert.equal(first.root, ROOT);
    assert.equal(first.heads, 3n);
    assert.ok(first.at > 0n);

    const asStranger = await viem.getContractAt("ChainAnchor", anchor.address, { client: { wallet: stranger } });
    await assert.rejects(asStranger.write.anchor([ROOT, 1n]), /NotAnchorer/);
    await assert.rejects(anchor.write.anchor([zeroHash, 1n]), /EmptyRoot/);
  });
});
