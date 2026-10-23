// Demo data for the local Docker stack: people, wallets, friends, top-ups, transfers, a company and
// deals in every stage. It uses the app's own HTTP API and the chain, so the records are real; only
// the top-ups (Stripe is off locally) are written to the ledger directly.
// Runs once after `web` is healthy (service `seed`). Skips itself when the data is already there.
// Sign in to any person through the Mock Bank (Thailand): username below, PIN 123456.
import { createPublicClient, createWalletClient, getAddress, http, keccak256, toHex, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import pg from "pg";

import { agentWalletAbi, fileEscrowAbi } from "../src/lib/abis";

const BASE = process.env.SEED_BASE_URL ?? "http://localhost:3000";
// The address the app trusts as its own (BETTER_AUTH_URL / APP_ORIGIN): with WEB_PORT changed it is not
// http://localhost:3000, though the seed still reaches the app there inside the container network.
const ORIGIN = new URL(process.env.APP_ORIGIN || process.env.BETTER_AUTH_URL || BASE).origin;
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};
const log = (m: string) => console.log(`[seed] ${m}`);

const db = new pg.Client({ connectionString: env("DATABASE_URL") });
await db.connect();
const q = async (text: string, params: unknown[] = []) => (await db.query(text, params)).rows;

if (process.env.SEED_DEMO_DATA === "false") {
  log("SEED_DEMO_DATA=false: skipped");
  process.exit(0);
}
if ((await q(`SELECT 1 FROM "BankCustomer" WHERE username = 'somchai'`)).length) {
  log("demo data already present: skipped (docker compose down -v for a clean start)");
  process.exit(0);
}

// ---- http ------------------------------------------------------------------------------------
async function call(path: string, method: string, cookie: string, body?: unknown) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", origin: ORIGIN, cookie },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  const text = await r.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped responses
  let json: any;
  try { json = JSON.parse(text); } catch { json = text.slice(0, 300); }
  return { status: r.status, json, setCookie: r.headers.getSetCookie?.() ?? [] };
}
async function must(what: string, p: ReturnType<typeof call>) {
  const r = await p;
  if (r.status !== 200) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}

// ---- chain -----------------------------------------------------------------------------------
const RPC = env("RPC_URL");
const pub = createPublicClient({ chain: hardhat, transport: http(RPC) });
const walletOf = (k: string) => createWalletClient({ account: privateKeyToAccount(k as `0x${string}`), chain: hardhat, transport: http(RPC) });
const owner = walletOf(env("OWNER_PRIVATE_KEY"));
const seller = walletOf(env("CONTRACTOR_PRIVATE_KEY"));
const escrow = getAddress(env("FILE_ESCROW_ADDRESS"));
const mthb = getAddress(env("MTHB_ADDRESS"));
const arbiter = getAddress(env("ARBITER_ADDRESS"));
const wait = (h: `0x${string}`) => pub.waitForTransactionReceipt({ hash: h });
// The app's background demo seller uses the same key: a nonce clash is retried.
async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 6 || !/nonce/i.test(String((e as Error).message))) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
const baht = (n: number) => BigInt(Math.round(n * 100)); // satang

async function allowSeller(wallet: `0x${string}`) {
  await retry(async () => wait(await owner.writeContract({ address: wallet, abi: agentWalletAbi, functionName: "setRecipient", args: [seller.account.address, true] })));
}
async function offer(wallet: `0x${string}`, amount: number, note: string) {
  const id = Number(await pub.readContract({ address: escrow, abi: fileEscrowAbi, functionName: "dealCount" }));
  await retry(async () => wait(await seller.writeContract({
    address: escrow, abi: fileEscrowAbi, functionName: "offerToSell",
    args: [wallet, arbiter, mthb, [{ amount: baht(amount), hasFile: false, workHash: zeroHash }], 259_200n, note],
  })));
  return id;
}
const deliver = async (id: number, what: string) =>
  retry(async () => wait(await seller.writeContract({ address: escrow, abi: fileEscrowAbi, functionName: "deliver", args: [BigInt(id), 0n, keccak256(toHex(what)), `demo://${what}`] })));

