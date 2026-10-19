import type { Metadata } from "next";

import { PayPage } from "@/components/pay-page";

export const metadata: Metadata = {
  title: "Buyer link · Kravii Pay",
  // The link is a credential: never leak it to other sites or search engines.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function BuyerInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PayPage token={token} />;
}
