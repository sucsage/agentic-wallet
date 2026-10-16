// Security checks for the web side (owner: @NawaratKhem). They need a database and nothing else:
//   DATABASE_URL=... DIRECT_URL=... npx tsx --conditions=react-server --test scripts/security/web-security.test.mts
// Never point DATABASE_URL at a shared database: the tests create and delete their own rows, but the
// "account deletion" check removes a user. Tests named "KNOWN GAP" pass today and record unsafe behaviour
// from docs/security; they must be flipped on purpose when the code is fixed.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { db } from "../../src/lib/db";
import { BankError, registerCustomer, verifyCustomer } from "../../src/lib/bank/customers";
import { refuseSettled } from "../../src/lib/bank/deals";
import { actingCompany, canSpendFrom } from "../../src/lib/company";
import { HttpError, rateLimit } from "../../src/lib/guard";

const run = `sec${Date.now().toString(36)}`;
after(async () => {
  await db.company.deleteMany({ where: { name: { startsWith: run } } }).catch(() => undefined);
  await db.group.deleteMany({ where: { name: { startsWith: run } } }).catch(() => undefined);
  await db.user.deleteMany({ where: { id: { startsWith: run } } }).catch(() => undefined);
  await db.bankAccount.deleteMany({ where: { customer: { username: { startsWith: run } } } }).catch(() => undefined);
  await db.bankCustomer.deleteMany({ where: { username: { startsWith: run } } }).catch(() => undefined);
  await db.$disconnect();
});

describe("Mock Bank sign-in (AW-M-02)", () => {
  it("KNOWN GAP: parallel wrong PINs are under-counted, so the five-try lock does not engage", async () => {
    const username = `${run}-pin`;
    await registerCustomer({ currency: "THB", username, displayName: "PIN test", pin: "123456", type: "PERSONAL" });
    const attempts = 20;
    const results = await Promise.allSettled(Array.from({ length: attempts }, () => verifyCustomer("THB", username, "000000")));
    const refusedWrongPin = results.filter((r) => r.status === "rejected" && (r.reason as BankError).code === "INVALID_LOGIN").length;
    const row = await db.bankCustomer.findFirstOrThrow({ where: { username } });
    // A correct counter would show a lock after five wrong PINs. Overlapping requests read the same
    // count and overwrite one another, so far fewer than 20 are recorded and nothing is locked.
    assert.ok(refusedWrongPin >= 5, "the attempts were not even evaluated");
    assert.equal(row.lockedUntil, null, "the account locked: if this fails, AW-M-02 may be fixed, flip this test");
    assert.ok(row.failedPins < attempts, `counter recorded ${row.failedPins} of ${attempts} wrong PINs`);
    console.log(`      ${attempts} parallel wrong PINs -> counter ${row.failedPins}, locked ${row.lockedUntil !== null}`);
  });

  it("one at a time, five wrong PINs do lock the account", async () => {
    const username = `${run}-seq`;
    await registerCustomer({ currency: "THB", username, displayName: "Seq test", pin: "123456", type: "PERSONAL" });
    for (let i = 0; i < 5; i++) await assert.rejects(verifyCustomer("THB", username, "000000"));
    await assert.rejects(verifyCustomer("THB", username, "123456"), (e: BankError) => e.code === "LOCKED");
  });

  it("KNOWN GAP: registration tells an attacker which usernames exist", async () => {
    const username = `${run}-enum`;
    await registerCustomer({ currency: "THB", username, displayName: "Enum test", pin: "123456", type: "PERSONAL" });
    await assert.rejects(
      registerCustomer({ currency: "THB", username, displayName: "x", pin: "654321", type: "PERSONAL" }),
      (e: BankError) => e.code === "USERNAME_TAKEN",
    );
  });

  it("sign-in itself does not reveal whether a username exists", async () => {
    await assert.rejects(verifyCustomer("THB", `${run}-nobody`, "123456"), (e: BankError) => e.code === "INVALID_LOGIN");
  });
});

describe("Rate limiting (DB-06)", () => {
  const req = (ip: string) => new Request("http://localhost/x", { headers: { "x-forwarded-for": ip } });

  it("blocks the same client after the limit", () => {
    const bucket = `${run}-a`;
    for (let i = 0; i < 3; i++) rateLimit(req("10.0.0.1"), bucket, 3, 60_000);
    assert.throws(() => rateLimit(req("10.0.0.1"), bucket, 3, 60_000), (e: HttpError) => e.status === 429);
  });

  it("KNOWN GAP: a caller-chosen x-forwarded-for gives every request a fresh allowance", () => {
    const bucket = `${run}-b`;
    for (let i = 0; i < 50; i++) rateLimit(req(`198.51.100.${i}`), bucket, 3, 60_000); // 50 requests, none blocked
  });
});

