import { notFound, redirect } from "next/navigation";
import { getAddress, isAddress } from "viem";

import { Workspace } from "@/components/workspace";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function WorkspacePage({ params }: PageProps<"/w/[address]">) {
  const { address } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isAddress(address)) notFound();
  const link = await db.userWallet.findUnique({
    where: { userId_walletAddress: { userId: session.user.id, walletAddress: getAddress(address) } },
  });
  if (!link) notFound();
  return <Workspace address={address} />;
}
