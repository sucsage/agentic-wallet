import Link from "next/link";
import type { ReactNode } from "react";

/** Contact for privacy and terms questions: CONTACT_EMAIL when set, else the project's GitHub. */
export function contact() {
  const email = process.env.CONTACT_EMAIL?.trim();
  return email
    ? { href: `mailto:${email}`, label: email }
    : { href: "https://github.com/sucsage/agentic-wallet/issues", label: "github.com/sucsage/agentic-wallet/issues" };
}

export const LEGAL_UPDATED = "22 October 2026";

/** A plain, readable page for the privacy policy and the terms (no app chrome, no scripts needed). */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ background: "#000", color: "#e8e8e8", minHeight: "100vh", padding: "48px 16px" }}>
      <article style={{ maxWidth: 760, margin: "0 auto", lineHeight: 1.7, fontSize: 15 }} className="aw-legal">
        <p style={{ margin: 0 }}>
          <Link href="/" style={{ color: "#9b7cff", textDecoration: "none", fontWeight: 700 }}>
            Kravii
          </Link>
        </p>
        <h1 style={{ fontSize: 32, margin: "12px 0 4px", letterSpacing: "-0.5px" }}>{title}</h1>
        <p style={{ color: "#8a8a8a", marginTop: 0 }}>Last updated: {LEGAL_UPDATED}</p>
        <p style={{ padding: "10px 14px", border: "1px solid #332509", background: "#1b1405", color: "#e4a700", borderRadius: 10 }}>
          Kravii is a demo built for the FinTechathon 2026 competition. It runs on test money only and is not a licensed bank,
          e-money or payment service. Do not enter real ID numbers, real bank details or real card numbers.
        </p>
        {children}
        <hr style={{ border: 0, borderTop: "1px solid #292929", margin: "40px 0 16px" }} />
        <p style={{ color: "#8a8a8a", fontSize: 13 }}>
          <Link href="/privacy" style={{ color: "#9b7cff" }}>Privacy policy</Link> · <Link href="/terms" style={{ color: "#9b7cff" }}>Terms of use</Link> · © 2026 Kravii
        </p>
      </article>
      <style>{`.aw-legal h2{font-size:20px;margin:32px 0 8px}.aw-legal h3{font-size:16px;margin:20px 0 6px}.aw-legal a{color:#9b7cff}.aw-legal ul{padding-left:22px}.aw-legal li{margin:4px 0}.aw-legal .th{margin-top:48px;padding-top:24px;border-top:1px solid #292929}`}</style>
    </main>
  );
}
