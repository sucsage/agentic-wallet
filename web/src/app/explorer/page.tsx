import Link from "next/link";
import { redirect } from "next/navigation";

import { addressLabels, latestBlocks } from "@/lib/explorer";

const short = (a: string | null) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : "—");

/** Latest blocks and their transactions; ?q= jumps to a tx hash or an address. */
export default async function ExplorerPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q?.trim();
  if (q && /^0x[0-9a-fA-F]{64}$/.test(q)) redirect(`/explorer/tx/${q}`);
  if (q && /^0x[0-9a-fA-F]{40}$/.test(q)) redirect(`/explorer/address/${q}`);
  const [{ chain, blocks }, labels] = await Promise.all([latestBlocks(15), addressLabels()]);
  const label = (a: string | null) => (a ? (labels.get(a.toLowerCase()) ?? short(a)) : "contract creation");

  return (
    <section className="card flex flex-col gap-3 p-4">
      {q && <p className="text-sm text-bad">“{q}” is not a transaction hash or an address.</p>}
      <h2 className="font-semibold">Latest blocks · head #{chain.head}</h2>
      <table className="w-full text-left text-xs">
        <thead className="text-muted">
          <tr>
            <th className="py-1">Block</th>
            <th>Time</th>
            <th>Tx hash</th>
            <th>From</th>
            <th>To</th>
            <th>Call</th>
          </tr>
        </thead>
        <tbody>
          {blocks.flatMap((b) =>
            b.txs.length === 0
              ? [
                  <tr key={b.number} className="border-t border-border text-muted">
                    <td className="py-1">#{b.number}</td>
                    <td>{new Date(b.time * 1000).toLocaleTimeString()}</td>
                    <td colSpan={4}>empty block</td>
                  </tr>,
                ]
              : b.txs.map((t) => (
                  <tr key={t.hash} className="border-t border-border">
                    <td className="py-1">#{b.number}</td>
                    <td>{new Date(b.time * 1000).toLocaleTimeString()}</td>
                    <td className="font-mono">
                      <Link className="underline" href={`/explorer/tx/${t.hash}`}>
                        {short(t.hash)}
                      </Link>
                    </td>
                    <td>{label(t.from)}</td>
                    <td>{t.to ? <Link href={`/explorer/address/${t.to}`}>{label(t.to)}</Link> : "—"}</td>
                    <td className="font-mono">{t.call ? `${t.call.contract}.${t.call.fn}` : "transfer"}</td>
                  </tr>
                )),
          )}
        </tbody>
      </table>
    </section>
  );
}
