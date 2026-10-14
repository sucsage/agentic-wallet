"use client";

import { useState } from "react";
import { translateMockupText, useLang } from "@/lib/i18n";
import { Header, SIDEBAR_GROUPS, SidebarIcon, type ScreenName } from "./mockup-ui";
import {
  AiDecisionScreen, ApprovalsScreen, BankAuthorizeScreen, CreateDealScreen, DealDetailScreen, DealsScreen,
  DisputeScreen, FriendsScreen, GroupsScreen, LandingScreen, LoginScreen, OfferScreen, PolicyScreen, SummaryScreen,
  PrivacyScreen, SubmitWorkScreen, WalletScreen,
} from "./mockup-screens";
import type { BankChoice } from "./mockup-screens";
import "./mockup.css";

type Route = "landing" | "login" | "bank-authorize" | "รายละเอียดดีล D-021" | "รายละเอียดดีล D-015" | "รายละเอียดดีล D-012" | ScreenName;

export function MockupApp() {
  const [route, setRoute] = useState<Route>("landing");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedBank, setSelectedBank] = useState<BankChoice>("thai");
  const lang = useLang();
  const enterApp = () => setRoute("สร้างดีล");
  const isApp = route !== "landing" && route !== "login" && route !== "bank-authorize";
  const screen = () => {
    switch (route) {
      case "ดีลทั้งหมด": return <DealsScreen go={(next) => setRoute(next as Route)} />;
      case "สร้างดีล": return <CreateDealScreen />;
      case "รายละเอียดดีล": return <DealDetailScreen go={(next) => setRoute(next as Route)} />;
      case "รายละเอียดดีล D-021": return <DealDetailScreen dealId="D-021" go={(next) => setRoute(next as Route)} />;
      case "รายละเอียดดีล D-015": return <DealDetailScreen dealId="D-015" go={(next) => setRoute(next as Route)} />;
      case "รายละเอียดดีล D-012": return <DealDetailScreen dealId="D-012" go={(next) => setRoute(next as Route)} />;
      case "ส่งงาน (ผู้ขาย)": return <SubmitWorkScreen />;
      case "รับข้อเสนอ": return <OfferScreen />;
      case "ข้อพิพาท": return <DisputeScreen />;
      case "คำตัดสิน AI": return <AiDecisionScreen />;
      case "รออนุมัติ": return <ApprovalsScreen />;
      case "กระเป๋": return <SummaryScreen />;
      case "เพื่อน": return <FriendsScreen />;
      case "กลุ่ม": return <GroupsScreen />;
      case "นโยบาย & Allowlist": return <PolicyScreen />;
      case "กระเป๋า": return <WalletScreen />;
      case "ความเป็นส่วนตัว": return <PrivacyScreen />;
      default: return <CreateDealScreen />;
    }
  };

  return <div className={`aw-app${route === "landing" ? " aw-app-landing" : ""}`}>
    {route !== "bank-authorize" && <Header onLogin={() => setRoute("login")} onSignup={() => setRoute("login")} authenticated={isApp} landing={route === "landing"} authPage={route === "login"} />}
    {route === "landing" && <LandingScreen onStart={() => setRoute("login")} />}
    {route === "login" && <LoginScreen initialBank={selectedBank} onAuthorize={(bank) => { setSelectedBank(bank); setRoute("bank-authorize"); }} />}
    {route === "bank-authorize" && <BankAuthorizeScreen bank={selectedBank} onCancel={() => setRoute("login")} onContinue={enterApp} />}
    {isApp && <div className={`aw-workspace${route === "สร้างดีล" ? " aw-ai-chat-workspace" : ""}${sidebarOpen ? "" : " aw-sidebar-collapsed"}`}><aside className="aw-sidebar"><div className="aw-sidebar-menu-head"><small>{translateMockupText("MENU", lang)}</small><button className={`aw-sidebar-toggle${sidebarOpen ? " is-open" : " is-closed"}`} type="button" aria-label={translateMockupText(sidebarOpen ? "ซ่อนเมนูด้านข้าง" : "แสดงเมนูด้านข้าง", lang)} aria-expanded={sidebarOpen} title={translateMockupText(sidebarOpen ? "ซ่อนเมนู" : "แสดงเมนู", lang)} onClick={() => setSidebarOpen((open) => !open)}><svg className="aw-menu-glyph" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2.25" y="2.75" width="13.5" height="12.5" rx="2.25" /><path d="M7 3v12.5" /><path className="aw-menu-chevron" d="m11.5 6.5-2.25 2.5 2.25 2.5" /></svg></button></div>{SIDEBAR_GROUPS.map(group => <nav className="aw-sidebar-group" key={group.title}><small className="aw-nav-title">{translateMockupText(group.title, lang)}</small>{group.items.map(item => <button key={item.label} title={translateMockupText(item.label, lang)} disabled={"disabled" in item && Boolean(item.disabled)} className={`aw-nav-item${item.route === route || ((route === "รายละเอียดดีล D-021" || route === "รายละเอียดดีล D-015" || route === "รายละเอียดดีล D-012" || route === "คำตัดสิน AI") && item.route === "ดีลทั้งหมด") ? " active" : ""}${"disabled" in item && item.disabled ? " disabled" : ""}`} onClick={() => item.route && setRoute(item.route as Route)}><SidebarIcon name={item.icon} /><span className="aw-nav-label">{translateMockupText(item.label, lang)}</span>{"badge" in item && item.badge && <span className="aw-nav-badge">{item.badge}</span>}</button>)}</nav>)}<button className="aw-sidebar-profile" type="button" title="Gun · Personal ···4821" onClick={() => setRoute("ความเป็นส่วนตัว")}><span className="aw-sidebar-avatar">G</span><span className="aw-profile-copy"><b>Gun</b><small>{translateMockupText("Personal · ··4821", lang)}</small></span></button></aside><main className={`aw-main${route === "สร้างดีล" ? " aw-main-chat" : route === "ดีลทั้งหมด" ? " aw-main-deals" : (route === "รายละเอียดดีล D-021" || route === "รายละเอียดดีล D-015" || route === "รายละเอียดดีล D-012") ? " aw-main-deal-detail" : route === "คำตัดสิน AI" ? " aw-main-decision" : route === "รออนุมัติ" ? " aw-main-approvals" : route === "กระเป๋" ? " aw-main-summary" : route === "เพื่อน" ? " aw-main-friends" : route === "กลุ่ม" ? " aw-main-groups" : route === "นโยบาย & Allowlist" ? " aw-main-policy" : ""}`}><div className="aw-screen">{screen()}</div></main></div>}
  </div>;
}
