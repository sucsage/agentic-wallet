import { MockupApp } from "@/components/mockup-app";
export default async function Page({params}:{params:Promise<{group:string}>}) {
  const {group}=await params;
  return <MockupApp initialScreen="กลุ่ม" initialGroupWallet={group==="plc-team" ? "PLC Team" : "Nok × Gun"}/>;
}
