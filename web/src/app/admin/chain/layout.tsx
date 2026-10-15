import Link from "next/link";
import type { ReactNode } from "react";

import { HttpError, requireAdmin } from "@/lib/guard";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Admin explorer shell: only reviewers flagged as admins get past this layout. */
export default async function AdminChainLayout({ children }: { children: ReactNode }) {
  try {
    await requireAdmin();
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return (
      <main className="mx-auto flex max-w-xl flex-1 flex-col gap-3 px-4 py-16">
        <h1 className="text-xl font-semibold">Admin explorer</h1>
        <p className="text-sm text-muted">
          {status === 401 ? "Sign in first, with the admin bank account you were given." : "This page is for reviewers (admin accounts) only."}
        </p>
        <Link className="btn-primary w-fit" href="/login">
          Log in
        </Link>
      </main>
    );
  }
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/chain" className="text-lg font-semibold">
            Admin explorer
          </Link>
          <p className="text-xs text-muted">
            {config.chain.name} · chain id {config.chain.id} · read-only view for reviewers
          </p>
        </div>
        <form action="/admin/chain" className="flex gap-2">
          <input name="q" placeholder="tx hash or address" className="w-80 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-xs" />
          <button className="btn-primary" type="submit">
            Search
          </button>
        </form>
      </header>
      {children}
    </main>
  );
}
