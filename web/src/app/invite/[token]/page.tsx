import type { Metadata } from "next";

import { InvitePage } from "@/components/invite-page";

export const metadata: Metadata = {
  title: "Seller link · Kravii Pay",
  // The link is a credential: never leak it to other sites or search engines.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function SellerInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InvitePage token={token} />;
}
