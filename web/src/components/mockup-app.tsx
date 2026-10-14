"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AppDataProvider, useAppData } from "./app-data";
import { BankAuthorizeLive, LiveChat, LiveDeals, LivePrivacy } from "./mockup-live";
import { translateMockupText, useLang } from "@/lib/i18n";
import { Header, SIDEBAR_GROUPS, SidebarIcon, type ScreenName } from "./mockup-ui";
import {
  AiDecisionScreen, ApprovalsScreen, DealDetailScreen,
  DisputeScreen, FriendsScreen, GroupsScreen, LandingScreen, LoginScreen, OfferScreen, PolicyScreen, SummaryScreen,
  SubmitWorkScreen, WalletScreen,
} from "./mockup-screens";
import type { BankChoice } from "./mockup-screens";
import "./mockup.css";

type Route = "landing" | "login" | "bank-authorize" | `รายละเอียดดีล ${string}` | ScreenName;
const SECTION_PATHS: Partial<Record<ScreenName, string>> = {
  "รออนุมัติ": "/approvals",
  "กระเป๋": "/summary",
  "เพื่อน": "/friends",
  "กลุ่ม": "/groups",
  "นโยบาย & Allowlist": "/policy",
  "ความเป็นส่วนตัว": "/profile",
};

export function MockupApp({ initialRoute = "landing", initialBank = "thai", initialDealId = "D-014", initialScreen, initialGroupWallet, initialGroupCreate = false }: { initialRoute?: "landing" | "login" | "authorize" | "chat" | "deals" | "deal-detail"; initialBank?: BankChoice; initialDealId?: string; initialScreen?: ScreenName; initialGroupWallet?: string; initialGroupCreate?: boolean }) {
  const router = useRouter();
  const [route, setRoute] = useState<Route>(initialScreen ?? (initialRoute === "authorize" ? "bank-authorize" : initialRoute === "chat" ? "สร้างดีล" : initialRoute === "deals" ? "ดีลทั้งหมด" : initialRoute === "deal-detail" ? `รายละเอียดดีล ${initialDealId}` : initialRoute));
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedBank, setSelectedBank] = useState<BankChoice>(initialBank);
  const lang = useLang();
  const goToScreen = (next: string) => {
    const dealMatch = next.match(/^รายละเอียดดีล (D-\d+)$/);
    if (dealMatch) {
      router.push(`/deal/${dealMatch[1]}`);
      setRoute(next as Route);
      return;
    }
    if (next === "สร้างดีล") router.push("/chat");
    setRoute(next as Route);
  };
  const openLogin = () => {
    if (initialRoute === "landing") router.push("/login");
    else setRoute("login");
  };
  const enterApp = () => { setRoute("สร้างดีล"); router.push("/chat"); };
  const isApp = route !== "landing" && route !== "login" && route !== "bank-authorize";
  const { data: session, isPending } = authClient.useSession();
  useEffect(() => {
    if (isPending) return;
    // App screens need a bank sign-in; a signed-in user skips the login page.
    if (isApp && !session) router.replace("/login");
    if (route === "login" && session) router.replace("/chat");
  }, [isApp, isPending, route, router, session]);
  const screen = () => {
    switch (route) {
      case "ดีลทั้งหมด": return <LiveDeals go={goToScreen} />;
      case "สร้างดีล": return <LiveChat />;
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
      case "กลุ่ม": return <GroupsScreen initialCreateOpen={initialGroupCreate} initialWalletGroup={initialGroupWallet} onOpenCreate={() => router.push("/group/crgroup")} onCloseCreate={() => router.push("/groups")} onOpenWallet={(name) => router.push(`/group/groupwallet?name=${encodeURIComponent(name)}`)} onCloseWallet={() => router.push("/groups")} />;
      case "นโยบาย & Allowlist": return <PolicyScreen />;
      case "กระเป๋า": return <WalletScreen />;
      case "ความเป็นส่วนตัว": return <LivePrivacy />;
      default: return <LiveChat />;
    }
  };

  return <div className={`aw-app${route === "landing" ? " aw-app-landing" : ""}`}>
    {route !== "bank-authorize" && <Header onLogin={openLogin} onSignup={openLogin} authenticated={isApp} landing={route === "landing"} authPage={route === "login"} />}
    {route === "landing" && <LandingScreen onStart={openLogin} />}
    {route === "login" && <LoginScreen initialBank={selectedBank} onAuthorize={(bank) => { setSelectedBank(bank); router.push(bank === "thai" ? "/th/authorize" : "/cn/authorize"); }} />}
    {route === "bank-authorize" && <BankAuthorizeLive bank={selectedBank} onCancel={() => router.push("/login")} onContinue={enterApp} />}
    {isApp && session && <AppDataProvider enabled><div className={`aw-workspace${route === "สร้างดีล" ? " aw-ai-chat-workspace" : ""}${sidebarOpen ? "" : " aw-sidebar-collapsed"}`}><aside className="aw-sidebar"><div className="aw-sidebar-menu-head"><small>{translateMockupText("MENU", lang)}</small><button className={`aw-sidebar-toggle${sidebarOpen ? " is-open" : " is-closed"}`} type="button" aria-label={translateMockupText(sidebarOpen ? "ซ่อนเมนูด้านข้าง" : "แสดงเมนูด้านข้าง", lang)} aria-expanded={sidebarOpen} title={translateMockupText(sidebarOpen ? "ซ่อนเมนู" : "แสดงเมนู", lang)} onClick={() => setSidebarOpen((open) => !open)}><svg className="aw-menu-glyph" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2.25" y="2.75" width="13.5" height="12.5" rx="2.25" /><path d="M7 3v12.5" /><path className="aw-menu-chevron" d="m11.5 6.5-2.25 2.5 2.25 2.5" /></svg></button></div>{SIDEBAR_GROUPS.map(group => <nav className="aw-sidebar-group" key={group.title}><small className="aw-nav-title">{translateMockupText(group.title, lang)}</small>{group.items.map(item => <button key={item.label} title={translateMockupText(item.label, lang)} disabled={"disabled" in item && Boolean(item.disabled)} className={`aw-nav-item${item.route === route || (((typeof route === "string" && route.startsWith("รายละเอียดดีล ")) || route === "คำตัดสิน AI") && item.route === "ดีลทั้งหมด") ? " active" : ""}${"disabled" in item && item.disabled ? " disabled" : ""}`} onClick={() => { if (!item.route) return; if (item.route === "สร้างดีล") router.push("/chat"); else if (item.route === "ดีลทั้งหมด") router.push("/deal"); else { const path = SECTION_PATHS[item.route as ScreenName]; if (path) router.push(path); setRoute(item.route as Route); } }}><SidebarIcon name={item.icon} /><span className="aw-nav-label">{translateMockupText(item.label, lang)}</span>{"badge" in item && item.badge && <span className="aw-nav-badge">{item.badge}</span>}</button>)}</nav>)}<SidebarProfile onOpen={() => { router.push("/profile"); setRoute("ความเป็นส่วนตัว"); }} /></aside><main className={`aw-main${route === "สร้างดีล" ? " aw-main-chat" : route === "ดีลทั้งหมด" ? " aw-main-deals" : (typeof route === "string" && route.startsWith("รายละเอียดดีล ")) ? " aw-main-deal-detail" : route === "คำตัดสิน AI" ? " aw-main-decision" : route === "รออนุมัติ" ? " aw-main-approvals" : route === "กระเป๋" ? " aw-main-summary" : route === "เพื่อน" ? " aw-main-friends" : route === "กลุ่ม" ? " aw-main-groups" : route === "นโยบาย & Allowlist" ? " aw-main-policy" : ""}`}><div className="aw-screen">{screen()}</div></main></div></AppDataProvider>}
  </div>;
}

function SidebarProfile({ onOpen }: { onOpen: () => void }) {
  const { me } = useAppData();
  const lang = useLang();
  const name = me?.user.name ?? "…";
  const account = me?.accounts.find((a) => a.isDefault) ?? me?.accounts[0];
  const kind = me?.bank.customerType === "COMPANY" ? "Company" : "Personal";
  return <button className="aw-sidebar-profile" type="button" title={`${name} · ${kind} ${account?.accountNo ?? ""}`} onClick={onOpen}><span className="aw-sidebar-avatar">{name.slice(0, 1).toUpperCase()}</span><span className="aw-profile-copy"><b>{name}</b><small>{translateMockupText(`${kind} · ${account?.accountNo ?? ""}`, lang)}</small></span></button>;
}
