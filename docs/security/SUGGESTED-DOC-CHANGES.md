# Suggested documentation changes (for the team to decide)

Status: **suggestion only.** No team document was changed. Written 2026-10-17 after reading
`Agentic-Wallet-Technical-Documentation.docx` (version c950a07) against the code and our security tests.
Every item names the test or file that proves it. Open findings: [FINDINGS-2026-10-16.md](FINDINGS-2026-10-16.md).

## Why

The documents say a few things more strongly than the code supports. A judge who opens `docs/security/`
or runs the tests would see the gap, which costs more credibility than stating the limit. The fixes are
wording, not code.

## The seven claims

| # | Where it says | What the code does | Evidence | Suggested wording |
|---|---|---|---|---|
| 1 | "Review windows end every stall" (technical doc, security design and FileEscrow) | A disputed milestone has no timeout: a silent arbiter leaves it locked until the human arbiter rules | DC-M-01, `PROPOSAL-dispute-timeout.md` | "...end a silent buyer or seller. A timeout for a silent arbiter is not built yet." |
| 2 | "The wallet refuses to let the buyer's side be the arbiter" | Checked when the deal is made; the arbiter of an active deal can be changed to an approver | AW-M-03, KNOWN GAP in the contract tests | "...checked when the deal is made. Changing it later is a known gap." |
| 3 | "Both sides' text marked untrusted" | The text sits between tags it can close itself, so a party can forge another section of the arbiter's case file | DA-H-01, test "KNOWN GAP (DA-H-01)" | "...fenced as untrusted data; the fence is not yet escaped against a party's own text." |
| 4 | "A manipulated model still cannot move money outside policy" | True, but inside policy a fooled model can release an allowlisted, in-cap milestone: the policy engine never reads the evidence | AW-H-02, test "KNOWN GAP (AW-H-02)", mutation-checked | Add: "Loss is bounded by the per-transaction and daily caps; evidence is not yet an automatic gate." |
| 5 | Shared wallets act "each only through the signers' vote" | Accept, approve and payouts are votes. The group owner can make a member a signer with no vote. Payee and cap changes need one signer | DC-CO-03 and DC-CO-02, test "KNOWN GAP: the group owner makes a member a signer" | Say which actions are votes, and that the owner can change the signer set. |
| 6 | "Every write route is rate-limited" | The limiter keys on the first `X-Forwarded-For` value, which a caller can set | `web/src/lib/guard.ts:139-140`, open finding | "Rate-limited by client address; the address comes from a header a caller can set." |
| 7 | Arbiter, bank and approvers listed as "separate keys" | One server process holds all of them | `config.ts` | "All keys sit in one server process in this demo." (the demo limits section already says it for the owner key) |

Also stale: the test counts (`SECURITY.md` says 97 and 101 contract tests; the real number is 115) and the
testing table, which omits the 19 web security tests, the 25-check smoke test and the CI workflow.

## One thing the documents cannot fix: redeploy

The DC-H-02 fix (a seller refunding a milestone a second time after a split ruling) is in the contract
source on PR #4. **The FileEscrow already deployed on Besu and Base Sepolia still has the bug** until it
is redeployed. The ABI is unchanged, so the web app needs only the new address. This is the one action
that changes what the live demo does.

## Ready-made patch (optional)

The diff below applies to `SECURITY.md`, `TECHNICAL.md` and `docs/technical-documentation.html` as
they stand at c950a07. It also adds a "Fixed in the source" and an "Open findings" table to
`SECURITY.md`, and a "Known limitations" block to the technical documentation. Save it as
`doc-suggestions.diff` and run `git apply doc-suggestions.diff`, or copy only the parts you want.
The `.docx` must be exported again from the HTML afterwards; it is not covered here.

