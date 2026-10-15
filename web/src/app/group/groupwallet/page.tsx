import { MockupApp } from "@/components/mockup-app";

export default async function GroupWalletPage({ searchParams }: { searchParams: Promise<{ name?: string }> }) {
  const { name } = await searchParams;
  return <MockupApp initialScreen="กลุ่ม" initialGroupWallet={name || "PLC Team"} />;
}
