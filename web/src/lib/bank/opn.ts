import "server-only";

/**
 * Opn Payments (formerly Omise), test mode: real bank transfers to people who never signed up.
 * An invited seller who chooses a Thai bank account becomes an Opn recipient (name, bank, account
 * number); each milestone they are paid is then sent as an Opn transfer from the platform's Opn
 * balance. Opn requires every new recipient to be verified and activated before money can go to
 * it; activation is done by the operator in Opn's dashboard (it cannot be done through the API),
 * which is the payee review a regulated payout would have anyway.
 *
 * Test mode only (skey_test_): in test mode the verify step and the bank's "sent" / "paid"
 * confirmations are triggered through Opn's test endpoints.
 */

export class OpnError extends Error {}

export const opnEnabled = () => Boolean(process.env.OMISE_SECRET_KEY);

function key(): string {
  const k = process.env.OMISE_SECRET_KEY;
  if (!k) throw new OpnError("Opn Payments is not configured");
  if (!k.startsWith("skey_test_")) throw new OpnError("Only an Opn test key may be used");
  return k;
}

async function opn<T>(path: string, body?: Record<string, string>, method?: string): Promise<T> {
  const res = await fetch(`https://api.omise.co/${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { authorization: `Basic ${Buffer.from(`${key()}:`).toString("base64")}`, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: body ? new URLSearchParams(body) : undefined,
  });
  const json = (await res.json()) as T & { object?: string; message?: string };
  if (!res.ok || json.object === "error") throw new OpnError(json.message ?? `Opn error ${res.status}`);
  return json;
}

/** Our bank codes → Opn bank brands (Thailand). KKP is not offered by Opn. */
const BRAND: Record<string, string> = {
  BBL: "bbl",
  KBANK: "kbank",
  KTB: "ktb",
  SCB: "scb",
  BAY: "bay",
  TTB: "ttb",
  GSB: "gsb",
  BAAC: "baac",
  UOB: "uob",
  CIMBT: "cimb",
  LH: "lhb",
  TISCO: "tisco",
  GHB: "ghb",
};

type Recipient = { id: string; verified: boolean; active: boolean };
type Transfer = { id: string; sendable: boolean; sent: boolean; paid: boolean; failure_message: string | null };

/** Creates the seller as an Opn recipient and marks it verified (test mode). Activation stays with the operator. */
export async function createRecipient(input: { name: string; bank: string; accountNo: string }): Promise<string> {
  const brand = BRAND[input.bank];
  if (!brand) throw new OpnError(`${input.bank} is not available for bank payouts`);
  const r = await opn<Recipient>("recipients", {
    name: input.name,
    type: "individual",
    description: "Agentic Wallet invited seller",
    "bank_account[brand]": brand,
    "bank_account[number]": input.accountNo,
    "bank_account[name]": input.name,
  });
  await opn<Recipient>(`recipients/${r.id}/verify`, {}, "PATCH");
  return r.id;
}

export function recipient(id: string) {
  return opn<Recipient>(`recipients/${id}`);
}

/**
 * Sends `amount` (satang) to the recipient. In test mode the bank's confirmations are triggered
 * right away, so the transfer ends paid.
 */
export async function sendTransfer(recipientId: string, amount: bigint, ref: string): Promise<Transfer> {
  const t = await opn<Transfer>("transfers", { amount: amount.toString(), recipient: recipientId, "metadata[ref]": ref });
  if (!t.sendable) throw new OpnError(t.failure_message ?? "The transfer cannot be sent yet (balance or recipient)");
  await opn<Transfer>(`transfers/${t.id}/mark_as_sent`, {});
  return opn<Transfer>(`transfers/${t.id}/mark_as_paid`, {});
}

/** Finds a transfer made for `ref` (after a crash between creating it and recording it). */
export async function findTransfer(ref: string): Promise<Transfer | null> {
  const list = await opn<{ data: (Transfer & { metadata: Record<string, string> })[] }>("transfers?limit=100&order=reverse_chronological");
  return list.data.find((t) => t.metadata?.ref === ref) ?? null;
}