```diff
diff --git a/SECURITY.md b/SECURITY.md
index 6b0729c..1aa2c24 100644
--- a/SECURITY.md
+++ b/SECURITY.md
@@ -44,7 +44,8 @@ Generic calls are narrow. A Tier 1 `Call` may only do these things:
 The seller's moves can never take money out of the wallet. Anything else reverts with `InvalidProposal`.
 
 **Neutral arbiter.** A deal's arbiter may not be the wallet itself, its owner, an approver or a session
-key (`ArbiterNotNeutral`), so the buyer's side can never judge its own dispute.
+key (`ArbiterNotNeutral`), so the buyer's side can never judge its own dispute. The check runs when
+the deal is made; changing the arbiter of an already active deal is a known gap (AW-M-03, section 7).
 
 ## 3. Money flow controls (Mock Bank ↔ chain)
 
@@ -102,10 +103,14 @@ key (`ArbiterNotNeutral`), so the buyer's side can never judge its own dispute.
 - **Authorization.** Every wallet route checks the session **and** that the wallet belongs to the
   user (`web/src/lib/guard.ts`). The browser never sends amounts or payees for a lock: approval reads
   the draft back from the database, so what gets locked is what the user saw.
-- **Rate limits** on all write routes (approve, deal actions, deliveries, invites, payout checks, RPC).
+- **Rate limits** on the write routes (approve, deal actions, deliveries, invites, payout checks, RPC).
+  The limiter keys on the first `X-Forwarded-For` value, which a client can set itself, so it slows
+  honest mistakes and lazy scripts but does not stop a determined caller (open, section 7).
 - **Prompt injection.** Documents, invoices and evidence are passed to the model as untrusted data. A
   heuristic scanner flags overrides, urgency, changed bank details and unknown addresses. The real
   defence is on-chain: an address that is not on the allowlist reverts, whatever the model says.
+  What the chain cannot judge is the *content* of delivery evidence: for an allowlisted payee, a
+  funded milestone inside the caps is released on the model's judgement alone (AW-H-02, section 7).
 - **The agent never shows addresses or internal data.** The model is given people's names only,
   never wallet addresses. Its tools turn a name back into an address on the server, and only for the
   user's own contacts, so an address in a document cannot become a payee. Every reply and tool result
@@ -161,8 +166,8 @@ key (`ArbiterNotNeutral`), so the buyer's side can never judge its own dispute.
 
 ## 6. Testing
 
-- **Contracts:** 97 Hardhat tests (`cd contracts && npm test`): 39 for `AgentWallet`, 16 for
-  `FileEscrow`, 11 for `MockTHB` / `MockCNY`, and 31 security tests from the team's audit
+- **Contracts:** 115 Hardhat tests (`cd contracts && npm test`): 39 for `AgentWallet`, 16 for
+  `FileEscrow`, 11 for `MockTHB` / `MockCNY`, and the security tests from the team's audit
   (`contracts/test/security/`: dispute exits, the agent's approvals and caps, seeded invariant and
   spending-window property tests). The audit, Slither triage and 35 attack cases are in
   [`docs/security/`](docs/security/). They include:
@@ -183,6 +188,19 @@ key (`ArbiterNotNeutral`), so the buyer's side can never judge its own dispute.
   - invited seller without an account, with PromptPay QR and Mock Bank payouts, name checks and the payout lock
 - **Agent evaluation:** `cd web && npm run agent-eval` grades the live agent on its decision points:
   deal setup, autonomous payment, over-cap escalation, refusing incomplete work, and phishing.
+- **Web security checks:** `web/scripts/security/web-security.test.mts` (19 tests, real database, no
+  mocks of the code under test): sign-in and PIN lock, rate limits, a route matrix (every API route
+  calls a guard, except the bearer-link and auth routes), account deletion, company-member and
+  signer-set rules, the policy engine under injected evidence, the arbiter's case file, and settled
+  milestones. Tests marked "KNOWN GAP" pass while a reproduced weakness exists and fail when it is
+  fixed, so the list in section 7 cannot go stale unnoticed.
+- **End-to-end smoke test:** `cd web && npm run smoke` (25 checks, about 35 seconds, needs Docker)
+  starts a local chain, a throwaway Postgres and the app, then runs the main money flow: a company
+  with two signers and a non-signer, an offer, the 2-of-2 vote to accept and to approve, delivery,
+  release, a refund of a settled milestone (refused), and a repeated approve (refused). Mutation
+  checked: removing the signer guard makes the non-signer checks fail.
+- **CI:** `.github/workflows/ci.yml` runs the contract tests, type check, lint, the web security
+  checks and the smoke test on every pull request.
 
 ## 7. Known risks
 
@@ -193,10 +211,10 @@ key (`ArbiterNotNeutral`), so the buyer's side can never judge its own dispute.
 | R3 | **An invite link is a bearer credential**: anyone holding it acts as the invited seller | A leaked link lets someone accept or deliver in the seller's name | Only the link's hash is stored; 30-day expiry; the buyer can rotate it; `no-referrer`, `noindex`; the **payout destination is set once and locked**, so a leaked link cannot redirect money; name check on Mock Bank accounts; strict rate limit on payout attempts | One-time code by SMS or email before the first action; device binding |
 | R4 | **The chain has one validator**, on a home PC reached through Tailscale Funnel | If the PC is off, the app cannot transact; one operator could rewrite history | QBFT, account permissioning, JWT-protected RPC; contracts and the Base Sepolia deployment kept as a fallback | Four or more validators run by different parties (BFT), monitoring, backups |
 | R5 | **Payouts to people without an account** | A wrong account or a fraudulent payee gets the money | Bank-account payouts are real transfers through **Opn Payments** (test mode): the seller becomes an Opn recipient, which must be verified and then **activated by the operator in Opn's dashboard** before any money can go to it (new-payee review); each paid milestone is one Opn transfer, claimed in our database before it is sent, so it is sent once. The payout destination is set once and locked. PromptPay payouts are still simulated | Live Opn keys (or a licensed bank's PromptPay / ITMX payout API, or Stripe Connect where available) with name inquiry before the first transfer and sanctions screening |
-| R6 | **An AI arbiter decides disputes about the work** | A wrong ruling pays the wrong side | The arbiter is neutral by contract (`ArbiterNotNeutral`) and is a separate model call with its own instructions, not the buyer's agent. It judges only against the written acceptance criteria and treats both parties' text as untrusted. No single model decides: a mediator only proposes, both sides may reject, then 2 of 3 models from different providers must agree, with an appeal to 3 of 5. Each ruling is signed by its model's key and shown to both sides. Disagreement goes to a human arbiter. Key disputes are checked mechanically (hash), not by AI | A panel of human arbiters for large amounts, and an evaluation set of past disputes |
-| R7 | **Prompt injection or a hallucinating model** | The agent proposes the wrong thing | Allowlist, caps and neutral-arbiter checks are on-chain; Tier 1 needs the user's click; injection scanner; the tools validate every input | Already the main control; add per-counterparty limits and anomaly alerts |
+| R6 | **An AI arbiter decides disputes about the work** | A wrong ruling pays the wrong side | The arbiter is neutral by contract at creation (`ArbiterNotNeutral`) and is a separate model call with its own instructions, not the buyer's agent. It judges only against the written acceptance criteria and is told to treat both parties' text as untrusted (the tags that fence that text can still be forged by a party, DA-H-01). No dispute timeout exists yet: a silent arbiter locks the milestone until the human arbiter acts (DC-M-01). No single model decides: a mediator only proposes, both sides may reject, then 2 of 3 models from different providers must agree, with an appeal to 3 of 5. Each ruling is signed by its model's key and shown to both sides. Disagreement goes to a human arbiter. Key disputes are checked mechanically (hash), not by AI | A panel of human arbiters for large amounts, a dispute timeout in the contract, escaped party text, and an evaluation set of past disputes |
+| R7 | **Prompt injection or a hallucinating model** | The agent proposes the wrong thing, or releases a milestone because delivery text told it to | Allowlist, caps and neutral-arbiter checks are on-chain; Tier 1 needs the user's click; injection scanner; the tools validate every input. Loss from a fooled agent is bounded by the per-transaction and daily caps (AW-H-02: the policy engine does not read the evidence) | Treat flagged or unverified evidence as a proposal that needs a human click; add per-counterparty limits and anomaly alerts |
 | R8 | **Agent session key leak** | Spending up to the caps to allowlisted payees | Caps, allowlist, expiry, instant `revokeSession`, `pause()` | Short-lived keys from a KMS/HSM; alerts on unusual spending |
-| R9 | **Smart contract bugs** | Locked or lost test funds | OpenZeppelin 5 primitives, `ReentrancyGuard`, `SafeERC20`, 101 tests, internal audit (`docs/security/`) | External audit, Slither/Echidna in CI, formal checks of the escrow state machine |
+| R9 | **Smart contract bugs** | Locked or lost test funds | OpenZeppelin 5 primitives, `ReentrancyGuard`, `SafeERC20`, 115 tests, internal audit (`docs/security/`) | External audit, Slither/Echidna in CI, formal checks of the escrow state machine |
 | R10 | **Public explorer and RPC load** | Heavy scraping could slow the node | Read-only methods, bounded log ranges, rate limits on `/api/rpc` | Caching indexer and a separate read replica |
 | R11 | **Shared demo database** (Neon, one schema per deployment) | Test data of several testers sits together | Users see only their own wallets; names never on-chain; export and delete in the profile | Per-tenant isolation, encryption of personal fields, retention policy |
 
@@ -207,9 +225,29 @@ key (`ArbiterNotNeutral`), so the buyer's side can never judge its own dispute.
 | DC-H-01 (High) | After the seller released a key, the agent's second `agentApproveFile` paid at once, skipping the challenge window, and charged the agent's cap twice (DC-L-02) | `AgentWallet` lets the agent approve only a `Delivered` milestone (`MilestoneNotDelivered`); confirming a released key is the buyer's own owner mandate. New factory `0xa537…186c` on Besu. Wallets made by the earlier factory keep their code, so the server applies the same rule before calling the agent path |
 | DB-01 (High, mock money) | Overlapping approvals of one draft locked it several times and debited the bank each time | A per-draft lease (`DealDraft.approvingUntil`): one approval runs at a time, later clicks get "already being approved" or the same result. Three concurrent approvals now lock one deal and debit once |
 
-Open audit items (dispute timeout DC-M-01, arbiter neutrality after setup AW-M-03, PIN-lock race
-AW-M-02, unlinked-account debit AW-L-01, deletion leftovers P1) are tracked in
-[`docs/security/AUDIT-2026-10-14.md`](docs/security/AUDIT-2026-10-14.md).
+Fixed in the source on 2026-10-17 (details in
+[`docs/security/FINDINGS-2026-10-16.md`](docs/security/FINDINGS-2026-10-16.md)):
+
+| ID | Finding | Fix |
+|---|---|---|
+| DC-H-02 (High) | After a split ruling the seller could call `FileEscrow.refund` and the buyer was paid the full amount again, out of other deals' funds | `refund` allows only states that still hold the money; the web route refuses moves on settled milestones. **The deployed `FileEscrow` must be redeployed**; the ABI is unchanged |
+| DC-CO-01 (High) | A company member who is not a signer could accept and pay from the company account | Every money-moving route and agent tool requires a signer; accept and approve for a company go to the signers' vote. A source check fails if a route loses its guard |
+| AW-L-02 (Low) | A company could open a vote on a milestone that was already settled | The deal action route refuses it before a proposal exists |
+
+### Open findings (reproduced by a test, not yet fixed)
+
+| ID | Finding | Evidence |
+|---|---|---|
+| AW-H-02 (High) | The policy engine releases an in-cap, allowlisted milestone whatever the evidence says; only the model judges it | `web-security.test.mts` "KNOWN GAP (AW-H-02)" |
+| DC-M-01 (Medium) | No dispute timeout: a silent arbiter locks the milestone | proposal in `docs/security/PROPOSAL-dispute-timeout.md` |
+| DA-H-01 (Medium) | A party's text can close its own tag and forge another section of the arbiter's case file | "KNOWN GAP (DA-H-01)" |
+| DC-CO-02 (Medium) | Adding or removing a payee, changing caps, unpausing and linking a bank account need one signer, not N of M | route map in the findings document |
+| DC-CO-03 (Medium) | The group owner makes a member a signer, or removes one, with no vote, so owner plus one member can pass every vote | "KNOWN GAP: the group owner makes a member a signer" |
+| AW-M-03 | The arbiter of an already active deal can be changed to an approver | KNOWN GAP in the contract tests |
+| Rate-limit key | Limits key on a client-set header | test in the web security suite |
+
+Other open audit items (PIN-lock race AW-M-02, unlinked-account debit AW-L-01, deletion leftovers P1)
+are tracked in [`docs/security/AUDIT-2026-10-14.md`](docs/security/AUDIT-2026-10-14.md).
 
 ## 8. Compliance notes
 
diff --git a/TECHNICAL.md b/TECHNICAL.md
index 9a7a59b..b418413 100644
--- a/TECHNICAL.md
+++ b/TECHNICAL.md
@@ -216,7 +216,11 @@ A milestone can be delivered as a parcel.
 ### 3.5 Neutral arbiter
 
 A buyer may dispute a delivery inside the review window, giving a reason (at least 10 characters).
-The arbiter has its own key, and the wallet contract refuses to let the buyer's side be the arbiter.
+The arbiter has its own key, and the wallet contract refuses to let the buyer's side be the arbiter
+when the deal is made. Changing the arbiter of an already active deal is a known gap (AW-M-03).
+FileEscrow has no dispute timeout yet: if the arbiter never answers, the milestone stays disputed
+until the human arbiter at `/admin/disputes` rules (DC-M-01). All the arbiter's keys live in the
+server process in this demo.
 
 - **Key disputes** are mechanical: does the released key open a file with the anchored hash? There is no AI in the loop, and the decision is recorded as `check:key`.
 - **Work disputes** are decided by AI instead of a person. Every judge gets the same case file:
@@ -479,12 +483,18 @@ or addresses. Deleting an account removes the user's drafts, chats and nicknames
 
 | Suite | Command | Covers |
 |---|---|---|
-| Contracts (101 tests) | `cd contracts && npm test` | tiers, caps, allowlists, mandates (replay, expiry, revoke), prompt-injection "send everything to 0xEvil" cases, file escrow windows and disputes, seller offers, mint and redeem idempotency |
+| Contracts (115 tests) | `cd contracts && npm test` | tiers, caps, allowlists, mandates (replay, expiry, revoke), prompt-injection "send everything to 0xEvil" cases, file escrow windows and disputes, seller offers, mint and redeem idempotency |
 | Backend end to end | `cd web && npm run e2e` | wallet creation, deal setup, release, proposals against a running chain |
 | Bank and funding | `npm run bank-check`, `npm run funding-check` | ledger invariant, saga retries, certain-failure refunds |
 | Agent evaluation | `npm run agent-eval` | the agent's decisions on the demo scenarios |
+| Web security | `web/scripts/security/web-security.test.mts` (19 tests, real database) | route guards, sign-in, signer rules, policy under injected evidence, case-file framing, settled milestones; "KNOWN GAP" tests mark reproduced open findings |
+| Smoke test | `cd web && npm run smoke` (25 checks, Docker) | the main money flow on a throwaway chain and database, including the N-of-M vote |
+| CI | `.github/workflows/ci.yml` | contracts, type check, lint, web security checks and the smoke test on every pull request |
 | Evidence | `scripts/evidence.mts` | regenerates EVIDENCE.md from the live chain |
 
+Open findings and their status: [SECURITY.md](SECURITY.md) section 7 and
+[docs/security/FINDINGS-2026-10-16.md](docs/security/FINDINGS-2026-10-16.md).
+
 ---
 
 ## 8. Technology stack
diff --git a/docs/technical-documentation.html b/docs/technical-documentation.html
index ecb6e05..fcdd54e 100644
--- a/docs/technical-documentation.html
+++ b/docs/technical-documentation.html
@@ -102,7 +102,7 @@ footer{border-top:1px solid var(--line);padding-top:var(--s4);font-size:13px;col
     <li><a href="#api">API reference</a></li>
     <li><a href="#testing">Testing and evidence</a></li>
     <li><a href="#deploy">Deployment and configuration</a></li>
-    <li><a href="#limits">Demo limits</a></li>
+    <li><a href="#limits">Demo limits and known limitations</a></li>
   </ol>
 </nav>
 
@@ -207,7 +207,7 @@ stateDiagram-v2
   </div>
   <ul>
     <li><b>workHash</b> is the sha256 of the delivered file, the evidence note or the parcel's tracking record, anchored at delivery.</li>
-    <li><b>Review windows</b> end every stall: a silent buyer lets the seller claim; a seller who withholds the key lets the buyer reclaim.</li>
+    <li><b>Review windows</b> end the stalls between buyer and seller: a silent buyer lets the seller claim; a seller who withholds the key lets the buyer reclaim. A disputed milestone waits for the arbiter; a timeout for a silent arbiter is not built yet (see Known limitations).</li>
     <li><b>Instant payout</b>: confirming a released key pays the seller in the same transaction.</li>
   </ul>
   <h3>MockTHB / MockCNY</h3>
@@ -316,7 +316,7 @@ flowchart LR
 
 <section id="disputes">
   <h2>Disputes</h2>
-  <p>A buyer disputes inside the review window with a reason of at least 10 characters. Key disputes are mechanical: does the released key open the anchored file? Work disputes go to AI judges, each given the same case file (terms, criteria, evidence, file text, tracking, the buyer's reason; both sides' text marked untrusted).</p>
+  <p>A buyer disputes inside the review window with a reason of at least 10 characters. Key disputes are mechanical: does the released key open the anchored file? Work disputes go to AI judges, each given the same case file (terms, criteria, evidence, file text, tracking, the buyer's reason; both sides' text fenced as untrusted data; the fence is not yet escaped against a party's own text).</p>
   <div class="table"><table>
     <thead><tr><th>Stage</th><th>Who</th><th>Outcome</th></tr></thead>
     <tbody>
@@ -335,7 +335,7 @@ flowchart LR
     <li><b>Someone without an account.</b> The agent drafts with their name (<code>new_person</code>). Confirm makes their server-run wallet and a private link: a seller link for a hire, a buyer link for a sale (paid by card through Stripe test mode). Links are stored as a hash plus a sealed copy (AES-GCM), shown on the deal's page, copied to the clipboard by the Confirm click, and replaceable. They set their own name on the link page.</li>
     <li><b>Someone with an account</b> who opens their seller link while signed in is linked automatically (earnings to their own wallet, the buyer becomes a contact) and taken straight to their Deals page.</li>
     <li><b>Groups</b>: members vote; a payment locks after N of M signers approve; rule changes use the same vote; the owner cannot be removed by a vote.</li>
-    <li><b>Group and company wallets</b>: a shared e-money account and agent wallet. Members act as the group to hire or sell in its name, pay salaries (<code>propose_group_payment</code>) and release deliveries, each only through the signers' vote. A group chat runs the agent with the group's context.</li>
+    <li><b>Group and company wallets</b>: a shared e-money account and agent wallet. Members act as the group to hire or sell in its name, pay salaries (<code>propose_group_payment</code>) and release deliveries. Buying, accepting, approving and payouts go through the signers' vote; the owner can make a member a signer without a vote, and payee and cap changes need one signer (see Known limitations). A group chat runs the agent with the group's context.</li>
     <li><b>Contacts</b>: an allow transfer list (who the agent may pay, set on-chain by the owner), Send money, Block (both ways: search, requests, transfers, invites, and off the allow transfer list) and Report (to admins at <code>/admin/reports</code>).</li>
   </ul>
 </section>
@@ -355,9 +355,9 @@ flowchart LR
     <li><b>The LLM is never trusted.</b> Policy engine first, contract second; the agent's key is capped, scoped, expiring and revocable.</li>
     <li><b>Every click is a signature.</b> Owner actions are EIP-712 mandates bound to the exact call, a reason hash and a nonce, with a short deadline, usable once.</li>
     <li><b>Money cannot be created or paid twice.</b> Mints, burns and ledger rows carry deterministic ids; refunds happen only on certain failure.</li>
-    <li><b>Fair exchange.</b> The buyer's money is locked before work is shown; the file key is released only after approval; review windows end every stall.</li>
-    <li><b>Neutral disputes.</b> A separate arbiter key the contract keeps neutral; signed rulings; human review when models disagree.</li>
-    <li><b>Request hygiene.</b> <code>proxy.ts</code> redirects app pages without a session, refuses state-changing API calls from other origins (CSRF), sets <code>nosniff</code>, frame denial (except sandboxed previews), HSTS, and no Referer on pages whose URL holds a secret. Every write route is rate-limited.</li>
+    <li><b>Fair exchange.</b> The buyer's money is locked before work is shown; the file key is released only after approval; review windows end a silent buyer or seller.</li>
+    <li><b>Neutral disputes.</b> A separate arbiter key the contract checks when the deal is made; signed rulings; human review when models disagree. All keys sit in one server process in this demo.</li>
+    <li><b>Request hygiene.</b> <code>proxy.ts</code> redirects app pages without a session, refuses state-changing API calls from other origins (CSRF), sets <code>nosniff</code>, frame denial (except sandboxed previews), HSTS, and no Referer on pages whose URL holds a secret. Write routes are rate-limited by client address; the address comes from a header a caller can set, so this slows mistakes, not a determined attacker.</li>
     <li><b>Permissioned chain, public reads.</b> Only the app's keys can write (Besu account allowlist, JWT on every RPC call); anyone can verify any hash through the read-only <code>/api/rpc</code>.</li>
   </ol>
   <p>The full self-assessment with the known-risk list is in <code>SECURITY.md</code>.</p>
@@ -422,7 +422,10 @@ flowchart LR
   <div class="table"><table>
     <thead><tr><th>Suite</th><th>Command</th><th>Covers</th></tr></thead>
     <tbody>
-      <tr><td>Contracts</td><td><code>cd contracts &amp;&amp; npm test</code></td><td>tiers, caps, allow lists, mandates (replay, expiry, revoke), injection cases, escrow windows and disputes, mint and redeem idempotency</td></tr>
+      <tr><td>Contracts (115 tests)</td><td><code>cd contracts &amp;&amp; npm test</code></td><td>tiers, caps, allow lists, mandates (replay, expiry, revoke), injection cases, escrow windows and disputes, mint and redeem idempotency, property tests over every move on settled milestones</td></tr>
+      <tr><td>Web security (19 tests)</td><td><code>web/scripts/security/web-security.test.mts</code></td><td>route guards, sign-in, signer rules, policy under injected evidence, case-file framing, settled milestones; &ldquo;KNOWN GAP&rdquo; tests mark reproduced open findings</td></tr>
+      <tr><td>Smoke test (25 checks)</td><td><code>cd web &amp;&amp; npm run smoke</code></td><td>the main money flow on a throwaway chain and database, including the 2-of-2 signer vote</td></tr>
+      <tr><td>CI</td><td><code>.github/workflows/ci.yml</code></td><td>contracts, type check, lint, web security and smoke on every pull request</td></tr>
       <tr><td>Backend end to end</td><td><code>npm run e2e</code></td><td>wallet creation, deal setup, release, proposals on a running chain</td></tr>
       <tr><td>Bank and funding</td><td><code>npm run bank-check</code>, <code>funding-check</code></td><td>ledger invariant, saga retries, certain-failure refunds</td></tr>
       <tr><td>Agent</td><td><code>npm run agent-eval</code></td><td>the agent's decisions on the demo scenarios</td></tr>
@@ -465,8 +468,19 @@ flowchart LR
 </section>
 
 <section id="limits">
-  <h2>Demo limits</h2>
+  <h2>Demo limits and known limitations</h2>
   <div class="demo"><p>This is a competition build with test money only. The server holds the owner keys (in production they would sit in the user's device or a custody service). SMS codes are simulated, email codes are shown on screen when no mailer is configured, and WebAuthn signatures are not verified server-side. The registry lookup for companies and the national ID providers are mocks with the real protocol shape. Documents are marked DEMO and are not legal contracts, receipts or tax invoices.</p></div>
+  <h3>Known limitations (found by our own security tests)</h3>
+  <p>Each item below is reproduced by an automated test marked &ldquo;KNOWN GAP&rdquo;; the full list with status and fixes is in SECURITY.md section 7 and docs/security/FINDINGS-2026-10-16.md.</p>
+  <ul>
+    <li><b>Evidence is not a gate.</b> The policy engine releases an in-cap, allowlisted milestone whatever the delivery evidence says; only the model judges it. Loss is bounded by the per-transaction and daily caps. The fix is to send flagged or unverified evidence to a human click.</li>
+    <li><b>No dispute timeout.</b> A silent arbiter leaves a disputed milestone locked until the human arbiter rules.</li>
+    <li><b>Case-file framing.</b> A party&rsquo;s text can close its own tag in the arbiter&rsquo;s case file.</li>
+    <li><b>Owner powers in groups.</b> The group owner can make a member a signer, or remove one, without a vote; payee and cap changes need one signer, not N of M.</li>
+    <li><b>Arbiter of an active deal.</b> The neutral-arbiter rule is checked when the deal is made, not when the arbiter is changed later.</li>
+    <li><b>Rate limits</b> key on a client-set header.</li>
+    <li><b>Fixed in the source, to be redeployed:</b> a seller could refund a milestone a second time after a split ruling (DC-H-02); the deployed FileEscrow must be replaced.</li>
+  </ul>
 </section>
 
 <footer>Agentic Wallet · FinTechathon 2026 · Source documents in the repository: TECHNICAL.md, SECURITY.md, EVIDENCE.md, README.md.</footer>
```
