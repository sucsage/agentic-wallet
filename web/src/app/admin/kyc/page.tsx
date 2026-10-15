import { KycReview } from "@/components/kyc-review";

export const dynamic = "force-dynamic";

/** KYC reviewer's desk: identity applications waiting for a person (when auto-approval is off). */
export default function AdminKycPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-lg font-semibold">KYC review · wallet applications</h1>
        <p className="text-xs text-muted">Approving opens the applicant&apos;s THB or CNY wallet. Only masked ID numbers are shown; the numbers themselves are never stored.</p>
      </header>
      <KycReview />
    </main>
  );
}
