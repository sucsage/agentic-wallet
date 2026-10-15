import { notFound } from "next/navigation";
import { MockupApp } from "@/components/mockup-app";
import type { ScreenName } from "@/components/mockup-ui";

const screens: Record<string, ScreenName> = {
  approvals: "รออนุมัติ",
  summary: "กระเป๋",
  contacts: "เพื่อน",
  friends: "เพื่อน",
  groups: "กลุ่ม",
  policy: "นโยบาย & Allowlist",
  profile: "ความเป็นส่วนตัว",
};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const initialScreen = screens[section];
  if (!initialScreen) notFound();
  return <MockupApp initialScreen={initialScreen} />;
}
