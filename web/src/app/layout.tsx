import type { Metadata } from "next";
import { Inter, Geist_Mono, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";
import { NavigationProvider } from "@/components/navigation";

const geistSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const notoThai = IBM_Plex_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE = process.env.APP_ORIGIN?.trim() || "https://www.kravii.com";
const DESCRIPTION =
  "Kravii is an AI agent wallet for small businesses: describe a job in Thai, English or Chinese, the AI drafts a milestone deal, the money waits in an on-chain escrow and is paid only when you approve the work. Demo with test money (THB and CNY).";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Kravii · AI agent wallet for milestone payments", template: "%s · Kravii" },
  description: DESCRIPTION,
  applicationName: "Kravii",
  keywords: ["Kravii", "AI agent wallet", "milestone payments", "escrow", "SME", "freelance payments", "smart contract", "FinTechathon 2026"],
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "Kravii", url: "/", title: "Kravii · AI agent wallet for milestone payments", description: DESCRIPTION, images: [{ url: "/icon.png", width: 512, height: 512, alt: "Kravii" }] },
  twitter: { card: "summary", title: "Kravii · AI agent wallet for milestone payments", description: DESCRIPTION, images: ["/icon.png"] },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${notoThai.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <NavigationProvider>{children}</NavigationProvider>
      </body>
    </html>
  );
}
