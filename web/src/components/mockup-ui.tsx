import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { setLang, translateMockupText, useLang } from "@/lib/i18n";
import { useAppRouter } from "./navigation";
import { NotificationsButton, SearchBox, WalletSwitcher } from "./header-tools";

export const NAV_GROUPS = [
  { title: "ดีล", items: ["ภาพรวม", "ดีลทั้งหมด", "สร้างดีล", "รายละเอียดดีล", "ส่งงาน (ผู้ขาย)", "รับข้อเสนอ", "ข้อพิพาท", "คำตัดสิน AI"] },
  { title: "ความปลอดภัย", items: ["รออนุมัติ", "นโยบาย & Allowlist", "กระเป๋า"] },
  { title: "สังคม", items: ["เพื่อน", "กลุ่ม"] },
  { title: "บัญชี", items: ["ความเป็นส่วนตัว"] },
] as const;

export type ScreenName = (typeof NAV_GROUPS)[number]["items"][number] | "กระเป๋";

export const SIDEBAR_GROUPS = [
  { title: "Main", items: [
    { label: "AI Chat", route: "สร้างดีล", icon: "bot" },
    { label: "Deals", route: "ดีลทั้งหมด", icon: "file" },
  ] },
  { title: "Money", items: [
    { label: "Summary", route: "กระเป๋", icon: "chart" },
  ] },
  { title: "Social", items: [
    { label: "Contacts", route: "เพื่อน", icon: "user-plus", badge: "1" },
    { label: "Groups", route: "กลุ่ม", icon: "users" },
  ] },
  { title: "Settings", items: [
    { label: "Policy & Allowlist", route: "นโยบาย & Allowlist", icon: "shield" },
    { label: "Profile & Privacy", route: "ความเป็นส่วนตัว", icon: "lock" },
  ] },
] as const;

export function SidebarIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="m3 9 6-5 6 5v7H4V9" /><path d="M7 16v-5h4v5" /></>,
    bot: <><rect x="3" y="6" width="12" height="9" rx="2" /><path d="M9 3v3M6 10h.01M12 10h.01M6 13h6M1.5 9v3M16.5 9v3" /></>,
    file: <><path d="M4 2.5h7l4 4V16H4z" /><path d="M11 2.5V7h4M6.5 10h6M6.5 13h6" /></>,
    check: <><circle cx="9" cy="9" r="6.5" /><path d="m6 9 2 2 4-4" /></>,
    chart: <><path d="M3 15V8M7 15V4M11 15v-5M15 15V2" /><path d="M2 16h14" /></>,
    wallet: <><path d="M3 5.5h11a2 2 0 0 1 2 2V15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /><path d="M12 9h5v4h-5a2 2 0 0 1 0-4Z" /><path d="M13 11h.01" /></>,
    users: <><circle cx="6.5" cy="6" r="2.5" /><circle cx="12.5" cy="7" r="2" /><path d="M2 15c0-2.2 1.8-4 4.5-4s4.5 1.8 4.5 4M11 11c2.7-.6 5 .9 5 3" /></>,
    "user-plus": <><circle cx="7" cy="6" r="2.5" /><path d="M2 15c0-2.3 2-4 5-4s5 1.7 5 4M14 6v6M11 9h6" /></>,
    shield: <><path d="M9 2.5 15 5v4.5c0 3.5-2.4 5.9-6 7-3.6-1.1-6-3.5-6-7V5z" /></>,
    lock: <><rect x="3" y="8" width="12" height="8" rx="1.5" /><path d="M6 8V5.5a3 3 0 0 1 6 0V8" /></>,
  };
  return <svg className="aw-nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">{paths[name] ?? paths.file}</svg>;
}

export function Brand({ onClick, label = "Agentic Wallet" }: { onClick?: () => void; label?: string }) {
  return <button className="aw-brand" onClick={onClick} aria-label={`${label} หน้าแรก`}><span className="aw-mark" /> <b>{label}</b></button>;
}

