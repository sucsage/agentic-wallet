import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MockIdPage } from "@/components/mock-id-page";

export const metadata: Metadata = {
  title: "Mock digital ID · demo",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/** A mock national digital-ID provider's consent screen (ThaID or 国家网络身份认证), for KYC demos. */
export default async function MockIdAuthorize({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { provider } = await params;
  if (provider !== "thaid" && provider !== "netid") notFound();
  const q = await searchParams;
  return (
    <MockIdPage
      provider={provider}
      request={{
        client_id: q.client_id ?? "",
        redirect_uri: q.redirect_uri ?? "",
        state: q.state ?? "",
        nonce: q.nonce ?? "",
        code_challenge: q.code_challenge ?? "",
        login_hint: q.login_hint ?? "",
        scope: q.scope ?? "",
      }}
    />
  );
}
