import { DisputeReview } from "@/components/dispute-review";

export const dynamic = "force-dynamic";

/** Human arbiter's desk: disputes the AI arbiter was not confident enough to settle alone. */
export default function AdminDisputesPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-lg font-semibold">Human arbiter · open disputes</h1>
        <p className="text-xs text-muted">
          The AI arbiter settles a dispute on its own only when it is at least 75% confident. These need a person. Your ruling is sent
          on-chain with the arbiter key.
        </p>
      </header>
      <DisputeReview />
    </main>
  );
}