// ---- people ----------------------------------------------------------------------------------
type Person = { username: string; name: string; userId: string; cookie: string; wallet: `0x${string}` };
const thaiId = (seed: string) => {
  const d = (seed + "0000000000000").slice(0, 12);
  const sum = [...d].reduce((t, c, i) => t + Number(c) * (13 - i), 0);
  return d + String((11 - (sum % 11)) % 10);
};

async function person(username: string, name: string, idSeed: string, birth: string): Promise<Person> {
  const reg = await must(`register ${username}`, call("/api/auth/mock-bank/register", "POST", "", { bank: "thai", username, displayName: name, pin: "123456" }));
  const authRes = await call("/api/auth/mock-bank/authorize", "POST", "", { ticket: reg.ticket, accountIds: [reg.accounts[0].id], consent: true });
  if (authRes.status !== 200) throw new Error(`authorize ${username}: ${authRes.status} ${JSON.stringify(authRes.json)}`);
  const cookie = authRes.setCookie.map((c) => c.split(";")[0]).join("; ");
  await must(`kyc ${username}`, call("/api/kyc", "POST", cookie, { country: "TH", legalName: name, idType: "NATIONAL_ID", idNumber: thaiId(idSeed), birthDate: birth }));
  const ws = await must(`wallet ${username}`, call("/api/workspace", "POST", cookie));
  log(`${username}: signed up, verified, wallet ${ws.address}`);
  return { username, name, userId: authRes.json.user.id, cookie, wallet: getAddress(ws.address) };
}

/** A top-up as the bank records it (Stripe is off locally): a ledger row plus the balance. */
async function topUp(wallet: string, amount: number, daysAgo = 0) {
  const [acct] = await q(`SELECT id FROM "BankAccount" WHERE "ownerAddress" = $1`, [wallet.toLowerCase()]);
  if (!acct) throw new Error(`no bank account for ${wallet}`);
  const key = `seed:topup:${wallet.toLowerCase()}:${amount}:${daysAgo}`;
  await q(`INSERT INTO "BankTransfer" (id,"idempotencyKey",kind,"fromId","toId",amount,"createdAt") VALUES ($1,$2,'TOPUP',NULL,$3,$4, now() - ($5 || ' days')::interval)`, [`seed${key.length}${Math.abs(hash(key))}`, key, acct.id, baht(amount).toString(), String(daysAgo)]);
  await q(`UPDATE "BankAccount" SET balance = balance + $1 WHERE id = $2`, [baht(amount).toString(), acct.id]);
}
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

const somchai = await person("somchai", "Somchai Prasert", "110170010001", "1985-04-12");
const nong = await person("nong", "Nongnaphat Wongsa", "310090020002", "1992-09-03");
const mali = await person("mali", "Malee Suksan", "150140030003", "1990-01-27");
const preecha = await person("preecha", "Preecha Charoen", "270010040004", "1988-11-19");
const all = [somchai, nong, mali, preecha];

// ---- friends ---------------------------------------------------------------------------------
for (const [a, b] of [[somchai, nong], [somchai, mali], [somchai, preecha], [nong, mali]] as const) {
  await must(`friend ${a.username}->${b.username}`, call("/api/friends", "POST", a.cookie, { username: b.username }));
  await must(`friend ${b.username}->${a.username}`, call("/api/friends", "POST", b.cookie, { username: a.username }));
}
log("friendships accepted");

// ---- money -----------------------------------------------------------------------------------
await topUp(somchai.wallet, 20_000, 9);
await topUp(somchai.wallet, 10_000, 3);
await topUp(nong.wallet, 8_000, 6);
await topUp(mali.wallet, 5_000, 5);
await topUp(preecha.wallet, 3_000, 4);
log("top-ups recorded");
const send = (from: Person, to: Person, amount: number) =>
  must(`transfer ${from.username}->${to.username}`, call("/api/transfers", "POST", from.cookie, { recipients: [{ userId: to.userId, amount }], requestId: crypto.randomUUID() }));
