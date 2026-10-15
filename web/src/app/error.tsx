"use client";
import { usePathname } from "next/navigation";
import { WorkspaceFrame, routeFromPath } from "@/components/workspace-frame";
import { AppLink } from "@/components/navigation";
import { useLang } from "@/lib/i18n";
import "@/components/loading-skeleton.css";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const path = usePathname(); const lang = useLang();
  return <WorkspaceFrame activeRoute={routeFromPath(path)}><section className="aw-navigation-error" role="alert">
    <h1>{lang === "th" ? "โหลดหน้านี้ไม่สำเร็จ" : "Could not load this page"}</h1>
    <p>{lang === "th" ? "ลองใหม่อีกครั้ง หรือเลือกหน้าอื่นจากเมนู" : "Try again, or choose another page from the menu."}</p>
    <div className="aw-actions"><button className="aw-button" onClick={reset}>{lang === "th" ? "ลองใหม่" : "Try again"}</button><AppLink className="aw-button aw-button-outline" href="/chat">{lang === "th" ? "กลับไปหน้าแชต" : "Back to chat"}</AppLink></div>
  </section></WorkspaceFrame>;
}
