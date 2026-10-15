"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { AppLink } from "./navigation";
import "./loading-skeleton.css";

/** After 10 s, offers a retry instead of an endless skeleton. */
function SlowLoadingNotice() {
  const [slow, setSlow] = useState(false);
  const lang = useLang();
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 10000);
    return () => clearTimeout(timer);
  }, []);
  if (!slow) return null;
  return (
    <div className="aw-loading-notice" role="status">
      <p>{lang === "th" ? "หน้านี้ใช้เวลาโหลดนานกว่าปกติ ลองใหม่หรือเลือกหน้าอื่นจากเมนูได้" : "This page is taking longer than usual. Retry or choose another page from the menu."}</p>
      <button type="button" onClick={() => window.location.reload()}>
        {lang === "th" ? "ลองใหม่" : "Try again"}
      </button>
      <AppLink href="/chat">{lang === "th" ? "กลับไปหน้าแชต" : "Back to chat"}</AppLink>
    </div>
  );
}

function SkeletonCard({ wide = false }: { wide?: boolean }) {
  return (
    <div className={`aw-loading-card${wide ? " aw-loading-card-wide" : ""}`} aria-hidden="true">
      <div className="aw-skeleton aw-skeleton-title" />
      <div className="aw-skeleton aw-skeleton-subtitle" />
      <div className="aw-skeleton-cards">
        {[0, 1, 2].map((i) => (
          <div key={i} className="aw-skeleton aw-skeleton-card" />
        ))}
      </div>
      <div className="aw-skeleton aw-skeleton-line aw-skeleton-line-long" />
      <div className="aw-skeleton aw-skeleton-line aw-skeleton-line-medium" />
      <div className="aw-skeleton aw-skeleton-line aw-skeleton-line-short" />
    </div>
  );
}

/** Page placeholder while a route or its data loads (Napat's v0.8 S-01 layout). */
export function LoadingSkeleton() {
  const lang = useLang();
  return (
    <section className="aw-loading-page" aria-busy="true" aria-label={lang === "th" ? "กำลังโหลดหน้า" : "Loading page"}>
      <span className="aw-loading-sr-only" role="status">
        {lang === "th" ? "กำลังโหลดหน้า กรุณารอสักครู่" : "Loading page, please wait"}
      </span>
      <div className="aw-loading-grid">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard wide />
      </div>
      <SlowLoadingNotice />
    </section>
  );
}
