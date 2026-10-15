import { MockupApp } from "@/components/mockup-app";

/** A group's join link (from its QR): the Groups page opens with the invitation on top. */
export default async function JoinGroupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <MockupApp initialScreen="กลุ่ม" initialJoinToken={token} />;
}
