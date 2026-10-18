import { MockupApp } from "@/components/mockup-app";

/** A deal preview (the AI's draft) on its own page: read it, then Confirm or Discard. */
export default async function DraftPreviewPage({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  return <MockupApp initialRoute="draft-detail" initialDealId={draftId} />;
}
