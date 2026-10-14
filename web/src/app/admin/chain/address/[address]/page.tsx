import Link from "next/link";

import { addressDetail, addressLabels } from "@/lib/explorer";

/** An address: what it is, its mTHB balance and its recent events. */
export default async function AdminAddressPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const [a, labels] = await Promise.all([addressDetail(address), addressLabels()]);
  if (!a) return <p className="card p-4 text-sm">Not an address: {address}</p>;

  return (
    <section className="card flex flex-col gap-3 p-4 text-sm">
      <h2 className="font-semibold">{labels.get(a.address.toLowerCase()) ?? (a.contract ? "Contract" : "Account")}</h2>
      <p className="break-all font-mono text-xs">{a.address}</p>
      <p className="text-xs text-muted">
        {a.contract ? "Smart contract" : "Key (externally owned account)"}
        {a.mthb !== null ? ` · mTHB balance ${a.mthb}` : ""}
      </p>
      <h3 className="font-semibold">Recent events emitted ({a.events.length})</h3>
      <ul className="flex flex-col gap-1 text-xs">
        {a.events.map((e, i) => (
          <li key={i} className="break-all font-mono">
            #{e.block} ·{" "}
            <Link className="underline" href={`/admin/chain/tx/${e.tx}`}>
              {e.tx.slice(0, 10)}…
            </Link>{" "}
            · <b>{e.event}</b> {e.args}
          </li>
        ))}
      </ul>
    </section>
  );
}
