import "server-only";

/**
 * Printable documents for a deal: the contract, a receipt, a payment request (ใบเบิกเงิน), a
 * tax invoice and, when something went wrong, a draft complaint with its evidence (เอกสารฟ้องร้อง). Each is one self-contained HTML page (print it, or "Save as PDF" in the browser's
 * print dialog). They are built from the terms both sides saw (their sha256 is on-chain) and the
 * milestone states on-chain. Demo: not legal or tax documents.
 */

export type DocType = "contract" | "receipt" | "request" | "tax" | "claim";

export const DOC_TYPES: DocType[] = ["contract", "receipt", "request", "tax", "claim"];

/** Milestones still owed to the seller: not paid, refunded or split yet. */
const UNPAID = ["Pending", "Delivered", "Approved", "KeyReleased", "Disputed"];
const READY = ["Delivered", "Approved", "KeyReleased"];

export type DocInput = {
  dealId: number;
  currency: "THB" | "CNY";
  status: string;
  kind: "HIRE" | "GOODS";
  title: string;
  summary: string | null;
  shipTo: string | null;
  reviewHours: number;
  termsHash: string | null;
  escrow: string | null;
  createdAt: string | null;
  buyer: { name: string; taxId?: string | null };
  seller: { name: string; taxId?: string | null };
  witnesses: { side: string; name: string; contact: string }[];
  milestones: {
    index: number;
    name: string;
    acceptance: string | null;
    amount: number;
    status: string;
    deadline: number;
    deposit: boolean;
    /** Rounds of changes agreed (0-10). */
    revisions?: number;
    paidToSeller: number;
    deliveredAt: string | null;
    /** What was delivered (the evidence), for the complaint. */
    delivery?: { note: string; fileName: string | null; sha256: string } | null;
  }[];
  /** The written rules and conditions, and the guarantors named by each side. */
  rules?: string | null;
  guarantors?: { side: string; name: string; contact: string; relation: string; amount: number | null }[];
  /** Who prints the document: the complaint is written from their side. */
  viewer?: "buyer" | "seller";
  disputes?: { index: number; phase: string; reason: string; status: string; stage: string; decision: string | null; rationale: string | null; sellerStatement: string | null; at: string; txHash: string | null }[];
};

const TITLES: Record<DocType, [string, string]> = {
  contract: ["สัญญาจ้าง / สัญญาซื้อขาย", "Contract"],
  receipt: ["ใบเสร็จรับเงิน", "Receipt"],
  request: ["ใบเบิกเงิน / ใบแจ้งขอรับเงิน", "Payment request"],
  tax: ["ใบกำกับภาษี", "Tax invoice"],
  claim: ["คำร้องเรียน / ร่างคำฟ้อง พร้อมพยานหลักฐาน", "Draft complaint and evidence file"],
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const date = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });

