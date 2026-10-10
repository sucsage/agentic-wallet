import "server-only";

import type { Address, Hex } from "viem";

import { publicClient, roleAddresses } from "./chain";
import { config } from "./config";
import { db } from "./db";

/**
 * Records a wallet the user just deployed and links it to them. The Wallet row is normally written
 * by the indexer; we upsert it here so the link exists right away, and leave the indexer's data
 * alone if it got there first.
 */
export async function linkNewWallet(userId: string, address: Address, txHash: Hex) {
  const receipt = await publicClient().getTransactionReceipt({ hash: txHash });
  const block = await publicClient().getBlock({ blockNumber: receipt.blockNumber });
  const roles = roleAddresses();
  await db.wallet.upsert({
    where: { address },
    update: {},
    create: {
      address,
      owner: roles.owner,
      agent: roles.agent,
      creator: receipt.from,
      token: config.contracts.usdc,
      createdBlock: receipt.blockNumber,
      createdAt: new Date(Number(block.timestamp) * 1000),
    },
  });
  await db.userWallet.upsert({
    where: { userId_walletAddress: { userId, walletAddress: address } },
    update: {},
    create: { userId, walletAddress: address, role: "OWNER" },
  });
}

/** The user's wallets, newest first, with open proposal counts from the indexed tables. */
export async function listUserWallets(userId: string) {
  return db.userWallet.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      wallet: {
        select: {
          createdAt: true,
          _count: { select: { proposals: { where: { status: "OPEN" } }, events: true } },
        },
      },
    },
  });
}
