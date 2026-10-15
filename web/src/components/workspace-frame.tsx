"use client";
import { useState, type ReactNode } from "react";
import { Header, SIDEBAR_GROUPS, SidebarIcon } from "./mockup-ui";
import { OperationOutlet } from "./operation-loading";
import { useAppRouter } from "./navigation";
import { translateMockupText, useLang } from "@/lib/i18n";
import "./mockup.css";
import "./v08.css";

const destinations: Record<string, string> = {
  "สร้างดีล": "/chat", "ดีลทั้งหมด": "/deals", "รออนุมัติ": "/approvals", "กระเป๋": "/summary",
  "เพื่อน": "/contacts", "กลุ่ม": "/groups", "นโยบาย & Allowlist": "/policy", "ความเป็นส่วนตัว": "/profile",
};
export function routeFromPath(path: string) {
  if (/^\/deals?(\/|$)/.test(path)) return "ดีลทั้งหมด";
  if (path.startsWith("/group")) return "กลุ่ม";
  return Object.entries(destinations).find(([, href]) => path === href)?.[0] ?? "";
}
export function WorkspaceFrame({ activeRoute, children, mainClass = "" }: { activeRoute: string; children: ReactNode; mainClass?: string }) {
  const router = useAppRouter(); const lang = useLang();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const active = activeRoute.startsWith("รายละเอียดดีล ") || activeRoute === "คำตัดสิน AI" ? "ดีลทั้งหมด" : activeRoute;
  return <div className="aw-app aw-v08">
    <Header authenticated onLogin={() => router.push("/login")} onSignup={() => router.push("/login")} />
    <div className={`aw-workspace${active === "สร้างดีล" ? " aw-ai-chat-workspace" : ""}${sidebarOpen ? "" : " aw-sidebar-collapsed"}`}>
      <aside className="aw-sidebar">
        <div className="aw-sidebar-menu-head"><small>{translateMockupText("MENU", lang)}</small>
          <button className={`aw-sidebar-toggle${sidebarOpen ? " is-open" : " is-closed"}`} type="button"
            aria-label={translateMockupText(sidebarOpen ? "ซ่อนเมนูด้านข้าง" : "แสดงเมนูด้านข้าง", lang)} aria-expanded={sidebarOpen}
            title={translateMockupText(sidebarOpen ? "ซ่อนเมนู" : "แสดงเมนู", lang)} onClick={() => setSidebarOpen(open => !open)}>
            <svg className="aw-menu-glyph" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2.25" y="2.75" width="13.5" height="12.5" rx="2.25"/><path d="M7 3v12.5"/><path className="aw-menu-chevron" d="m11.5 6.5-2.25 2.5 2.25 2.5"/></svg>
          </button>
        </div>
        {SIDEBAR_GROUPS.map(group => <nav className="aw-sidebar-group" key={group.title}>
          <small className="aw-nav-title">{translateMockupText(group.title, lang)}</small>
          {group.items.map(item => <button key={item.label} type="button" title={translateMockupText(item.label, lang)}
            className={`aw-nav-item${item.route === active ? " active" : ""}`} aria-current={item.route === active ? "page" : undefined}
            onClick={() => router.push(destinations[item.route])}>
            <SidebarIcon name={item.icon}/><span className="aw-nav-label">{translateMockupText(item.label, lang)}</span>
            {"badge" in item && <span className="aw-nav-badge">{item.badge}</span>}
          </button>)}
        </nav>)}
        <button className="aw-sidebar-profile" type="button" title="Gun · Personal ···4821" onClick={() => router.push("/profile")}>
          <span className="aw-sidebar-avatar">G</span><span className="aw-profile-copy"><b>Gun</b><small>{translateMockupText("Personal · ··4821", lang)}</small></span>
        </button>
      </aside>
      <main className={`aw-main ${mainClass}`}><div className="aw-screen"><OperationOutlet>{children}</OperationOutlet></div></main>
    </div>
  </div>;
}
