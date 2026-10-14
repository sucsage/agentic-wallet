import "server-only";

import { type Address, type Hex, getAddress } from "viem";

import { publicClient, roleAddresses } from "./chain";
import { config } from "./config";
import { db } from "./db";

/**
 * Records a wallet the user just deployed and links it to them. The Wallet row is normally written
 * by the indexer; we upsert it here so the link exists right away, and leave the indexer's data
 * alone if it got there first.
 */
export async function linkNewWallet(userId: string, address: Address, txHash: Hex, token: Address = config.contracts.usdc) {
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
      token,
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

/**
 * The one wallet that is "the user's": the wallet their bank account pays for. Every part of the
 * app (chat, friends, policy, deals) must use this, so they never act on different wallets.
 * Falls back to the oldest linked wallet for users from before bank-backed wallets.
 */
export async function primaryWalletAddress(userId: string): Promise<Address | null> {
  const links = await db.userWallet.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (links.length === 0) return null;
  const backed = await db.bankAccount.findMany({
    where: { customer: { userId }, ownerAddress: { in: links.map((l) => l.walletAddress.toLowerCase()) } },
    select: { ownerAddress: true },
  });
  const primary = backed.length
    ? links.find((l) => l.walletAddress.toLowerCase() === backed[0].ownerAddress)
    : links[0];
  return getAddress((primary ?? links[0]).walletAddress);
}

/** The user's wallets, primary first, with open proposal counts from the indexed tables. */
export async function listUserWallets(userId: string) {
  const [rows, primary] = await Promise.all([
    db.userWallet.findMany({
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
    }),
    primaryWalletAddress(userId),
  ]);
  // Screens use wallets[0]; it must be the primary wallet.
  return rows.sort((a, b) => Number(b.walletAddress === primary) - Number(a.walletAddress === primary));
}