describe("API routes: who must be signed in (DB route matrix)", () => {
  const root = join(process.cwd(), "src/app/api");
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "route.ts") routes.push(p);
    }
  };
  walk(root);

  const guarded = /require(User|Customer|ActingCustomer|Admin|BankWallet|BankSigner|ActingSigner)\s*\(|getSession\s*\(|userWallet\s*\(|demoWallet\s*\(/;
  const unguarded = routes.filter((p) => !guarded.test(readFileSync(p, "utf8"))).map((p) => p.slice(root.length + 1));

  // Routes that are open by design: the auth framework, the public read-only RPC, the bearer-link
  // seller pages and the sample documents. Everything else must call a guard.
  const allowed = new Set([
    "auth/[...all]/route.ts",
    "rpc/route.ts",
    "samples/route.ts",
    "auth-options/route.ts", // lists the sign-in methods the login screen shows; no data
    "invite/[token]/route.ts",
    "invite/[token]/action/route.ts",
    "invite/[token]/deliver/route.ts",
    "invite/[token]/payout/route.ts",
    "invite/[token]/dispute/route.ts", // bearer link, like the other invite routes
    // The mock ID provider (OIDC endpoints called server to server and by the browser redirect).
    "mock-id/[provider]/authorize/route.ts",
    "mock-id/[provider]/openid-configuration/route.ts",
    "mock-id/[provider]/token/route.ts",
  ]);

  it("every API route calls a guard, except the ones that are open by design", () => {
    const surprises = unguarded.filter((r) => !allowed.has(r));
    assert.deepEqual(surprises, [], `routes with no sign-in check: ${surprises.join(", ")}`);
    console.log(`      ${routes.length} routes, ${routes.length - unguarded.length} call a guard, ${unguarded.length} open by design: ${unguarded.join(", ")}`);
  });

  it("the open-by-design list does not hide a route that disappeared or got a guard", () => {
    for (const a of allowed) assert.ok(routes.some((p) => p.endsWith(a)), `listed as open but not found: ${a}`);
  });
});

describe("Account deletion (P1 in PRIVACY-DATA-MAP)", () => {
  it("KNOWN GAP: deleting a user leaves their deliveries, disputes and invited-seller payout details", async () => {
    const user = await db.user.create({ data: { id: `${run}-u`, name: "Delete me", email: `${run}@example.test` } });
    const delivery = await db.dealDelivery.create({
      data: { escrow: `0x${run}`, dealId: 1, index: 0, sellerUserId: user.id, note: "my private note", sha256: "00" },
    });
    const dispute = await db.dealDispute.create({
      data: { escrow: `0x${run}`, dealId: 1, index: 0, phase: "work", reason: "private reason", raisedByUserId: user.id },
    });
    const invite = await db.sellerInvite.create({
      data: {
        tokenHash: `${run}-h`, userId: user.id, buyerWallet: "0xb", sellerWallet: `0x${run}`, name: "Invited Person",
        currency: "THB", payoutTarget: "0812345678", expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    try {
      await db.user.delete({ where: { id: user.id } }); // what DELETE /api/me does to the user
      assert.ok(await db.dealDelivery.findUnique({ where: { id: delivery.id } }), "delivery was deleted: P1 may be fixed, flip this test");
      assert.ok(await db.dealDispute.findUnique({ where: { id: dispute.id } }), "dispute was deleted: P1 may be fixed, flip this test");
      assert.ok(await db.sellerInvite.findUnique({ where: { id: invite.id } }), "invite was deleted: P1 may be fixed, flip this test");
    } finally {
      await db.dealDelivery.deleteMany({ where: { escrow: `0x${run}` } });
      await db.dealDispute.deleteMany({ where: { escrow: `0x${run}` } });
      await db.sellerInvite.deleteMany({ where: { tokenHash: `${run}-h` } });
      await db.user.deleteMany({ where: { id: user.id } });
    }
  });
});

describe("Company accounts: who may spend the company's money (candidate DC-CO-01)", () => {
  let seq = 0;

  async function company() {
    const tag = `${run}-${++seq}`; // one fresh set of rows per call
    const user = (n: string) => db.user.create({ data: { id: `${tag}-${n}`, name: n, email: `${tag}-${n}@example.test` } });
    const [admin, signer, member, outsider] = await Promise.all(["admin", "signer", "member", "outsider"].map(user));
    const group = await db.group.create({
      data: {
        name: `${tag}-co`, currency: "THB", createdById: admin.id, threshold: 2,
        members: { create: [
          { userId: admin.id, role: "ADMIN", canSign: true },
          { userId: signer.id, role: "MEMBER", canSign: true },
          { userId: member.id, role: "MEMBER", canSign: false }, // proposes only, may not vote
        ] },
      },
    });
    const co = await db.company.create({
      data: {
        name: `${tag}-co`, maskedTaxId: "****", taxIdHash: `${tag}-hash`, currency: "THB",
        customerId: `${tag}-cust`, walletAddress: `0x${String(seq).repeat(40)}`, groupId: group.id, createdById: admin.id,
      },
    });
    return { co, member, signer, outsider };
  }

  it("a member who is not a signer can act as the company; an outsider cannot", async () => {
    const { co, member, signer, outsider } = await company();
    assert.equal((await actingCompany(member.id, co.id))?.id, co.id, "the non-signer was refused: the guard may check the signer role now");
    assert.equal((await actingCompany(signer.id, co.id))?.id, co.id);
    assert.equal(await actingCompany(outsider.id, co.id), null);
  });

  it("DC-CO-01 fixed: only a signer may spend from, or re-route, the company wallet", async () => {
    const { co, member, signer, outsider } = await company();
    const wallet = co.walletAddress as `0x${string}`;
    assert.equal(await canSpendFrom(signer.id, wallet), true);
    assert.equal(await canSpendFrom(member.id, wallet), false, "a non-signer can spend: DC-CO-01 is back");
    assert.equal(await canSpendFrom(outsider.id, wallet), false);
    assert.equal(await canSpendFrom(member.id, `0x${"9".repeat(40)}`), true, "a personal wallet has no signers");
  });

  it("every route that moves money or changes who can be paid uses the signer guard", () => {
    // Source check, so a new route copied from an old one cannot quietly skip it. The list comes from the
    // route map of 2026-10-16 (every route reachable while acting as a company that spends, releases,
    // re-routes payees, changes caps, unpauses or re-links the bank account).
    const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    const mustGuard: Record<string, RegExp> = {
      "src/app/api/deals/[id]/action/route.ts": /assertCompanySigner\(/,
      "src/app/api/friends/[id]/payee/route.ts": /requireBankSigner\(/,
      "src/app/api/policy/recipients/route.ts": /requireBankSigner\(/,
      "src/app/api/policy/limits/route.ts": /requireBankSigner\(/,
      "src/app/api/policy/pause/route.ts": /assertCompanySigner\(/,
      "src/app/api/invites/route.ts": /requireBankSigner\(/,
      "src/app/api/bank/accounts/route.ts": /requireActingSigner\(/,
      "src/lib/agent.ts": /SIGNER_ONLY_TOOLS[\s\S]*canSpendFrom/,
    };
    for (const [f, re] of Object.entries(mustGuard)) assert.match(src(f), re, `${f} lost its signer guard`);
    // The agent's spending tools are all on the signer-only list.
    assert.match(src("src/lib/agent.ts"), /SIGNER_ONLY_TOOLS = new Set\(\[[^\]]*"release_milestone"[^\]]*"transfer"[^\]]*"invite_seller"/);
  });
});

describe("Settled milestones refuse every move (DC-H-02, web side)", () => {
  const deal = (status: string) => ({ milestones: [{ status }] }) as unknown as Parameters<typeof refuseSettled>[0];

  it("refuses refund, claim, approve, dispute and reclaim on Released, Refunded and Split", () => {
    for (const status of ["Released", "Refunded", "Split"]) {
      for (const action of ["refund", "claim", "approve", "dispute", "reclaim"]) {
        assert.throws(() => refuseSettled(deal(status), action, 0), /already settled/, `${action} on ${status}`);
      }
    }
  });

  it("lets moves through on a milestone that still holds money, and deal-level moves on any", () => {
    for (const status of ["Pending", "Delivered", "Approved", "KeyReleased", "Disputed"]) refuseSettled(deal(status), "refund", 0);
    refuseSettled(deal("Split"), "accept", 0);
    refuseSettled(deal("Split"), "cancel", 0);
  });

  it("refuses a milestone that does not exist", () => {
    assert.throws(() => refuseSettled(deal("Delivered"), "approve", 3), /not found/);
  });
});