export function Button({ children, variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "danger" }) {
  return <button className={`aw-button aw-button-${variant} ${className}`} {...props}>{children}</button>;
}

export function Card({ children, className = "", ...props }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <section className={`aw-card ${className}`} {...props}>{children}</section>;
}

/** A page or panel still loading: a spinner and what is happening, so a slow chain read never looks frozen. */
export function Loading({ text = "Loading…", block = false }: { text?: string; block?: boolean }) {
  return (
    <div className={`aw-loading${block ? " aw-loading-block" : ""}`} role="status" aria-live="polite">
      <i aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

export function Status({ children, tone = "blue" }: { children: ReactNode; tone?: "blue" | "green" | "yellow" | "red" }) {
  return <span className={`aw-status aw-${tone}`}>{children}</span>;
}

export function PageTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: ReactNode; description?: string; action?: ReactNode }) {
  return <div className="aw-page-title"><div>{eyebrow && <small>{eyebrow}</small>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}

export function Header({ onLogin, onSignup, authenticated = false, landing = false, authPage = false }: { onLogin: () => void; onSignup: () => void; authenticated?: boolean; landing?: boolean; authPage?: boolean }) {
  const router = useAppRouter();
  const lang = useLang();
  const milestonePublic = landing || authPage;
  return <header className={`aw-topbar ${authenticated ? "aw-topbar-workspace" : "aw-topbar-public"}${landing ? " aw-topbar-landing" : ""}${authPage ? " aw-topbar-auth-page" : ""}`}><Brand onClick={() => router.push("/")} label={milestonePublic || authenticated ? "MilestonePay" : "Agentic Wallet"} />{authenticated ? <><SearchBox placeholder={translateMockupText("ค้นหาดีล รายชื่อผู้ติดต่อ กลุ่ม...", lang)} /><div className="aw-top-actions aw-workspace-actions"><WalletSwitcher /><button className="aw-lang-toggle" type="button" aria-label={translateMockupText("เปลี่ยนภาษา", lang)} title={translateMockupText("เปลี่ยนภาษา", lang)} onClick={() => setLang(lang === "en" ? "th" : "en")}>{lang === "en" ? "TH" : "EN"}</button><NotificationsButton label={translateMockupText("การแจ้งเตือน", lang)} /><Button variant="outline" className="aw-feedback-button">{translateMockupText("ข้อเสนอแนะ", lang)}</Button><button className="aw-avatar-button" type="button" aria-label={translateMockupText("บัญชีของฉัน", lang)}>ME</button></div></> : milestonePublic ? <><nav className="aw-landing-nav-links"><a href="#how-it-works">{translateMockupText("How it works", lang)}</a><a href="#security">{translateMockupText("Security", lang)}</a><a href="#faq">{translateMockupText("FAQ", lang)}</a></nav><div className="aw-top-actions aw-landing-nav-actions"><button className="aw-lang-toggle aw-public-language" type="button" aria-label="Switch language" title="Switch language" onClick={() => setLang(lang === "en" ? "th" : "en")}>{lang === "en" ? "TH" : "EN"}</button><Button onClick={onLogin}>{translateMockupText("Log in", lang)}</Button></div></> : <div className="aw-top-actions"><button className="aw-lang-toggle" type="button" aria-label={translateMockupText("เปลี่ยนภาษา", lang)} title={translateMockupText("เปลี่ยนภาษา", lang)} onClick={() => setLang(lang === "en" ? "th" : "en")}>{lang === "en" ? "TH" : "EN"}</button><Button variant="outline" className="aw-header-login" onClick={onLogin}>{translateMockupText("เข้าสู่ระบบ", lang)}</Button><Button className="aw-header-signup" onClick={onSignup}>{translateMockupText("เริ่มใช้งาน", lang)}</Button></div>}</header>;
}
