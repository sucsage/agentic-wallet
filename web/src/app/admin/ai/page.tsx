import { AiUsageAdmin } from "@/components/ai-usage-admin";

export const dynamic = "force-dynamic";

/** Admin: AI tokens per user (this week) and per-user limits. */
export default function AdminAiPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-lg font-semibold">AI allowance · tokens per user</h1>
        <p className="text-xs text-muted">Tokens on the team&apos;s AI key, Bangkok days, weeks from Monday. Users&apos; own keys (desktop app) are shown but never limited.</p>
      </header>
      <AiUsageAdmin />
    </main>
  );
}
