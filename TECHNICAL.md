# Agentic Wallet: Technical Documentation

FinTechathon 2026, International Track, Topic F: Agent Wallet.

Agentic Wallet lets an AI agent run a smart-contract wallet that pays people for work and goods,
milestone by milestone, from an ordinary bank account. The user talks to the agent in plain language
("hire Somchai for a logo, 5,000 baht, two milestones"). The agent drafts the deal; the user approves
it; money is locked in an on-chain escrow and released only when each delivery is approved, or when a
neutral arbiter decides a dispute.

The agent is useful because it acts on its own: it reads documents, drafts deals, checks deliveries
and approves small payments by itself. It is safe because it never holds the owner's key. Every
spending rule is enforced twice: by an off-chain policy engine and again by the wallet contract. A
manipulated or hallucinating model still cannot move money outside policy.

| | |
|---|---|
| Live app | https://agentic-wallet-inky.vercel.app (Mock Bank sign-up, test money only) |
| Public explorer and read-only RPC | `/explorer`, `/api/rpc` (chain id 20261020) |
| Security self-assessment | [SECURITY.md](SECURITY.md) |
| Transaction evidence | [EVIDENCE.md](EVIDENCE.md) |
| Build, deploy, tests | [README.md](README.md) |

Contents:

1. [System architecture](#1-system-architecture)
2. [Smart contracts](#2-smart-contracts)
3. [Core algorithms](#3-core-algorithms)
4. [The AI agent](#4-the-ai-agent)
5. [Security design](#5-security-design)
6. [Data and privacy](#6-data-and-privacy)
7. [Testing](#7-testing)
8. [Technology stack](#8-technology-stack)

---

## 1. System architecture

```
                    ┌──────────────────────────── Next.js 16 on Vercel ────────────────────────────┐
 Browser ── HTTPS ─►│ UI: AI chat (SSE), deals, approvals, friends, policy, explorer               │
 (buyer, seller,    │                                                                              │
  invited seller,   │ AI agent (LLM tool-use loop) ──► Guard 1: policy engine (tier routing,       │
  judges)           │   13 tools, names only            caps, allowlist, injection scan)            │
                    │                                                  │                           │
                    │ Mock Bank (Postgres ledger) ◄── funding saga ───┤ owner-signed EIP-712       │
                    │   accounts, reserve, transfers     (debit→mint→  │ mandates (user's click)    │
                    │                                     lock)        ▼                           │
                    │ Neutral AI arbiter (own key)        viem ── JSON-RPC + Bearer JWT ───────────┼──┐
                    └──────────────────────────────────────────────────────────────────────────────┘  │
                                                                                                       ▼
                    ┌─────────────── Hyperledger Besu, QBFT, chain id 20261020 ─────────────────────────┐
                    │ Guard 2: AgentWallet (one per user)  ──►  FileEscrow (fair exchange, disputes)   │
                    │ AgentWalletFactory · MockTHB / MockCNY (bank-backed tokens) · MilestoneEscrow    │
                    │ Account allowlist: only the app's keys can write. Anyone can read (/api/rpc).    │
                    └───────────────────────────────────────────────────────────────────────────────────┘
```

**Three layers of authority.** The user owns the wallet. The agent is a session key on it. The
contract decides.

| Actor | Key | Can do |
|---|---|---|
| Owner (the user) | owner key (held by the server in the demo, see SECURITY.md R1) | signs a mandate for each action the user clicks; sets policy |
| Agent | session key: scoped, capped, expiring, revocable | Tier 2 actions inside the caps; proposes everything else |
| Approvers | separate keys | approve Tier 1 proposals (N of M) |
| Bank | `BANK_ROLE` on MockTHB / MockCNY | mints tokens only against a ledger debit, once per funding id |
| Arbiter | its own key, which the wallet refuses to let the buyer's side be | `resolve` a disputed milestone |

**Request path for a deal.**

1. The user writes in the chat. The agent streams its reply over Server-Sent Events, including each tool step.
2. `propose_bank_deal` saves a draft in Postgres. Nothing is signed and no money moves.
3. The user presses *Approve & lock*. The server builds a `SetupFileDeal` mandate and signs it with the owner key, and the funding saga runs (section 3.2).
4. The escrow holds the money. Each delivery is approved by the agent (Tier 2, within caps) or by the user (owner mandate). The seller's bank account is credited the moment the escrow pays out.

**Deployment.** The web app and its signing keys run on Vercel. The chain runs on a home PC in
Docker, exposed through Tailscale Funnel; Besu itself checks a bearer JWT on every RPC call.
Postgres (Neon) holds the bank ledger and off-chain deal terms, never anything the chain needs to
enforce a rule.

---

## 2. Smart contracts

Solidity 0.8.28 with OpenZeppelin, Hardhat 3. All contracts are MIT-licensed.

### 2.1 AgentWallet: the policy-enforcing wallet

One per user, created in one transaction by `AgentWalletFactory.createWallet(config)` with its whole
policy: owner, settlement token, agent session (expiry, per-transaction cap, daily cap), approvers
and threshold, recipient allowlist and escrow allowlist.

| Tier | Entry point | What the contract checks |
|---|---|---|
| 0 Read | (off-chain) | nothing to enforce |
| 1 Propose | `propose` → `approve` ×N → execute | `threshold` approvers; proposals expire after 3 days and go stale if the approver set changes |
| 1 Owner mandate | `executeMandate(m, sig)` | EIP-712 signature by the owner; deadline; single use; the same call checks as below |
| 2 Auto | `agentTransfer`, `agentReleaseMilestone`, `agentApproveFile` | active session key, per-tx cap, daily cap, allowlisted recipient/escrow, wallet is the deal's payer, settlement token only |
| 3 Emergency | `pause` | agent, approvers or owner may pause; only the owner unpauses; `revokeSession` is instant |

Generic calls are not generic. `_checkCall` and `_checkFileCall` decode the calldata and allow only:

- `token.approve(allowlisted escrow)`
- `createDeal` to an allowlisted payee in the settlement token
- `fund`, `dispute`
- File-deal moves where the wallet is the buyer or the seller of that deal

Other rules:

- An offer must name a neutral arbiter (`_checkArbiter`): never the wallet itself, its agent, or one of its approvers.
- An unlimited `approve`, a transfer to a new address, or a call to an unknown contract reverts. It reverts whoever asks, including the agent with its own key and bypassing the app (see EVIDENCE.md, "attack" transactions).

### 2.2 FileEscrow: fair exchange between strangers

Either side may make the offer: `offerToBuy` locks the buyer's money now, and `offerToSell` locks
nothing until the buyer accepts. Each milestone moves through a small state machine:

```
Pending ─deliver(workHash)─► Delivered ─approve─► Approved ─releaseKey─► KeyReleased ─approve/claim─► Released
                                │  (no file: approve pays at once)                  │
                                └─dispute─► Disputed ─resolve(arbiter)─► Released | Refunded
Approved, key withheld past the window ─reclaim─► Refunded
```

- **`workHash`** is the sha256 of the delivered file, of the evidence note, or of the parcel's tracking record. It is anchored on-chain at delivery, so what the buyer finally receives can be checked against what was approved.
- **Review windows** (`reviewPeriod`, agreed in the offer) stop either side from stalling:
  - A silent buyer lets the seller proceed.
  - A seller who withholds the key lets the buyer reclaim.
  - A seller who released the key is paid if the buyer does not challenge in time.
- **Instant payout.** When the buyer confirms a released key (`approve` on `KeyReleased`), the seller is paid in the same transaction.

### 2.3 MockTHB / MockCNY: bank-backed settlement tokens

ERC-20 tokens with 2 decimals (satang / fen). They are backed one-to-one by the Mock Bank reserve
account.

- **`mint(to, amount, fundingId)`**: only the bank role can call it; each `fundingId` mints once; there are per-transaction and daily mint caps.
- **`redeem(amount, redeemId)`**: burns tokens leaving the chain, once per `redeemId`.

Because mints and burns carry ids derived from the deal and milestone, a retried request can never
mint or pay twice.

### 2.4 MilestoneEscrow and MockUSDC

The original stablecoin flow for B2B purchase orders (deposit → delivery → FAT → SAT → retention),
kept for agents that pay in mUSDC. Same wallet, same tiers.

---

## 3. Core algorithms

### 3.1 Tier routing (policy engine, Guard 1)

`web/src/lib/policy.ts` decides, before anything is signed, where an action goes:

```
action ─► injection scan of any untrusted text ─► recipient allowlisted?   no ─► BLOCK
                                                     │ yes
                                                     ▼
                                        amount ≤ per-tx cap and ≤ remaining daily cap
                                        and (release) on-chain evidence present?
                                            yes ─► Tier 2: agent executes with its session key
                                            no  ─► Tier 1: proposal / owner approval
anomaly or manipulation detected ─────────────────► Tier 3: pause
```

Guard 1 exists for explanations and early refusal. Guard 2, the contract, is the real boundary: the
same checks run again on-chain, so a bug or a bypass of Guard 1 only produces a reverted transaction.

### 3.2 Funding saga: from a bank account to an escrow (`fundJustInTime`)

A bank ledger and a blockchain cannot commit together, so the money moves in four idempotent steps.
All of them are keyed by one funding id, the EIP-712 digest of the owner's mandate.

```
1. check   owner signature valid, mandate unused, bank balance covers the total  → else REJECTED
2. debit   buyer account → reserve          (ledger row keyed "fund:<id>"; this is the funding record)
3. mint    the same amount into the buyer's AgentWallet  (MockTHB.mint(..., fundingId): once only)
4. lock    agent submits executeMandate: the wallet approves the escrow and makes the offer
```

- **Nothing is remembered between steps.** Every call reads back from the bank and the chain what already happened, so pressing the button again resumes instead of repeating.
- **Refund only when failure is certain:**
  - The contract refused the transaction, or its receipt shows a revert: the refund runs.
  - A network error: the transaction may still land, so the funding stays `PENDING` and is retried.
  - Before refunding, the mandate is revoked on-chain, so a late or replayed transaction cannot lock money that has already gone back.

Accepting a seller's offer uses the same pattern (`acceptAndPay`): debit, mint, approve, accept, with
burn-and-refund on certain failure.

**Settlement back to the bank.** When the escrow pays a seller (or refunds a buyer), the server burns
the tokens with `redeem(amount, redeemId)`, where
`redeemId = keccak256("payout" | "refund" | "cancel", chainId, escrow, dealId, index)`, and moves the
same amount from the reserve to the person's bank account. The invariant is kept at every step:
**reserve balance = tokens in circulation**.

### 3.3 Encrypted delivery and key release

1. The seller uploads a file (≤ 4 MB). The server encrypts it with AES-256-GCM under a fresh key and stores the ciphertext. `sha256(plaintext)` goes on-chain as `workHash`.
2. Before approval the buyer sees the seller's evidence note and, for images, a 720 px JPEG with a tiled watermark (rendered with sharp; glyphs are SVG paths, so no server fonts are needed). The preview cannot stand in for the work.
3. The buyer approves. The seller's wallet calls `releaseKey` with a commitment to the key: `keccak256(key)`.
4. The server checks that the key decrypts a file whose sha256 equals the on-chain `workHash`, then confirms for the buyer, which pays the seller at once. A key that does not open the file is left for the buyer to dispute.

### 3.4 Physical goods: parcel tracking

A milestone can be delivered as a parcel.

- **Booking.** The seller books with Mock Post, a stand-in for a carrier API shaped like Thailand Post's. It issues UPU S10 tracking numbers with a valid check digit (weights 8,6,4,2,3,5,9,7, e.g. `EF123456785TH`).
- **Other carriers.** The seller can instead record another carrier's number.
- **On-chain record.** The tracking record (carrier, number, note) is hashed and anchored as the `workHash`.
- **Tracking.** The buyer sees the carrier's events (accepted, in transit, at the destination office, out for delivery, delivered) and approves on receipt.
- **Disputes.** The arbiter receives the tracking status as evidence.

### 3.5 Neutral arbiter

A buyer may dispute a delivery inside the review window, giving a reason (at least 10 characters).
The arbiter has its own key, and the wallet contract refuses to let the buyer's side be the arbiter.

- **Key disputes** are mechanical: does the released key open a file with the anchored hash? There is no AI in the loop, and the decision is recorded as `check:key`.
- **Work disputes** go to an LLM that is not the buyer's agent. It gets a case file:
  - the agreed terms and the acceptance criteria
  - the seller's evidence (marked untrusted)
  - the delivered file's text, when it has any
  - tracking status, for parcels
  - the buyer's reason (marked untrusted)

  It returns strict JSON: `{decision, confidence, rationale, findings[criterion, met, evidence]}`.
- **Auto-resolution.** At `confidence ≥ 0.75` the arbiter calls `resolve` on-chain. Below that the case goes to a human arbiter (`/admin/disputes`) with the AI's findings attached. Text in the evidence that tries to steer the ruling counts against the party who wrote it.

### 3.6 Invited sellers without an account

A buyer can hire someone who has no account:

- **The invite.** `invite_seller` creates a server-run AgentWallet for them, allowlists it as a payee, and returns a one-time link. Only the link's sha256 is stored.
- **What the seller does.** Through the link they accept, deliver, and set a payout destination once:
  - a Mock Bank account (the holder name must match)
  - a PromptPay id, typed or read from a PromptPay QR code (EMVCo TLV parsed, CRC-16 checked)
  - another bank's account number
- **Payout.** Earnings are swept there automatically after each payout.

### 3.7 KYC with a national digital ID (mock ThaID, mock 国家网络身份认证)

Identity is verified the way a bank app verifies it against a government digital ID: OpenID
Connect, authorization code flow with PKCE.

```
Profile ─POST /api/kyc/start─► cookie {state, nonce, PKCE verifier} ─► ID provider consent screen
   ▲                                                                   (scan QR / approve; demo: type ID card)
   │                                                                          │ code (single use, 5 min)
   └─ /profile?kyc=ok ◄─ /api/kyc/callback ─► token endpoint (client secret + code_verifier) ─► id_token
                            checks: state, signature, iss, aud, exp, nonce, holder = bank account holder
```

- **Thailand: mock ThaID.** The id_token carries the citizen id (`pid`, 13 digits, mod-11 check digit) and the names. The app keeps `1-2345-xxxxx-xx-6` and an HMAC of the id.
- **China: mock 国家网络身份认证 (National Network Identity).** It follows the 网号/网证 design: the app sends the bank holder's name as `login_hint`, and the provider returns only an opaque 网号 and `name_match`. The resident ID (18 characters, ISO 7064 MOD 11-2 check) never reaches the app.
- **One identity per account.** The HMAC is unique, so one person cannot verify many accounts.
- **Limits.** Unverified customers can lock at most 2,000 THB / 400 CNY per deal and top up 1,000 THB / 200 CNY. The agent sees `identity_verified` and tells the user to verify before approving a larger deal.
- **Discovery.** Both providers publish a discovery document at `/api/mock-id/{thaid|netid}/openid-configuration`. Switching to the real providers means changing endpoints and keys, not the flow.

### 3.8 Card and PromptPay top-ups (Stripe, test mode)

```
Top up ─► POST /api/bank/topup {amount ≤ KYC limit} ─► Stripe Checkout Session (thb / cny, client_reference_id = user)
       ◄─ /chat?topup=cs_test_… ◄── Stripe redirects after payment
       ─► POST /api/bank/topup/confirm ─► GET Session from Stripe: paid? this user? this currency?
                                         ─► ledger TOPUP keyed "stripe:<session id>" (credited once)
```

- **No webhook needed.** The server asks Stripe directly, and the session id is the idempotency key, so a reload or a replayed redirect never credits twice.
- **Test keys only.** Live keys are refused.
- **Ledger invariant.** It becomes: sum of balances = deposits + top-ups.

---

## 4. The AI agent

`web/src/lib/agent.ts`: an LLM tool-use loop (max 12 turns) over any Anthropic-compatible API
(Anthropic, OpenRouter, or a university gateway). Every tool input is validated with zod on the
server, because gateways for non-Claude models do not enforce schemas.

| Tool | Tier | Effect |
|---|---|---|
| `get_wallet_status`, `list_deals`, `forecast_cashflow` | 0 | read; people appear by name only |
| `propose_bank_deal`, `propose_bank_sale` | 1 | save a draft (hire or buy; file, parcel or report per milestone); the user approves |
| `invite_seller` | 1 | wallet + private link for someone without an account (the user asked) |
| `discard_draft` | 0 | delete an unapproved draft |
| `remember_nickname`, `forget_nickname` | 0 | the user's names for contacts, kept across chats |
| `release_milestone`, `transfer` | 2 / 1 | routed by the policy engine |
| `pause_wallet` | 3 | emergency stop |

Behaviours that matter for the task score:

- **Hire vs buy.** HIRE pays a person for work. BUY pays for a thing: a file, or a parcel with tracking. Each deal's kind is recorded and shown everywhere.
- **No draft from guesswork.** Before drafting, the agent must have:
  - the counterparty
  - hire or buy (and, for goods, a file or a physical item)
  - what is delivered
  - the price of each milestone
  - acceptance criteria for each milestone
  - a delivery address for parcels

  If something is missing it asks one short question. The server enforces this too: a draft without criteria or an address returns `NEED_INFO` and nothing is saved.
- **Memory.**
  - Up to five saved chats per wallet, stored on the server. The model's history is rebuilt from the database, never taken from the browser.
  - Nicknames ("my designer") map to a contact on the server and work in every chat.
- **Streaming.** The chat receives `turn`, `text`, `tool`, `step` and `done` events over SSE, so the user sees each check as it happens.
- **Untrusted input.** Uploaded PDFs and texts are fenced as `<untrusted_document>` and pre-scanned for injection patterns and unknown addresses; flags are shown next to the answer.

`npm run agent-eval` grades the live agent on the demo's decision points: deal setup, autonomous
payment, over-cap approval, refusing an incomplete SAT, and phishing.

---

## 5. Security design

The full self-assessment, with the known-risk list R1–R11, is in [SECURITY.md](SECURITY.md). The
design in brief:

1. **The LLM is never trusted.** Every rule is enforced twice: the policy engine first, then the contract. The agent's session key is capped, scoped and expiring, and the owner can revoke it instantly.
2. **Every user click is a signature.** Owner actions are EIP-712 mandates. Each binds the exact call, a reason hash and a nonce, expires after a short deadline (10–60 minutes), and can be used once. The browser never sends amounts or recipients at approval; the server reads the draft the user saw.
3. **Money cannot be created or paid twice.** Mints and burns carry ids derived from the deal and milestone. Ledger transfers have idempotency keys. Refunds happen only on certain failure.
4. **Fair exchange.** The buyer's money is locked before any work is shown, and the file key is released only after approval. Review windows end every possible stall.
5. **Neutral dispute resolution.** The arbiter has a separate key, the contract enforces its neutrality, and it auto-rules only when confident. The rest goes to human review.
6. **Address privacy in the agent.**
   - The model sees names, never wallet addresses. Tools resolve names to addresses on the server, and only among the user's own contacts.
   - Every reply, tool summary and streamed chunk is filtered for 40-hex addresses.
   - The browser receives redacted tool steps, never raw results.
7. **Permissioned chain, public reads.** Besu's account allowlist means only the app's keys can write, and every RPC call needs a JWT. Judges can verify any hash without trusting our explorer, through read-only JSON-RPC (method allowlist, log range ≤ 5,000 blocks).

---

## 6. Data and privacy

| Data | Where | Why |
|---|---|---|
| Balances, escrow state, work hashes, key commitments, disputes' outcomes | chain | enforced and publicly verifiable |
| Deal titles, milestone names, acceptance criteria, ship-to address | Postgres (`DealDraft`) | personal data stays deletable; the chain gets only `sha256` of the terms |
| Delivered files | Postgres, AES-256-GCM ciphertext | released to the buyer only after the key release |
| Bank accounts and transfers | Postgres (Mock Bank) | simulated money, labelled as a demo everywhere |
| Chats and nicknames | Postgres, per user, cascade-deleted with the account | memory the user can delete |

The money-summary feature sends the LLM only aggregates and deal titles: no names, account numbers
or addresses. Deleting an account removes the user's drafts, chats and nicknames.

---

## 7. Testing

| Suite | Command | Covers |
|---|---|---|
| Contracts (66 tests) | `cd contracts && npm test` | tiers, caps, allowlists, mandates (replay, expiry, revoke), prompt-injection "send everything to 0xEvil" cases, file escrow windows and disputes, seller offers, mint and redeem idempotency |
| Backend end to end | `cd web && npm run e2e` | wallet creation, deal setup, release, proposals against a running chain |
| Bank and funding | `npm run bank-check`, `npm run funding-check` | ledger invariant, saga retries, certain-failure refunds |
| Agent evaluation | `npm run agent-eval` | the agent's decisions on the demo scenarios |
| Evidence | `scripts/evidence.mts` | regenerates EVIDENCE.md from the live chain |

---

## 8. Technology stack

| Layer | Choice |
|---|---|
| Contracts | Solidity 0.8.28, OpenZeppelin, Hardhat 3, viem |
| Chain | Hyperledger Besu (QBFT, account allowlist, JWT RPC), Docker, Tailscale Funnel; Base Sepolia as fallback |
| Web | Next.js 16 (App Router), React 19, TypeScript, Vercel |
| Data | PostgreSQL (Neon), Prisma 7 |
| AI | Anthropic SDK (Messages API) to Anthropic, OpenRouter or a university gateway; tool use with zod validation |
| Payments and identity | Stripe Checkout (test mode, card and PromptPay); OpenID Connect with PKCE via jose (mock ThaID, mock 国家网络身份认证) |
| Other | sharp (watermarked previews), unpdf (PDF text), jsQR / qrcode (PromptPay QR), better-auth (sessions) |
