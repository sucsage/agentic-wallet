import { redirect } from "next/navigation";

import { ProfileView } from "@/components/profile-view";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { listUserWallets } from "@/lib/user-wallets";

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.user.id;
  const [profile, accounts, wallets] = await Promise.all([
    db.profile.findUnique({ where: { userId } }),
    db.account.findMany({ where: { userId }, select: { providerId: true } }),
    listUserWallets(userId),
  ]);

  return (
    <ProfileView
      user={{ name: session.user.name, email: session.user.email, image: session.user.image ?? null }}
      profile={{
        firstName: profile?.firstName ?? "",
        lastName: profile?.lastName ?? "",
        phone: profile?.phone ?? "",
        dateOfBirth: profile?.dateOfBirth?.toISOString().slice(0, 10) ?? "",
        organization: profile?.organization ?? "",
        jobTitle: profile?.jobTitle ?? "",
        country: profile?.country ?? "",
        locale: profile?.locale === "th" ? "th" : "en",
      }}
      providers={accounts.map((a) => a.providerId)}
      wallets={wallets.map((w) => ({
        address: w.walletAddress,
        role: w.role,
        createdAt: w.wallet.createdAt.toISOString(),
        openProposals: w.wallet._count.proposals,
      }))}
    />
  );
}
