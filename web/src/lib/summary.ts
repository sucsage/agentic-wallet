import "server-only";

import type { BankCustomerType, Currency } from "@/generated/prisma/client";

import { db } from "./db";
import { HttpError } from "./guard";

/**
 * Income and spending from the Mock Bank ledger of the user's linked accounts, plus a rough tax
 * estimate. Every number is computed here in code; the AI only gets these aggregates to explain.
 */

export type Summary = {
  currency: Currency;
  from: string;
  to: string;
  totals: { income: number; spent: number; refunds: number; net: number; openingDeposits: number };
  months: { month: string; income: number; spent: number; refunds: number }[];
  deals: { title: string; spent: number; refunded: number }[];
  tax: TaxEstimate | null;
};

export type TaxEstimate = {
  kind: "personal" | "company";
  year: number;
  income: number;
  taxable: number;
  tax: number;
  vatWarning: string | null;
  notes: string[];
};

const baht = (minor: bigint) => Number(minor) / 100;

/**
 * Thai tax, tax year rules as of 2026 (Revenue Department): personal income tax brackets with the
 * 40(2) flat 50% expense (cap 100,000) and the 60,000 personal allowance; SME corporate tax 0% on
 * the first 300,000 of profit, 15% to 3,000,000, 20% above. VAT registration from 1,800,000 a year.
 * An estimate from money that went through this app only.
 */
export function thaiTax(kind: "personal" | "company", income: number, expenses: number, year: number): TaxEstimate {
  const notes = ["Estimate only, from money that went through this app. Not tax advice."];
  let taxable: number;
  let tax = 0;
  if (kind === "personal") {
    taxable = Math.max(0, income - Math.min(income * 0.5, 100_000) - 60_000);
    const brackets: [number, number][] = [
      [150_000, 0],
      [300_000, 0.05],
      [500_000, 0.1],
      [750_000, 0.15],
      [1_000_000, 0.2],
      [2_000_000, 0.25],
      [5_000_000, 0.3],
      [Infinity, 0.35],
    ];
    let lower = 0;
    for (const [upper, rate] of brackets) {
      if (taxable > lower) tax += (Math.min(taxable, upper) - lower) * rate;
      lower = upper;
    }
    notes.push("Personal income tax, income type 40(2): 50% expense deduction (max 100,000) and 60,000 allowance.");
  } else {
    taxable = Math.max(0, income - expenses);
    tax = Math.max(0, Math.min(taxable, 3_000_000) - 300_000) * 0.15 + Math.max(0, taxable - 3_000_000) * 0.2;
    notes.push("SME corporate income tax on profit (paid-up capital up to 5M, revenue up to 30M).");
  }
  const vatWarning =
    income >= 1_800_000
      ? "Income passed 1,800,000: VAT registration is required."
      : income >= 1_500_000
        ? `Income is ${Math.round(income).toLocaleString("en-US")}; VAT registration is required from 1,800,000.`
        : null;
  return { kind, year, income, taxable, tax: Math.round(tax * 100) / 100, vatWarning, notes };
}

export async function buildSummary(
  userId: string,
  customer: { id: string; currency: Currency; type: BankCustomerType },
  from: Date,
  to: Date,
): Promise<Summary> {
  const accounts = await db.bankAccount.findMany({ where: { customerId: customer.id, linkedAt: { not: null } }, select: { id: true } });
  const ids = accounts.map((a) => a.id);
  const rows = await db.bankTransfer.findMany({
    where: { createdAt: { gte: from, lt: to }, OR: [{ fromId: { in: ids } }, { toId: { in: ids } }] },
    orderBy: { createdAt: "asc" },
  });
  const drafts = await db.dealDraft.findMany({ where: { userId, fundingId: { not: null } }, select: { title: true, fundingId: true } });
  const titleByFunding = new Map(drafts.map((d) => [d.fundingId!, d.title]));

  const totals = { income: 0, spent: 0, refunds: 0, net: 0, openingDeposits: 0 };
  const months = new Map<string, { month: string; income: number; spent: number; refunds: number }>();
  const deals = new Map<string, { title: string; spent: number; refunded: number }>();
  for (const t of rows) {
    const amount = baht(t.amount);
    const incoming = t.toId !== null && ids.includes(t.toId);
    const month = t.createdAt.toISOString().slice(0, 7);
    const m = months.get(month) ?? { month, income: 0, spent: 0, refunds: 0 };
    if ((t.kind === "DEPOSIT" || t.kind === "TOPUP") && incoming) totals.openingDeposits += amount;
    else if (t.kind === "FUND" && !incoming) {
      totals.spent += amount;
      m.spent += amount;
      const fundingId = t.idempotencyKey.match(/^funding:(0x[0-9a-f]+):debit$/)?.[1];
      const title = (fundingId && titleByFunding.get(fundingId)) || "Other deal";
      const d = deals.get(title) ?? { title, spent: 0, refunded: 0 };
      d.spent += amount;
      deals.set(title, d);
    } else if (t.kind === "REFUND" && incoming) {
      totals.refunds += amount;
      m.refunds += amount;
    } else if (t.kind === "PAYOUT" && incoming) {
      totals.income += amount;
      m.income += amount;
    }
    months.set(month, m);
  }
  totals.net = totals.income + totals.refunds - totals.spent;

  // `to` is exclusive (e.g. next 1 January), so the tax year is that of the last included moment.
  const year = new Date(+to - 1).getUTCFullYear();
  const tax =
    customer.currency === "THB"
      ? thaiTax(customer.type === "COMPANY" ? "company" : "personal", totals.income, Math.max(0, totals.spent - totals.refunds), year)
      : null;

  return {
    currency: customer.currency,
    from: from.toISOString(),
    to: to.toISOString(),
    totals,
    months: [...months.values()],
    deals: [...deals.values()].sort((a, b) => b.spent - a.spent),
    tax,
  };
}

export function summaryCsv(s: Summary): string {
  const lines = [
    "section,key,income,spent,refunds",
    ...s.months.map((m) => `month,${m.month},${m.income},${m.spent},${m.refunds}`),
    ...s.deals.map((d) => `deal,"${d.title.replace(/"/g, '""')}",,${d.spent},${d.refunded}`),
    `total,${s.currency},${s.totals.income},${s.totals.spent},${s.totals.refunds}`,
  ];
  if (s.tax) lines.push(`tax_estimate,${s.tax.kind} ${s.tax.year},${s.tax.income},,${s.tax.tax}`);
  return lines.join("\n") + "\n";
}

/** Parses ?from=YYYY-MM-DD&to=YYYY-MM-DD; defaults to the current calendar year. */
export function range(req: Request): { from: Date; to: Date } {
  const url = new URL(req.url);
  const year = new Date().getUTCFullYear();
  const from = new Date(url.searchParams.get("from") ?? `${year}-01-01`);
  const to = new Date(url.searchParams.get("to") ?? `${year + 1}-01-01`);
  if (Number.isNaN(+from) || Number.isNaN(+to) || from >= to) throw new HttpError(400, "Invalid from / to dates");
  return { from, to };
}
