import Link from "next/link";
import type { ReactNode } from "react";

import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Public, read-only explorer for the private chain: anyone (reviewers included) can look up a
 * transaction hash or an address without signing in. Only hashes and amounts are on-chain (PDPA);
 * users' wallets are shown without names. The same data is open over read-only JSON-RPC at /api/rpc.
 */
export default function ExplorerLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/explorer" className="text-lg font-semibold">
            Agentic Wallet chain explorer
          </Link>
          <p className="text-xs text-muted">
            {config.chain.name} · chain id {config.chain.id} · public, read-only · JSON-RPC: <code>/api/rpc</code>
          </p>
        </div>
        <form action="/explorer" className="flex gap-2">
          <input name="q" placeholder="tx hash or address" className="w-80 max-w-full rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-xs" />
          <button className="btn-primary" type="submit">
            Search
          </button>
        </form>
      </header>
      {children}
    </main>
  );
}
