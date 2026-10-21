import type { Metadata } from "next";

import { MockupApp } from "@/components/mockup-app";

const SITE = process.env.APP_ORIGIN?.trim() || "https://www.kravii.com";

export const metadata: Metadata = { alternates: { canonical: "/" } };

/** Tells search engines what Kravii is (a software product, not a misspelt place name). */
const STRUCTURED = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${SITE}/#org`, name: "Kravii", url: SITE, logo: `${SITE}/icon.png`, sameAs: ["https://github.com/sucsage/agentic-wallet"] },
    {
      "@type": "SoftwareApplication",
      name: "Kravii",
      alternateName: "Kravii AI agent wallet",
      url: SITE,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web, macOS, Windows, Linux",
      description:
        "An AI agent wallet for small businesses: the AI drafts milestone deals, the money waits in an on-chain escrow and is paid only when the buyer approves the work. Demo with test money.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "THB" },
      publisher: { "@id": `${SITE}/#org` },
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED).replace(/</g, "\\u003c") }} />
      <MockupApp />
    </>
  );
}
