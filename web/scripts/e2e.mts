// End-to-end check of the wallet backend against a live chain, without the LLM.
// Exercises exactly what the agent's tools call, in the demo order.
//
//   npx tsx --conditions=react-server --env-file=.env.local scripts/e2e.mts
import assert from "node:assert/strict";

import {
  approveProposal,
  createWorkspace,
  pause,
  proposeDealSetup,
  rawAttack,
  releaseMilestone,
  restoreSession,
  revokeSession,
  submitEvidence,
  transfer,
  unpause,
} from "../src/lib/actions";
import { roleAddresses } from "../src/lib/chain";
import { ATTACKER } from "../src/lib/config";
import { scanForInjection } from "../src/lib/policy";
import { samples } from "../src/lib/samples";
import { readAudit, readWallet } from "../src/lib/state";

const log = (step: string, detail: unknown) => console.log(`✔ ${step}`, typeof detail === "string" ? detail : JSON.stringify(detail));

const roles = roleAddresses();
const docs = samples(roles.contractor, ATTACKER);
const doc = (id: string) => docs.find((d) => d.id === id)!;

const { address: wallet } = await createWorkspace();
let s = await readWallet(wallet);
assert.equal(s.balance, "10000");
log("sandbox wallet created", wallet);

// 1. Deal setup is always Tier 1.
const setup = await proposeDealSetup(wallet, {
  payee: roles.contractor,
  po: "PO-2026-0142",
  title: "Packaging line #2 retrofit",
  summary: "PLC, HMI and control panel retrofit",
  milestones: [
    { name: "Deposit", amount: 300, due: "2026-10-10", acceptance: "Signed order acknowledgement" },
    { name: "Panel delivery", amount: 450, due: "2026-10-24", acceptance: "Signed delivery note" },
    { name: "FAT", amount: 2000, due: "2026-11-07", acceptance: "64/64 I/O PASS, signed" },
    { name: "SAT", amount: 700, due: "2026-11-21", acceptance: "4h at >= 40 packs/min, signed" },
  ],
});
assert.equal(setup.decision?.route, "propose");
assert.equal(setup.outcome?.status, "success");
const approved = await approveProposal(wallet, 0);
assert.equal(approved.outcome?.status, "success");
s = await readWallet(wallet);
assert.equal(s.deals.length, 1);
assert.equal(s.deals[0].funded, true);
assert.equal(s.balance, "6550");
const dealId = s.deals[0].id;
log("PO proposed, owner approved, deal funded", { dealId, balance: s.balance });

// 2. Release without evidence -> Tier 1 proposal, not a payment.
const noEvidence = await releaseMilestone(wallet, dealId, 0, "deposit");
assert.equal(noEvidence.decision?.route, "propose");
log("release without evidence routed to approval", noEvidence.decision?.reasons);

// 3. Evidence in + within caps -> Tier 2 autonomous payments.
await submitEvidence(dealId, 0, { title: "ack", text: doc("ack").text });
await submitEvidence(dealId, 1, { title: "delivery", text: doc("delivery").text });
const r0 = await releaseMilestone(wallet, dealId, 0, "ack ok");
const r1 = await releaseMilestone(wallet, dealId, 1, "delivery ok");
assert.equal(r0.decision?.route, "execute");
assert.equal(r0.outcome?.status, "success");
assert.equal(r1.outcome?.status, "success");
log("deposit + delivery auto-paid (Tier 2)", [r0.outcome, r1.outcome].map((o) => o && "hash" in o && o.hash));

// 4. FAT 2,000 > per-tx cap -> proposal -> approvals -> paid.
await submitEvidence(dealId, 2, { title: "fat", text: doc("fat").text });
const fat = await releaseMilestone(wallet, dealId, 2, "64/64 PASS, signed");
assert.equal(fat.decision?.route, "propose");
s = await readWallet(wallet);
const fatProposal = s.proposals.find((p) => p.status === "open" && p.kind === "ReleaseMilestone" && p.release?.index === 2)!;
await approveProposal(wallet, fatProposal.id);
s = await readWallet(wallet);
assert.equal(s.deals[0].milestones[2].status, "Released");
log("FAT above cap went through owner approval and was paid", s.deals[0].milestones.map((m) => m.status));

// 5. Phishing: scanner flags it, policy blocks it, contract reverts it.
const flags = scanForInjection(doc("phishing").text, s);
assert.ok(flags.length >= 3);
const phish = await transfer(wallet, ATTACKER, 5000, "invoice INV-77120");
assert.equal(phish.decision?.route, "block");
const raw = await rawAttack(wallet);
assert.equal(raw.outcome?.status, "reverted");
assert.match(raw.outcome?.status === "reverted" ? raw.outcome.error : "", /RecipientNotAllowed/);
log("phishing flagged + blocked off-chain + reverted on-chain", { flags, rawTx: raw.outcome && "hash" in raw.outcome && raw.outcome.hash });

// 6. Kill switch and key revocation.
await pause(wallet, "owner");
const whilePaused = await transfer(wallet, roles.contractor, 1, "test");
assert.equal(whilePaused.decision?.route, "block");
await unpause(wallet);
await revokeSession(wallet);
const revoked = await transfer(wallet, roles.contractor, 1, "test");
assert.equal(revoked.decision?.route, "block");
await restoreSession(wallet);
const restored = await transfer(wallet, roles.contractor, 1, "test");
assert.equal(restored.outcome?.status, "success");
log("pause/unpause and revoke/restore behave", "ok");

s = await readWallet(wallet);
const audit = await readAudit(wallet, BigInt(s.createdAtBlock), s.deals.map((d) => d.id));
assert.ok(audit.length > 15);
log("audit log", `${audit.length} events`);
console.log("\nAll end-to-end checks passed.");