function money(n: number, c: "THB" | "CNY") {
  return `${c === "THB" ? "฿" : "¥"}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Which documents make sense for this deal now (the UI shows only these). */
export function availableDocs(d: Pick<DocInput, "status" | "milestones" | "disputes">): DocType[] {
  const paid = d.milestones.some((m) => m.paidToSeller > 0);
  const owed = d.status !== "Cancelled" && d.milestones.some((m) => UNPAID.includes(m.status));
  return ["contract", ...(owed ? (["request"] as const) : []), ...(paid ? (["receipt", "tax"] as const) : []), ...(d.status !== "Proposed" && d.status !== "Cancelled" ? (["claim"] as const) : [])];
}

/** What went wrong in a deal, in plain words: disputes, refunds, splits and missed deadlines. Empty: nothing to complain about. */
export function claimGrounds(d: Pick<DocInput, "milestones" | "disputes">, now = Date.now() / 1000): string[] {
  const out: string[] = [];
  for (const m of d.milestones) {
    const n = `Milestone ${m.index + 1} "${m.name}"`;
    if (m.status === "Disputed") out.push(`${n} is in dispute.`);
    else if (m.status === "Refunded") out.push(`${n} was refunded to the buyer after a dispute or a missed deadline.`);
    else if (m.status === "Split") out.push(`${n} was split between the parties by the arbiter.`);
    else if (m.status === "Pending" && m.deadline && m.deadline < now) out.push(`${n} was not delivered by its deadline.`);
  }
  for (const x of d.disputes ?? []) if (!d.milestones.some((m) => m.index === x.index && ["Disputed", "Refunded", "Split"].includes(m.status))) out.push(`Milestone ${x.index + 1}: a dispute was raised (${x.status.toLowerCase()}).`);
  return out;
}

/** The complaint: who, what was agreed, what happened (from the chain and the app's records), the evidence and what is claimed. */
function claimBody(d: DocInput, parties: string): string {
  const c = d.currency;
  const hire = d.kind === "HIRE";
  const me = d.viewer ?? "buyer";
  const claimant = me === "buyer" ? d.buyer : d.seller;
  const respondent = me === "buyer" ? d.seller : d.buyer;
  const grounds = claimGrounds(d);
  const total = d.milestones.reduce((t, m) => t + m.amount, 0);
  const paid = d.milestones.reduce((t, m) => t + m.paidToSeller, 0);
  const refunded = d.milestones.filter((m) => m.status === "Refunded").reduce((t, m) => t + m.amount, 0);
  const atStake = d.milestones.filter((m) => ["Disputed", "Pending", "Delivered", "Approved", "KeyReleased"].includes(m.status)).reduce((t, m) => t + m.amount, 0);
  const events: { at: string; text: string }[] = [];
  if (d.createdAt) events.push({ at: d.createdAt, text: `The deal's terms were written in the app (terms sha256 ${esc((d.termsHash ?? "—").slice(0, 16))}…).` });
  for (const m of d.milestones) {
    if (m.deliveredAt && m.deposit) events.push({ at: m.deliveredAt, text: `The deposit (milestone ${m.index + 1}) was paid to the ${hire ? "contractor" : "seller"} when the contract was signed.` });
    else if (m.deliveredAt) events.push({ at: m.deliveredAt, text: `Milestone ${m.index + 1} delivered by the ${hire ? "contractor" : "seller"}${m.delivery?.fileName ? `: file "${esc(m.delivery.fileName)}"` : ""} (sha256 ${esc((m.delivery?.sha256 ?? "").slice(0, 16))}… recorded on-chain).` });
  }
  for (const x of d.disputes ?? []) {
    events.push({ at: x.at, text: `Dispute on milestone ${x.index + 1} (${x.phase === "key" ? "the file key" : "the work"}): “${esc(x.reason)}”. Stage ${esc(x.stage.toLowerCase())}, status ${esc(x.status.toLowerCase())}${x.decision ? `, decided for the ${x.decision}` : ""}${x.rationale ? `: ${esc(x.rationale)}` : ""}${x.txHash ? ` (tx ${esc(x.txHash.slice(0, 18))}…)` : ""}.` });
  }
  events.sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const ms = d.milestones
    .map((m) => `<tr><td>${m.index + 1}</td><td><b>${esc(m.name)}</b><br><small>${esc(m.acceptance ?? "")}</small></td><td>${m.deadline ? date(new Date(m.deadline * 1000)) : "—"}</td><td>${esc(m.status)}</td><td class="r">${money(m.amount, c)}</td></tr>`)
    .join("");
  const evidence = [
    `The contract (CT-${String(d.dealId).padStart(5, "0")}) and its terms fingerprint: sha256 <code>${esc(d.termsHash ?? "—")}</code>.`,
    `The escrow smart contract${d.escrow ? ` <code>${esc(d.escrow)}</code>` : ""}, deal D-${d.dealId}: every offer, acceptance, delivery, approval, dispute and payment is a transaction on the chain (see the app's explorer).`,
    ...d.milestones.filter((m) => m.delivery && !m.deposit).map((m) => `Delivery of milestone ${m.index + 1}: ${m.delivery!.fileName ? `file "${esc(m.delivery!.fileName)}", ` : ""}sha256 <code>${esc(m.delivery!.sha256)}</code>${m.delivery!.note ? `; seller's note: “${esc(m.delivery!.note.slice(0, 300))}”` : ""}.`),
    ...(d.disputes ?? []).filter((x) => x.sellerStatement).map((x) => `The ${hire ? "contractor" : "seller"}'s statement in the dispute on milestone ${x.index + 1}: “${esc(x.sellerStatement!.slice(0, 400))}”.`),
    "Chat messages, emails and screenshots with the other party (attach printouts).",
  ];
  const line = '<span class="blank"></span>';
  return `
    ${parties.replace(hire ? "ผู้รับจ้าง · Contractor" : "ผู้ขาย · Seller", `${hire ? "ผู้รับจ้าง · Contractor" : "ผู้ขาย · Seller"}${me === "seller" ? " (ผู้ร้อง · claimant)" : " (ผู้ถูกร้อง · respondent)"}`).replace(hire ? "ผู้ว่าจ้าง · Client" : "ผู้ซื้อ · Buyer", `${hire ? "ผู้ว่าจ้าง · Client" : "ผู้ซื้อ · Buyer"}${me === "buyer" ? " (ผู้ร้อง · claimant)" : " (ผู้ถูกร้อง · respondent)"}`)}
    <p class="note">For a lawyer, the police (online fraud: call 1441 or report at thaipoliceonline.go.th) or a court (small claims and consumer cases at the district court, ศาลแขวง). Fill in the blanks, sign, and attach the evidence. Demo: not legal advice.</p>
    <h2>1. ข้อเท็จจริง · What was agreed</h2>
    <p><b>${esc(claimant.name)}</b> and <b>${esc(respondent.name)}</b> agreed on “${esc(d.title)}” (deal D-${d.dealId}), total <b>${money(total, c)}</b>, held in escrow and paid milestone by milestone after approval.</p>
    ${d.summary ? `<p>${esc(d.summary)}</p>` : ""}
    <table><thead><tr><th>#</th><th>Milestone and acceptance</th><th>Due</th><th>Status now</th><th class="r">Amount</th></tr></thead><tbody>${ms}</tbody>
    <tfoot><tr><td colspan="4">Paid to the ${hire ? "contractor" : "seller"} · refunded to the buyer</td><td class="r">${money(paid, c)} · ${money(refunded, c)}</td></tr></tfoot></table>
    ${(d.guarantors ?? []).filter((g) => g.side !== me).map((g) => `<p><b>Guarantor of the respondent:</b> ${esc(g.name)} (${esc(g.relation)}, ${esc(g.contact)}), guaranteed ${g.amount ? `up to ${money(g.amount, c)}` : "their whole obligation"} in the contract: may be named as a co-respondent.</p>`).join("")}
    ${d.rules ? `<p><b>Rules and conditions</b> agreed in the contract apply (see CT-${String(d.dealId).padStart(5, "0")}).</p>` : ""}
    <h2>2. เหตุแห่งการร้อง · What went wrong</h2>
    ${grounds.length ? `<ul>${grounds.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : "<p>No dispute, refund or missed deadline is recorded for this deal.</p>"}
    <p>In my own words: ${line}${line}${line}</p>
    <h2>3. ลำดับเหตุการณ์ · Timeline (from the app and the chain)</h2>
    ${events.length ? `<table><tbody>${events.map((e) => `<tr><td style="width:120px">${date(new Date(e.at))}</td><td>${e.text}</td></tr>`).join("")}</tbody></table>` : "<p>—</p>"}
    <h2>4. พยานหลักฐาน · Evidence</h2>
    <ol class="terms">${evidence.map((e) => `<li>${e}</li>`).join("")}</ol>
    <h2>5. คำขอ · What I ask for</h2>
    <p>Amount still at stake in escrow: <b>${money(atStake, c)}</b>. I ask that ${esc(respondent.name)} ${me === "buyer" ? (hire ? "deliver the work as agreed or return" : "deliver the item as agreed or return") : "pay"} ${line} (amount: ${line}), with interest and costs as the law allows.</p>
    <section class="signs"><div class="sign"><div class="line"></div><b>${esc(claimant.name)}</b><small>ผู้ร้อง · Claimant · date ${line}</small></div><div class="sign"><div class="line"></div><b>${line}</b><small>พยาน · Witness</small></div></section>`;
}

export function renderDealDocument(type: DocType, d: DocInput): string {
  const [th, en] = TITLES[type];
  const no = `${{ contract: "CT", receipt: "RC", request: "PR", tax: "TX", claim: "CL" }[type]}-${String(d.dealId).padStart(5, "0")}`;
  const c = d.currency;
  const hire = d.kind === "HIRE";
  const sellerRole = hire ? "ผู้รับจ้าง · Contractor" : "ผู้ขาย · Seller";
  const buyerRole = hire ? "ผู้ว่าจ้าง · Client" : "ผู้ซื้อ · Buyer";
  const today = date(new Date());

  const parties = `
  <section class="parties">
    <div><small>${type === "receipt" || type === "tax" ? "ผู้ออกเอกสาร · Issued by" : sellerRole}</small><b>${esc(d.seller.name)}</b>${d.seller.taxId ? `<span>Tax ID ${esc(d.seller.taxId)}</span>` : ""}</div>
    <div><small>${type === "receipt" || type === "tax" ? "ลูกค้า · Customer" : buyerRole}</small><b>${esc(d.buyer.name)}</b>${d.buyer.taxId ? `<span>Tax ID ${esc(d.buyer.taxId)}</span>` : ""}</div>
  </section>`;

  let body = "";
  if (type === "claim") {
    body = claimBody(d, parties);
  } else if (type === "contract") {
    const rows = d.milestones
      .map(
        (m) => `<tr><td>${m.index + 1}</td><td><b>${esc(m.name)}</b>${m.deposit ? " <em>(มัดจำ · deposit, paid on signing)</em>" : ""}<br><small>${esc(m.acceptance ?? "")}${!m.deposit && typeof m.revisions === "number" ? ` · แก้งานได้ ${m.revisions} รอบ · ${m.revisions} rounds of changes` : ""}</small></td><td>${m.deadline ? date(new Date(m.deadline * 1000)) : "—"}</td><td class="r">${money(m.amount, c)}</td></tr>`,
      )
      .join("");
    const total = d.milestones.reduce((t, m) => t + m.amount, 0);
    const witness = (side: string) => d.witnesses.find((w) => w.side === side);
    const sign = (label: string, name: string, w?: { name: string; contact: string }) => `
      <div class="sign"><div class="line"></div><b>${esc(name)}</b><small>${label}</small>
      ${w ? `<div class="line"></div><b>${esc(w.name)}</b><small>พยาน · Witness${w.contact ? ` · ${esc(w.contact)}` : ""}</small>` : ""}</div>`;
    body = `
    ${parties}
    <h2>${esc(d.title)}</h2>
    ${d.summary ? `<p>${esc(d.summary)}</p>` : ""}
    <table><thead><tr><th>#</th><th>งวดงาน · Milestone and acceptance</th><th>กำหนด · Due</th><th class="r">จำนวนเงิน · Amount</th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr><td colspan="3">รวม · Total</td><td class="r">${money(total, c)}</td></tr></tfoot></table>
    ${d.shipTo ? `<p><b>ที่อยู่จัดส่ง · Ship to:</b> ${esc(d.shipTo)}</p>` : ""}
    <ol class="terms">
      <li>The total is held in an escrow smart contract (deal D-${d.dealId}${d.escrow ? `, ${esc(d.escrow)}` : ""}) and paid to the ${hire ? "contractor" : "seller"} milestone by milestone, after the ${hire ? "client" : "buyer"} approves each delivery.</li>
      <li>The ${hire ? "client" : "buyer"} has ${d.reviewHours} hours to review each delivery: approve it, or open a dispute that a neutral arbiter decides. Silence after that window lets the ${hire ? "contractor" : "seller"} claim the milestone.</li>
      ${d.milestones[0]?.deposit ? `<li>Milestone 1 is a deposit, paid as soon as this contract is signed (the offer accepted on-chain).</li>` : ""}
      <li>Signing: acceptance of the offer on-chain is the signature of both parties. Terms fingerprint: sha256 <code>${esc(d.termsHash ?? "—")}</code>.</li>
    </ol>
    ${d.rules ? `<h2>กฎระเบียบและข้อตกลง · Rules and conditions</h2><div class="rules">${esc(d.rules).replace(/\n/g, "<br>")}</div>` : ""}
    ${(d.guarantors ?? []).length ? `<h2>ผู้ค้ำประกัน · Guarantors</h2><ol class="terms">${(d.guarantors ?? []).map((g) => `<li><b>${esc(g.name)}</b> (${esc(g.relation)}, ${esc(g.contact)}) guarantees the obligations of the ${g.side === "buyer" ? buyerRole : sellerRole} under this contract${g.amount ? `, up to ${money(g.amount, c)}` : ", in full"}: if that party does not perform and does not make it good, the guarantor answers for it to the other party.</li>`).join("")}</ol>` : ""}
    <p class="status">Status on-chain: <b>${esc(d.status)}</b>${d.status === "Proposed" ? " (not signed yet: waiting for the other side to accept)" : ""}</p>
    <section class="signs">${sign(buyerRole, d.buyer.name, witness("buyer"))}${sign(sellerRole, d.seller.name, witness("seller"))}</section>
    ${(d.guarantors ?? []).length ? `<section class="signs">${(d.guarantors ?? []).map((g) => `<div class="sign"><div class="line"></div><b>${esc(g.name)}</b><small>ผู้ค้ำประกัน · Guarantor of the ${g.side}</small></div>`).join("")}</section>` : ""}`;
  } else {
    // A payment request lists what was delivered and waits for approval; before any delivery, the
    // next milestone owed (requested on delivery).
    const ready = d.milestones.filter((m) => READY.includes(m.status));
    const next = d.milestones.find((m) => UNPAID.includes(m.status));
    const lines =
      type === "request"
        ? (ready.length ? ready : next ? [next] : []).map((m) => ({ m, amount: m.amount }))
        : d.milestones.filter((m) => m.paidToSeller > 0).map((m) => ({ m, amount: m.paidToSeller }));
    const total = lines.reduce((t, l) => t + l.amount, 0);
    // Amounts in the app include VAT where the seller is VAT-registered: 7 / 107 of the total.
    const vat = type === "tax" ? Math.round((total * 7) / 107 * 100) / 100 : 0;
    const rows = lines
      .map(
        ({ m, amount }) =>
          `<tr><td>${m.index + 1}</td><td><b>${esc(m.name)}</b><br><small>${type === "request" ? (READY.includes(m.status) ? `Delivered${m.deliveredAt ? ` ${date(new Date(m.deliveredAt))}` : ""} · ${esc(m.status)}` : `Payable on delivery${m.deadline ? ` · due ${date(new Date(m.deadline * 1000))}` : ""} · ${esc(m.status)}`) : `Paid from escrow · ${esc(m.status)}`}</small></td><td class="r">${money(type === "tax" ? amount - Math.round((amount * 7) / 107 * 100) / 100 : amount, c)}</td></tr>`,
      )
      .join("");
    body = `
    ${parties}
    <h2>${esc(d.title)} · D-${d.dealId}</h2>
    <table><thead><tr><th>#</th><th>รายการ · Item</th><th class="r">${type === "tax" ? "มูลค่าก่อนภาษี · Before VAT" : "จำนวนเงิน · Amount"}</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="3">Nothing ${type === "request" ? "to request" : "paid"} yet.</td></tr>`}</tbody>
    <tfoot>
      ${type === "tax" ? `<tr><td colspan="2">มูลค่าสินค้า/บริการ · Subtotal</td><td class="r">${money(total - vat, c)}</td></tr><tr><td colspan="2">ภาษีมูลค่าเพิ่ม 7% · VAT 7%</td><td class="r">${money(vat, c)}</td></tr>` : ""}
      <tr><td colspan="2">${type === "request" ? "ยอดที่ขอเบิก · Amount requested" : "รวมทั้งสิ้น · Total"}</td><td class="r">${money(total, c)}</td></tr>
    </tfoot></table>
    ${
      type === "request"
        ? `<p>The ${hire ? "contractor" : "seller"} requests payment of the milestones above, delivered under contract CT-${String(d.dealId).padStart(5, "0")}. Approving them in the app releases the money from escrow.</p>`
        : `<p>Received in full through escrow deal D-${d.dealId}. ${type === "tax" ? "Prices include VAT. The seller's VAT registration is not checked by this demo." : ""}</p>`
    }
    <section class="signs"><div class="sign"><div class="line"></div><b>${esc(d.seller.name)}</b><small>${type === "request" ? "ผู้ขอเบิก · Requested by" : "ผู้รับเงิน · Received by"}</small></div></section>`;
  }

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${en} ${no} · D-${d.dealId}</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}body{margin:0;background:#e9e9ee;font:14px/1.55 "Sarabun","Noto Sans Thai",system-ui,sans-serif;color:#111}
.bar{position:sticky;top:0;display:flex;justify-content:center;gap:8px;padding:10px;background:#111;color:#fff}
.bar button{padding:8px 16px;border:0;border-radius:8px;background:#fff;color:#111;font-weight:700;cursor:pointer}
.page{width:210mm;min-height:297mm;margin:16px auto;padding:18mm 16mm;background:#fff;box-shadow:0 4px 24px #0002;position:relative}
.demo{position:absolute;top:8mm;right:16mm;padding:3px 8px;border:1px solid #c00;color:#c00;font-size:11px;font-weight:700;border-radius:4px}
header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:14px}
header h1{margin:0;font-size:22px}header h1 small{display:block;font-size:13px;color:#555;font-weight:500}
header div:last-child{text-align:right;font-size:12px;color:#444}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
.parties div{padding:10px 12px;border:1px solid #ddd;border-radius:8px}.parties small,.sign small{display:block;color:#666;font-size:11px}.parties span{display:block;font-size:12px;color:#444}
h2{font-size:16px;margin:12px 0 6px}
table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:7px 8px;border-bottom:1px solid #e3e3e3;text-align:left;vertical-align:top}th{background:#f5f5f7;font-size:12px}
td small{color:#666}.r{text-align:right;white-space:nowrap}tfoot td{font-weight:700;border-top:2px solid #111}
.terms{font-size:12.5px;color:#333;padding-left:18px}code{font-size:10.5px;word-break:break-all}
.status{font-size:12.5px}
.signs{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:36px}.sign .line{border-bottom:1px solid #111;height:42px;margin-top:18px}
.note{font-size:12px;color:#444;background:#fff8e6;border:1px solid #f0d58c;border-radius:8px;padding:8px 10px}
.rules{font-size:12.5px;color:#222;border:1px solid #ddd;border-radius:8px;padding:10px 12px;background:#fafafa}
.blank{display:inline-block;min-width:180px;border-bottom:1px dotted #555;margin:0 4px;height:1.2em}
footer{margin-top:28px;font-size:10.5px;color:#777;border-top:1px solid #ddd;padding-top:6px}
@media print{body{background:#fff}.bar{display:none}.page{margin:0;box-shadow:none;width:auto;min-height:0}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Print / Save as PDF</button></div>
<main class="page">
<span class="demo">DEMO · TEST MONEY</span>
<header><h1>${th}<small>${en}</small></h1><div>No. <b>${no}</b><br>Deal D-${d.dealId}<br>Date ${today}</div></header>
${body}
<footer>Agentic Wallet · generated from the deal's terms and the escrow contract's on-chain state. Demo document with test money: not a legal contract, receipt, tax invoice or legal advice.</footer>
</main></body></html>`;
}
