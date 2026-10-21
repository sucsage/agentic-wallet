import type { Metadata } from "next";

import { ApplyPage } from "@/components/apply-page";

export const metadata: Metadata = {
  title: "Open call",
  robots: { index: false, follow: false },
};

export default async function PublicPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ApplyPage slug={slug} />;
}
