import { MockupApp } from "@/components/mockup-app";

export default async function DealDetailPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  return <MockupApp initialRoute="deal-detail" initialDealId={dealId} />;
}
