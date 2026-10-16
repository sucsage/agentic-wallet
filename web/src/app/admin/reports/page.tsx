import { ReportReview } from "@/components/report-review";

export const dynamic = "force-dynamic";

/** Reviewer's desk for user reports (Contacts → Report). */
export default function AdminReportsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-lg font-semibold">User reports</h1>
        <p className="text-xs text-muted">Reports people sent from Contacts. The reported person is not told who reported them.</p>
      </header>
      <ReportReview />
    </main>
  );
}
