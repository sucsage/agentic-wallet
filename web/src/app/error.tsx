"use client";

import { AppLink } from "@/components/navigation";
import { useLang } from "@/lib/i18n";
import "@/components/mockup.css";
import "@/components/v08.css";
import "@/components/loading-skeleton.css";

/** A page that crashed: offer a retry and a way back instead of a blank screen. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const lang = useLang();
  return (
    <div className="aw-app aw-v08 min-h-screen">
      <section className="aw-navigation-error" role="alert">
        <h1>{lang === "th" ? "โหลดหน้านี้ไม่สำเร็จ" : "Could not load this page"}</h1>
        <p>{lang === "th" ? "ลองใหม่อีกครั้ง หรือกลับไปหน้าแชต" : "Try again, or go back to the chat."}</p>
        <div className="aw-actions">
          <button className="aw-button" onClick={reset}>
            {lang === "th" ? "ลองใหม่" : "Try again"}
          </button>
          <AppLink className="aw-button aw-button-outline" href="/chat">
            {lang === "th" ? "กลับไปหน้าแชต" : "Back to chat"}
          </AppLink>
        </div>
      </section>
    </div>
  );
}