await send(somchai, nong, 1_500);
await send(mali, somchai, 300);
await send(somchai, preecha, 450);
await send(nong, mali, 200);
log("transfers between friends sent");

// ---- a company -------------------------------------------------------------------------------
const juristic = (() => {
  const d = "010555800001";
  const sum = [...d].reduce((t, c, i) => t + Number(c) * (13 - i), 0);
  return d + String((11 - (sum % 11)) % 10);
})();
const co = await must("company", call("/api/companies", "POST", somchai.cookie, {
  name: "Siam Craft Co., Ltd.", taxId: juristic, threshold: 2,
  members: [{ userId: mali.userId, canSign: true }, { userId: nong.userId, canSign: false }],
}));
const companyWallet = getAddress(co.wallet);
const [grp] = await q(`SELECT "groupId" FROM "Company" WHERE id = $1`, [co.id]);
// Stands in for the invitations being accepted (as the smoke test does).
await q(`INSERT INTO "GroupMember" ("groupId","userId",role,"canSign") VALUES ($1,$2,'MEMBER',true),($1,$3,'MEMBER',false) ON CONFLICT DO NOTHING`, [grp.groupId, mali.userId, nong.userId]);
await topUp(companyWallet, 50_000, 2);
log(`company Siam Craft Co., Ltd.: wallet ${companyWallet}, signers somchai + mali (2 of 2), nong cannot sign`);

// ---- deals in every stage --------------------------------------------------------------------
// A fresh deal can be a moment behind in the app's chain reads: retry a "not found".
async function act(p: Person, id: number, action: string, cookie = p.cookie) {
  for (let i = 0; ; i++) {
    const r = await call(`/api/deals/${id}/action`, "POST", cookie, { action, index: 0 });
    if (r.status === 200) return r.json;
    if (i >= 8 || r.status !== 404) throw new Error(`${action} deal ${id}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
    await new Promise((res) => setTimeout(res, 1500));
  }
}
for (const w of [somchai.wallet, nong.wallet, mali.wallet, companyWallet]) await allowSeller(w);

const d1 = await offer(somchai.wallet, 3_500, "Logo and brand sheet for the bakery");
await act(somchai, d1, "accept"); await deliver(d1, "logo-final"); await act(somchai, d1, "approve");
log(`deal ${d1}: Logo design, 3,500 THB, completed`);

const d2 = await offer(somchai.wallet, 1_200, "Product photos, 20 images");
await act(somchai, d2, "accept");
log(`deal ${d2}: Product photos, 1,200 THB, paid into escrow (the demo seller delivers it on its own shortly after)`);

const d3 = await offer(nong.wallet, 800, "Thai to English menu translation");
await act(nong, d3, "accept"); await deliver(d3, "menu-translation");
log(`deal ${d3}: Menu translation, 800 THB, delivered, waiting for nong to approve`);

const d4 = await offer(mali.wallet, 650, "Website copy, five pages");
log(`deal ${d4}: Website copy, 650 THB, offered, waiting for mali to accept`);

const companyCookie = (p: Person) => `${p.cookie}; aw_acting=${co.id}`;
const d5 = await offer(companyWallet, 5_000, "Packaging design for the spring range");
await act(somchai, d5, "accept", companyCookie(somchai)); await act(mali, d5, "accept", companyCookie(mali));
await deliver(d5, "packaging-design");
await act(somchai, d5, "approve", companyCookie(somchai)); await act(mali, d5, "approve", companyCookie(mali));
log(`deal ${d5}: company deal, 5,000 THB, two signers voted, completed`);

const d6 = await offer(companyWallet, 2_400, "Shop sign installation");
await act(somchai, d6, "accept", companyCookie(somchai));
log(`deal ${d6}: company deal, 2,400 THB, one of two signers has voted`);

log("done. Sign in (Thailand, PIN 123456) as somchai, nong, mali or preecha.");
await db.end();
