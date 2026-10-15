import Link from "next/link";

import { addressLabels, txDetail } from "@/lib/explorer";

/** One transaction: status, parties, decoded call and decoded events. */
export default async function ExplorerTxPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const [tx, labels] = await Promise.all([txDetail(hash), addressLabels()]);
  if (!tx) return <p className="card p-4 text-sm">No transaction {hash} on this chain.</p>;
  const name = (a: string | null) => (a ? `${labels.get(a.toLowerCase()) ?? ""} ${a}`.trim() : "—");
  const ok = tx.status === "success";

  return (
    <section className="card flex flex-col gap-3 p-4 text-sm">
      <h2 className="font-semibold">
        Transaction <span className={ok ? "text-good" : "text-bad"}>{ok ? "✓ success" : tx.status === "reverted" ? "✗ reverted" : tx.status}</span>
      </h2>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">Hash</dt>
        <dd className="break-all font-mono">{tx.hash}</dd>
        <dt className="text-muted">Block</dt>
        <dd>
          #{tx.block} · {tx.time ? new Date(tx.time * 1000).toLocaleString() : "—"}
        </dd>
        <dt className="text-muted">From</dt>
        <dd className="break-all font-mono">{name(tx.from)}</dd>
        <dt className="text-muted">To</dt>
        <dd className="break-all font-mono">
          {tx.to ? <Link href={`/explorer/address/${tx.to}`}>{name(tx.to)}</Link> : `created ${tx.created}`}
        </dd>
        <dt className="text-muted">Call</dt>
        <dd className="font-mono">{tx.call ? `${tx.call.contract}.${tx.call.fn}` : "—"}</dd>
        <dt className="text-muted">Arguments</dt>
        <dd className="break-all font-mono">{tx.call?.args || "—"}</dd>
        <dt className="text-muted">Gas used</dt>
        <dd>{tx.gasUsed} (gas is free on this chain)</dd>
      </dl>
      <h3 className="font-semibold">Events ({tx.events.length})</h3>
      <ul className="flex flex-col gap-1 text-xs">
        {tx.events.map((e, i) => (
          <li key={i} className="break-all font-mono">
            {labels.get(e.address.toLowerCase()) ?? e.address} · <b>{e.event}</b> {e.args}
          </li>
        ))}
      </ul>
    </section>
  );
}
