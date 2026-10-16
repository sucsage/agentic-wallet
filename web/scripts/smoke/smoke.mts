// Smoke test of the main money flow, against the local stack that run.sh starts.
//   cd web && npm run smoke        (do not run this file directly: it needs the stack and its env)
//
// A company with two signers and a member who cannot sign receives a seller's offer on chain. The
// flow: refuse non-signers, a signer accepts and pays, the seller delivers, a signer approves, the
// seller is paid, and a settled milestone refuses every further move. Each check prints PASS or FAIL;
// the exit code is 1 if any check fails. Only Hardhat's public test keys are used.
import { execFileSync } from "node:child_process";

import { createPublicClient, createWalletClient, getAddress, http, keccak256, toHex, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

import { agentWalletAbi, fileEscrowAbi } from "../../src/lib/abis";

const BASE = "http://localhost:3000";
const RPC = "http://127.0.0.1:8545";
const DB = process.env.SMOKE_DB_CONTAINER ?? "aw-smoke-pg";
const ts = Date.now().toString(36);
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}: run this through npm run smoke`);
  return v;
};

// ---- tiny harness ----------------------------------------------------------------------------
let failures = 0;
const results: string[] = [];
function check(name: string, ok: boolean, evidence: unknown) {
  const ev = typeof evidence === "string" ? evidence : JSON.stringify(evidence);
  const line = `${ok ? "PASS" : "FAIL"}  ${name}${ev ? `  (${ev.slice(0, 220)})` : ""}`;
  console.log(line);
  results.push(line);
  if (!ok) failures++;
}
const sql = (q: string) =>
  execFileSync("docker", ["exec", DB, "psql", "-U", "postgres", "-d", "awsmoke", "-At", "-c", q]).toString().trim();

async function call(path: string, method: string, cookie: string, body?: unknown) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", origin: BASE, cookie },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  const text = await r.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text.slice(0, 300); }
  return { status: r.status, json, setCookie: r.headers.getSetCookie?.() ?? [] };
}

type Person = { name: string; userId: string; cookie: string };
async function signUp(name: string): Promise<Person> {
  const username = `${name}${ts}`;
  const reg = await call("/api/auth/mock-bank/register", "POST", "", { bank: "thai", username, displayName: `${name} ${ts}`, pin: "123456" });
  if (reg.status !== 200) throw new Error(`register ${name}: ${reg.status} ${JSON.stringify(reg.json)}`);
  const auth = await call("/api/auth/mock-bank/authorize", "POST", "", { ticket: reg.json.ticket, accountIds: [reg.json.accounts[0].id], consent: true });
  if (auth.status !== 200) throw new Error(`authorize ${name}: ${auth.status} ${JSON.stringify(auth.json)}`);
  return { name, userId: auth.json.user.id, cookie: auth.setCookie.map((c) => c.split(";")[0]).join("; ") };
}

// ---- chain access ----------------------------------------------------------------------------
const pub = createPublicClient({ chain: hardhat, transport: http(RPC) });
const walletOf = (k: string) => createWalletClient({ account: privateKeyToAccount(k as `0x${string}`), chain: hardhat, transport: http(RPC) });
const owner = walletOf(env("OWNER_PRIVATE_KEY"));
const seller = walletOf(env("CONTRACTOR_PRIVATE_KEY"));
const escrow = getAddress(env("FILE_ESCROW_ADDRESS"));
const mthb = getAddress(env("MTHB_ADDRESS"));
const arbiter = getAddress(env("ARBITER_ADDRESS"));
const wait = (h: `0x${string}`) => pub.waitForTransactionReceipt({ hash: h });
const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const;
const tokenBalance = (a: string) => pub.readContract({ address: mthb, abi: erc20, functionName: "balanceOf", args: [getAddress(a)] });
const dealStatus = async (id: number) => Number((await pub.readContract({ address: escrow, abi: fileEscrowAbi, functionName: "getDeal", args: [BigInt(id)] })).status);
const milestoneStatus = async (id: number) => Number((await pub.readContract({ address: escrow, abi: fileEscrowAbi, functionName: "getMilestone", args: [BigInt(id), 0n] })).status);
const M = { Pending: 0, Delivered: 1, Approved: 2, KeyReleased: 3, Released: 4, Disputed: 5, Refunded: 6, Split: 7 };
const AMOUNT = 50_000n; // 500 THB in satang

async function offerToCompany(wallet: `0x${string}`, note: string) {
  const before = await pub.readContract({ address: escrow, abi: fileEscrowAbi, functionName: "dealCount" });
  await wait(await seller.writeContract({
    address: escrow, abi: fileEscrowAbi, functionName: "offerToSell",
    args: [wallet, arbiter, mthb, [{ amount: AMOUNT, hasFile: false, workHash: zeroHash }], 259_200n, note],
  }));
  return Number(before);
}

// ---- 1. people, company --------------------------------------------------------------------
const adm = await signUp("adm"), sig = await signUp("sig"), mem = await signUp("mem"), out = await signUp("out");
check("four users sign up through the Mock Bank", [adm, sig, mem, out].every((p) => p.userId), { users: 4 });

sql(`INSERT INTO "KycVerification" (id,"userId",provider,"subjectHash","maskedId","verifiedName") VALUES ('kyc${ts}','${adm.userId}','THAID','hash${ts}','1-1234-xxxxx-xx-1','Adm Test')`);
for (const u of [sig, mem]) {
  sql(`INSERT INTO "Friendship" (id,"requesterId","addresseeId",status,"acceptedAt") VALUES ('fr${u.name}${ts}','${adm.userId}','${u.userId}','ACCEPTED',now())`);
}
const digits = "010555800001";
const sum = [...digits].reduce((t, d, i) => t + Number(d) * (13 - i), 0);
const taxId = digits + String((11 - (sum % 11)) % 10);
const co = await call("/api/companies", "POST", adm.cookie, {
  name: `Smoke Co ${ts}`, taxId, threshold: 2,
  members: [{ userId: sig.userId, canSign: true }, { userId: mem.userId, canSign: false }],
});
check("a company with two signers and one non-signer is created", co.status === 200, { status: co.status, body: co.json });
if (co.status !== 200) { console.log("cannot continue without a company"); process.exit(1); }
const companyId = co.json.id as string;
const wallet = getAddress(co.json.wallet);
const groupId = sql(`SELECT "groupId" FROM "Company" WHERE id='${companyId}'`);
// Stands in for the two invitations being accepted.
sql(`INSERT INTO "GroupMember" ("groupId","userId",role,"canSign") VALUES ('${groupId}','${sig.userId}','MEMBER',true),('${groupId}','${mem.userId}','MEMBER',false)`);
const acct = `"ownerAddress"='${wallet.toLowerCase()}'`;
sql(`UPDATE "BankAccount" SET balance=1000000 WHERE ${acct}`);
const balance = () => BigInt(sql(`SELECT balance FROM "BankAccount" WHERE ${acct}`));
const START = balance();
check("the company account starts with 10,000 baht", START === 1_000_000n, String(START));

const acting = (p: Person) => `${p.cookie}; aw_acting=${companyId}`;
const me = await call("/api/me", "GET", acting(mem));
check("a non-signer member can switch to acting as the company", me.json?.acting?.companyId === companyId, me.json?.acting);
const meOut = await call("/api/me", "GET", acting(out));
check("an outsider cannot switch to the company", !meOut.json?.acting, meOut.json?.acting ?? "ignored");

// The seller must be a payee, and makes an offer to the company wallet.
await wait(await owner.writeContract({ address: wallet, abi: agentWalletAbi, functionName: "setRecipient", args: [seller.account.address, true] }));
const dealId = await offerToCompany(wallet, "smoke offer");
check("the seller's offer to the company is on chain (Proposed)", (await dealStatus(dealId)) === 0, { dealId });

// ---- 2. who may accept ----------------------------------------------------------------------
const act = (p: Person, action: string) => call(`/api/deals/${dealId}/action`, "POST", acting(p), { action, index: 0 });
const rMem = await act(mem, "accept");
check("a non-signer's accept is refused (403)", rMem.status === 403, { status: rMem.status, body: rMem.json });
check("...and nothing moved", (await dealStatus(dealId)) === 0 && balance() === START, { balance: String(balance()) });
const rOut = await act(out, "accept");
check("an outsider's accept is refused", rOut.status >= 400 && (await dealStatus(dealId)) === 0, { status: rOut.status });

// ---- 3. a signer accepts and pays -----------------------------------------------------------
const rSig = await act(sig, "accept");
check("a signer's accept is funded", rSig.status === 200 && rSig.json?.status === "FUNDED", { status: rSig.status, body: rSig.json?.status });
check("the deal is Active on chain", (await dealStatus(dealId)) === 1, await dealStatus(dealId));
check("the company account was debited by the deal amount", balance() === START - AMOUNT, { balance: String(balance()) });
check("the escrow holds the amount", (await tokenBalance(escrow)) === AMOUNT, String(await tokenBalance(escrow)));

// ---- 4. delivery and approval ---------------------------------------------------------------
await wait(await seller.writeContract({ address: escrow, abi: fileEscrowAbi, functionName: "deliver", args: [BigInt(dealId), 0n, keccak256(toHex("smoke-work")), "smoke://delivery"] }));
check("the seller delivers (milestone Delivered)", (await milestoneStatus(dealId)) === M.Delivered, await milestoneStatus(dealId));

const sellerBefore = await tokenBalance(seller.account.address);
const aMem = await act(mem, "approve");
check("a non-signer's approve is refused (403)", aMem.status === 403 && (await milestoneStatus(dealId)) === M.Delivered, { status: aMem.status });
const aSig = await act(sig, "approve");
check("a signer's approve succeeds", aSig.status === 200, { status: aSig.status, body: JSON.stringify(aSig.json).slice(0, 160) });
const finalStatus = await milestoneStatus(dealId);
check("the milestone is paid out (Released)", finalStatus === M.Released, finalStatus);
check("the seller received the amount on chain", (await tokenBalance(seller.account.address)) - sellerBefore === AMOUNT, String((await tokenBalance(seller.account.address)) - sellerBefore));
check("the escrow is empty again", (await tokenBalance(escrow)) === 0n, String(await tokenBalance(escrow)));

// ---- 5. settled means settled (DC-H-02) -----------------------------------------------------
let refundReverted = false;
try {
  await seller.writeContract({ address: escrow, abi: fileEscrowAbi, functionName: "refund", args: [BigInt(dealId), 0n] });
} catch {
  refundReverted = true;
}
check("the seller's refund of a settled milestone reverts on chain", refundReverted, "WrongStatus");
const again = await act(sig, "approve");
check("the app refuses a second approve of a settled milestone", again.status >= 400, { status: again.status, body: again.json });
check("the company ends with exactly the deal amount spent", balance() === START - AMOUNT, { balance: String(balance()) });

// ---- summary ---------------------------------------------------------------------------------
console.log(`\n${results.length - failures} of ${results.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
