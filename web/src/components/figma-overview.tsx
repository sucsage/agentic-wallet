"use client";

import Link from "next/link";

const milestones = [
  { id: "D-014", name: "M1 · Material Delivery", detail: "Contract 0x8f…3A2b · evidence on-chain", amount: "$400 mUSDC", status: "Auto-released · Tier 2", tone: "success" },
  { id: "D-013", name: "M2 · FAT Report", detail: "$2,000 is above cap · needs 2 human approvals", amount: "$2,000 mUSDC", status: "Review · 1/2 approved", tone: "pending" },
  { id: "D-012", name: "M3 · SAT Report", detail: "Agent refused · evidence incomplete", amount: "$2,000 mUSDC", status: "Refused", tone: "refused" },
];

export function FigmaOverview() {
  return <div className="aw-figma-overview">
    <section className="aw-figma-balance" aria-labelledby="wallet-balance">
      <h1 id="wallet-balance">Agent Wallet Balance</h1>
      <p className="aw-figma-amount">$9,680.00 <span>mUSDC</span></p>
      <div className="aw-figma-balance-footer">
        <div className="aw-figma-pills"><span><i />Agent active</span><span>Session key expires in 6d 4h</span><span>Base Sepolia</span></div>
        <div className="aw-figma-actions"><a href="https://sepolia.basescan.org" target="_blank" rel="noreferrer" className="aw-button aw-button-outline">View on BaseScan ↗</a><Link href="/chat" className="aw-button">＋ Deploy Escrow</Link></div>
      </div>
    </section>
    <div className="aw-figma-metrics">
      <section><h2>Per-tx cap</h2><strong>$500</strong><p>Above the cap becomes a Tier 1 proposal</p></section>
      <section><h2>Daily cap used</h2><strong>$320 <small>/ $1,000</small></strong><progress value={320} max={1000} aria-label="Daily cap used" /><p>32% of the daily limit</p></section>
      <section><h2>Pending approvals</h2><strong className="aw-figma-yellow">1</strong><p>Approver A signed · Approver B waiting</p></section>
      <section><h2>Guards</h2><strong className="aw-figma-green">All passing</strong><p>Guard 1 policy engine · Guard 2 contract</p></section>
    </div>
    <div className="aw-figma-bottom">
      <section aria-labelledby="milestones"><h2 id="milestones">Active Milestones</h2><div className="aw-figma-milestones">{milestones.map(m => <Link key={m.id} href={`/deal/${m.id}`} className={`aw-figma-milestone ${m.tone}`}><i /><div><h3>{m.name}</h3><p>{m.detail}</p></div><div className="aw-figma-milestone-value"><strong>{m.amount}</strong><span>{m.status}</span></div></Link>)}</div></section>
      <section className="aw-figma-activity" aria-labelledby="activity"><h2 id="activity">Agent Activity</h2><div className="aw-figma-activity-card"><div className="aw-figma-event"><span aria-hidden="true">✓</span><div><p><time>10:42</time> <b>Evidence verified</b></p><small>FAT_Report.pdf hash 0x4c…9e1 found on-chain.</small></div></div></div></section>
    </div>
    <p className="aw-figma-demo">Demo overview · sample balances and activity · mUSDC has no monetary value</p>
  </div>;
}
