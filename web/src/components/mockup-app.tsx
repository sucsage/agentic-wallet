"use client";

import { OperationOutlet, useOperation, useOperationActive } from "./operation-loading";
import { useState } from "react";
import { useAppRouter as useRouter, useNavigationPending } from "./navigation";
import { WorkspaceFrame } from "./workspace-frame";
import { LoadingSkeleton, WorkspaceSkeleton } from "./loading-skeleton";
import { Header, type ScreenName } from "./mockup-ui";
import {
  AiDecisionScreen, ApprovalsScreen, BankAuthorizeScreen, CreateDealScreen, DealDetailScreen, DealsScreen,
  DisputeScreen, FriendsScreen, GroupsScreen, LandingScreen, LoginScreen, OfferScreen, PolicyScreen, SummaryScreen,
  PrivacyScreen, SubmitWorkScreen, WalletScreen,
} from "./mockup-screens";
import type { BankChoice } from "./mockup-screens";
import "./mockup.css";
import "./v08.css";

type Route = "landing" | "login" | "bank-authorize" | `รายละเอียดดีล ${string}` | ScreenName;

export function MockupApp({ initialRoute = "landing", initialBank = "thai", initialDealId = "D-014", initialScreen, initialGroupWallet, initialGroupCreate = false }: { initialRoute?: "landing" | "login" | "authorize" | "chat" | "deals" | "deal-detail"; initialBank?: BankChoice; initialDealId?: string; initialScreen?: ScreenName; initialGroupWallet?: string; initialGroupCreate?: boolean }) {
  const router = useRouter();
  const run = useOperation();
  const operationActive = useOperationActive();
  const pending = useNavigationPending();
  const [route, setRoute] = useState<Route>(initialScreen ?? (initialRoute === "authorize" ? "bank-authorize" : initialRoute === "chat" ? "สร้างดีล" : initialRoute === "deals" ? "ดีลทั้งหมด" : initialRoute === "deal-detail" ? `รายละเอียดดีล ${initialDealId}` : initialRoute));
  const [selectedBank, setSelectedBank] = useState<BankChoice>(initialBank);
  const goToScreen = (next: string) => {
    const dealMatch = next.match(/^รายละเอียดดีล (D-\d+)$/);
    if (dealMatch) {
      router.push(`/deals/${dealMatch[1]}`);
      return;
    }
    if (next === "คำตัดสิน AI") { router.push("/deals/D-012/verdict"); return; }
    if (next === "ข้อพิพาท") { router.push("/deals/D-012/dispute"); return; }
    if (next === "สร้างดีล") { router.push("/chat"); return; }
    setRoute(next as Route);
  };
  const openLogin = () => {
    router.push("/login");
  };
  const enterApp = () => router.push("/chat");
  const isApp = route !== "landing" && route !== "login" && route !== "bank-authorize";
  const screen = () => {
    switch (route) {
      case "ดีลทั้งหมด": return <DealsScreen go={goToScreen} />;
      case "สร้างดีล": return <CreateDealScreen />;
      default:
        if (typeof route === "string" && route.startsWith("รายละเอียดดีล ")) {
          const dealId = route.slice("รายละเอียดดีล ".length);
          return <DealDetailScreen dealId={dealId} go={goToScreen} />;
        }
        break;
    }
    switch (route) {
      case "ส่งงาน (ผู้ขาย)": return <SubmitWorkScreen />;
      case "รับข้อเสนอ": return <OfferScreen />;
      case "ข้อพิพาท": return <DisputeScreen />;
      case "คำตัดสิน AI": return <AiDecisionScreen />;
      case "รออนุมัติ": return <ApprovalsScreen />;
      case "กระเป๋": return <SummaryScreen />;
      case "เพื่อน": return <FriendsScreen />;
      case "กลุ่ม": return <GroupsScreen initialCreateOpen={initialGroupCreate} initialWalletGroup={initialGroupWallet} onOpenCreate={() => router.push("/groups/new")} onCloseCreate={() => router.push("/groups")} onOpenWallet={(name) => router.push(name === "PLC Team" ? "/groups/plc-team" : "/groups/nok-gun")} onCloseWallet={() => router.push("/groups")} />;
      case "นโยบาย & Allowlist": return <PolicyScreen />;
      case "กระเป๋า": return <WalletScreen />;
      case "ความเป็นส่วนตัว": return <PrivacyScreen />;
      default: return <CreateDealScreen />;
    }
  };

  if (isApp) return <WorkspaceFrame activeRoute={route} mainClass={route === "สร้างดีล" ? "aw-main-chat" : ""}>
    {pending ? <WorkspaceSkeleton/> : screen()}
  </WorkspaceFrame>;
  return <div className={`aw-app aw-v08${route === "landing" ? " aw-app-landing" : ""}`}>
    {(route !== "bank-authorize" || operationActive) && <Header onLogin={openLogin} onSignup={openLogin} landing={route === "landing"} authPage={route === "login"}/>}
    <OperationOutlet publicPage>{pending ? <LoadingSkeleton/> : <>
      {route === "landing" && <LandingScreen onStart={openLogin}/>}
      {route === "login" && <LoginScreen initialBank={selectedBank} onAuthorize={bank => {setSelectedBank(bank);run(bank === "thai" ? "L-01" : "L-02", () => router.push(bank === "thai" ? "/th/authorize" : "/cn/authorize"));}}/>}
      {route === "bank-authorize" && <BankAuthorizeScreen bank={selectedBank} onCancel={()=>router.push("/login")} onContinue={enterApp}/>}
    </>}</OperationOutlet>
  </div>;
}
