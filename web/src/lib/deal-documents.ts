import "server-only";

/**
 * Printable documents for a deal: the contract, a receipt, a payment request (ใบเบิกเงิน) and a
 * tax invoice. Each is one self-contained HTML page (print it, or "Save as PDF" in the browser's
 * print dialog). They are built from the terms both sides saw (their sha256 is on-chain) and the
 * milestone states on-chain. Demo: not legal or tax documents.
 */

export type DocType = "contract" | "receipt" | "request" | "tax";

export const DOC_TYPES: DocType[] = ["contract", "receipt", "request", "tax"];

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
  milestones: { index: number; name: string; acceptance: string | null; amount: number; status: string; deadline: number; deposit: boolean; paidToSeller: number; deliveredAt: string | null }[];
};

const TITLES: Record<DocType, [string, string]> = {
  contract: ["สัญญาจ้าง / สัญญาซื้อขาย", "Contract"],
  receipt: ["ใบเสร็จรับเงิน", "Receipt"],
  request: ["ใบเบิกเงิน / ใบแจ้งขอรับเงิน", "Payment request"],
  tax: ["ใบกำกับภาษี", "Tax invoice"],
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const date = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });

function money(n: number, c: "THB" | "CNY") {
  return `${c === "THB" ? "฿" : "¥"}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Which documents make sense for this deal now (the UI shows only these). */
export function availableDocs(d: Pick<DocInput, "status" | "milestones">): DocType[] {
  const paid = d.milestones.some((m) => m.paidToSeller > 0);
  const payable = d.milestones.some((m) => ["Delivered", "Approved", "KeyReleased"].includes(m.status));
  return ["contract", ...(payable ? (["request"] as const) : []), ...(paid ? (["receipt", "tax"] as const) : [])];
}

export function renderDealDocument(type: DocType, d: DocInput): string {
  const [th, en] = TITLES[type];
  const no = `${{ contract: "CT", receipt: "RC", request: "PR", tax: "TX" }[type]}-${String(d.dealId).padStart(5, "0")}`;
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
  if (type === "contract") {
    const rows = d.milestones
      .map(
        (m) => `<tr><td>${m.index + 1}</td><td><b>${esc(m.name)}</b>${m.deposit ? " <em>(มัดจำ · deposit, paid on signing)</em>" : ""}<br><small>${esc(m.acceptance ?? "")}</small></td><td>${m.deadline ? date(new Date(m.deadline * 1000)) : "—"}</td><td class="r">${money(m.amount, c)}</td></tr>`,
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
    <p class="status">Status on-chain: <b>${esc(d.status)}</b>${d.status === "Proposed" ? " (not signed yet: waiting for the other side to accept)" : ""}</p>
    <section class="signs">${sign(buyerRole, d.buyer.name, witness("buyer"))}${sign(sellerRole, d.seller.name, witness("seller"))}</section>`;
  } else {
    const lines =
      type === "request"
        ? d.milestones.filter((m) => ["Delivered", "Approved", "KeyReleased"].includes(m.status)).map((m) => ({ m, amount: m.amount }))
        : d.milestones.filter((m) => m.paidToSeller > 0).map((m) => ({ m, amount: m.paidToSeller }));
    const total = lines.reduce((t, l) => t + l.amount, 0);
    // Amounts in the app include VAT where the seller is VAT-registered: 7 / 107 of the total.
    const vat = type === "tax" ? Math.round((total * 7) / 107 * 100) / 100 : 0;
    const rows = lines
      .map(
        ({ m, amount }) =>
          `<tr><td>${m.index + 1}</td><td><b>${esc(m.name)}</b><br><small>${type === "request" ? `Delivered${m.deliveredAt ? ` ${date(new Date(m.deliveredAt))}` : ""} · ${esc(m.status)}` : `Paid from escrow · ${esc(m.status)}`}</small></td><td class="r">${money(type === "tax" ? amount - Math.round((amount * 7) / 107 * 100) / 100 : amount, c)}</td></tr>`,
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
footer{margin-top:28px;font-size:10.5px;color:#777;border-top:1px solid #ddd;padding-top:6px}
@media print{body{background:#fff}.bar{display:none}.page{margin:0;box-shadow:none;width:auto;min-height:0}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Print / Save as PDF</button></div>
<main class="page">
<span class="demo">DEMO · TEST MONEY</span>
<header><h1>${th}<small>${en}</small></h1><div>No. <b>${no}</b><br>Deal D-${d.dealId}<br>Date ${today}</div></header>
${body}
<footer>Agentic Wallet · generated from the deal's terms and the escrow contract's on-chain state. Demo document with test money: not a legal contract, receipt or tax invoice.</footer>
</main></body></html>`;
}
