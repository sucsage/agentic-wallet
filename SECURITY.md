# Security self-assessment

Agentic Wallet · FinTechathon 2026, International Track, Topic F (Agent Wallet)

This document covers the permission tiers, how each one is enforced, what we tested, and the risks
we know about. Everything runs on test money: a simulated bank ("Mock Bank") and tokens with no value
on our own permissioned chain. No real funds, bank accounts or credentials are involved.

## 1. What is being protected

| Asset | Where it lives | Who may move it |
|---|---|---|
| Buyer's money (simulated baht) | Mock Bank ledger (Postgres) until a deal is locked | Only the buyer's own click, debited just in time for one deal |
| Money locked for a deal | `FileEscrow` contract (mTHB tokens) | The escrow rules: buyer approval, review windows, neutral arbiter |
| The agent's spending power | `AgentWallet` contract, one per user | Session key within caps and allowlists; everything else needs the owner |
| Delivered files | Postgres, AES-256-GCM encrypted | The seller; the buyer only after approving and the key being released on-chain |
| Personal data (names, deal titles, chat) | Postgres only | Never written on-chain (PDPA): the chain holds hashes and amounts |

## 2. Permission tiers

The agent never holds the owner key. It has a **session key** with an expiry, a per-transaction cap and
a daily cap. Every action is checked twice: by the off-chain policy engine
(`web/src/lib/policy.ts`, guard 1) and again by the `AgentWallet` contract (guard 2). A bug, a
jailbreak or a stolen agent key can get past guard 1, but the contract still refuses.

| Tier | Who acts | What it covers | On-chain enforcement (`contracts/contracts/AgentWallet.sol`) |
|---|---|---|---|
| **Tier 0 · Read** | Agent | Balances, deals, allowlist, history | Read-only calls |
| **Tier 1 · Human approves** | The owner (the user's click) | Locking money in a new deal, sending an offer, accepting an offer, anything above the agent's caps, adding a payee, changing caps | `propose()` → `approve()` by `threshold` approvers, or an **EIP-712 mandate** signed by the owner (`executeMandate`): bound to this wallet and chain, single use, with a deadline, revocable (`revokeMandate`), and void if the owner changes. Mandates pass the same checks as proposals |
| **Tier 2 · Agent acts alone** | Agent session key | Approving a delivered milestone (`agentApproveFile`), paying an allowlisted recipient (`agentTransfer`), releasing a milestone with evidence (`agentReleaseMilestone`) | Session active and not expired; **per-tx cap** and **daily cap** (`_spend`); recipient on the **allowlist**; escrow on the escrow allowlist; this wallet must be the deal's buyer; settlement token only |
| **Tier 3 · Emergency stop** | Agent, approvers or owner | Pausing the wallet when something looks wrong | `pause()` blocks every Tier 1 and Tier 2 path (`whenNotPaused`); **only the owner can `unpause()`**; the owner can `revokeSession` instantly |

Default caps for a bank-backed wallet: **฿5,000 per transaction and ฿20,000 per day** (¥1,000 / ¥4,000
for CNY customers). New wallets start with an **empty allowlist**: a friend becomes a payee only when
the user presses "Add to allowlist", which is an owner transaction.

Generic calls are narrow. A Tier 1 `Call` may only do these things:

- approve the wallet's token for an allowlisted escrow
- create a deal with an allowlisted payee in the wallet's token, under a neutral arbiter
- take the buyer's side of a `FileEscrow` deal: accept, approve, dispute, reclaim, cancel
- take the seller's side of a `FileEscrow` deal: offer, accept a buyer's offer, deliver, release the key, claim, refund, withdraw its own offer

The seller's moves can never take money out of the wallet. Anything else reverts with `InvalidProposal`.

**Neutral arbiter.** A deal's arbiter may not be the wallet itself, its owner, an approver or a session
key (`ArbiterNotNeutral`), so the buyer's side can never judge its own dispute.

## 3. Money flow controls (Mock Bank ↔ chain)

- **Just-in-time funding** (`web/src/lib/bank/funding.ts`). The steps are: check the owner's
  signature → debit the bank → mint the same amount → lock it in escrow. One funding id (the mandate's
  EIP-712 digest) keys every step, so a retry never debits or mints twice. If the lock **certainly**
  failed, the mandate is revoked first, the tokens are burned and the bank is refunded. If the outcome
  is unknown (a network error), the funding stays `PENDING` and nothing is refunded by guesswork.
- **Reserve invariant.** Every mTHB in circulation is backed by the Mock Bank reserve account. Mint and
  redeem ids are single use on-chain (`MockTHB.minted / redeemed`), and only the bank key (`BANK_ROLE`,
  separate from the owner key) can mint.
- **Ledger.** Every transfer has an idempotency key that is unique in the database. A debit and its
  balance check run in one statement, so concurrent requests cannot overdraw. Currencies never mix.
- **Payout.** When escrow pays a seller, the seller's tokens are redeemed (burned) and the same amount
  moves from the reserve to the seller's bank account, keyed by deal and milestone.

## 4. Files, evidence and privacy

- Delivered files are encrypted with **AES-256-GCM** and stored in Postgres. Only their **sha256**
  goes on-chain, as the work hash. The release on-chain carries a keccak commitment to the key.
- The buyer can download only once the escrow shows the key as released. Before that the server
  refuses, and the decrypted file's hash must match the on-chain work hash.
- After the buyer approves, the server decrypts the file, checks it against the on-chain hash and only
  then confirms the key for the buyer, which pays the seller at once. A key that does not open the file
  is never confirmed; the buyer can dispute it inside the window.
- PDPA: names, titles, milestone descriptions and chat stay in Postgres, where a user can export and
  delete them. The chain stores `sha256:` hashes of the terms and the amounts only. The public
  explorer labels user wallets as "Agent wallet (user)", without names.

## 4b. Disputes and the neutral arbiter

- The buyer can dispute inside a review window. The reason is required and stored off-chain.
- **Key disputes** ("the released key does not open the file") are decided by a check, not by a model:
  the server decrypts the delivery and compares its sha256 with the work hash anchored at delivery.
- **Work disputes** go to the AI arbiter (`web/src/lib/bank/arbiter.ts`). Its inputs are:
  - the agreed terms and acceptance criteria
  - the seller's evidence and, when the file is text, its content
  - the buyer's reason

  It returns a ruling, a confidence, a rationale and per-criterion findings. At **≥ 75% confidence** it
  calls `FileEscrow.resolve` with the arbiter's own key. Otherwise a human arbiter (an admin) rules at
  `/admin/disputes` with the AI's findings in front of them.
- The resolve transaction is on-chain. Settlement to the bank then runs as for any payout or refund.

## 5. Application security

- **Sign-in.** Mock Bank login with a 6-digit demo PIN, hashed with scrypt. After **5 wrong PINs the
  account locks for 15 minutes**. Sessions are handled by Better Auth. The login page states that
  this is a demo bank and must not get real credentials.
- **Authorization.** Every wallet route checks the session **and** that the wallet belongs to the
  user (`web/src/lib/guard.ts`). The browser never sends amounts or payees for a lock: approval reads
  the draft back from the database, so what gets locked is what the user saw.
- **Rate limits** on all write routes (approve, deal actions, deliveries, invites, payout checks, RPC).
- **Prompt injection.** Documents, invoices and evidence are passed to the model as untrusted data. A
  heuristic scanner flags overrides, urgency, changed bank details and unknown addresses. The real
  defence is on-chain: an address that is not on the allowlist reverts, whatever the model says.
- **The agent never shows addresses or internal data.** The model is given people's names only,
  never wallet addresses. Its tools turn a name back into an address on the server, and only for the
  user's own contacts, so an address in a document cannot become a payee. Every reply and tool result
  is filtered for 40-hex addresses, and streamed text holds back anything that could still grow into
  one. Database ids, keys and other users' data are never in what the tools return.
- **The agent's memory is kept on the server.** Saved chats (five per wallet) are stored server-side,
  and the model's history is rebuilt from them, so a browser cannot rewrite what the agent was told
  earlier. The browser receives each tool step as the chat shows it (name, redacted summary, draft
  card), never the raw tool result. Nicknames the user teaches the agent map to a contact on the
  server; the model still sees only names.
- **No draft from guesswork.** A deal draft needs acceptance criteria for every milestone and, for a
  parcel, a delivery address; otherwise the tool refuses with NEED_INFO and the agent must ask.
- **KYC through a national digital ID, without keeping the ID.** Thai customers verify with a mock
  ThaID, Chinese customers with a mock 国家网络身份认证 (National Network Identity), over OpenID Connect
  (authorization code + PKCE, state, nonce; the id_token's signature, issuer, audience and expiry are
  checked; codes are single use for 5 minutes). The ID holder must be the bank account holder. We
  store only a masked id and an HMAC of it (one identity verifies one account); the mock provider
  drops the claims once the token is issued. The Chinese flow follows the 网号 design: the app gets an
  opaque network id and a name-match result, never the resident ID number. Until verified, a
  customer can lock at most 2,000 THB / 400 CNY per deal and top up 1,000 THB / 200 CNY.
- **Card top-ups cannot be forged.** Top-ups use Stripe Checkout in test mode only (live keys are
  refused). The browser's return proves nothing: the server fetches the Checkout Session from Stripe
  and credits it only if Stripe says it is paid, for this user, in this currency, once per session id.
- **Previews before payment cannot replace the work.** A delivered image is shown to the buyer only as
  a 720 px JPEG with a tiled watermark; the original stays encrypted until the key is released.
- **Chain access.** Besu runs **account permissioning**, so only the app's own keys can send
  transactions. Its RPC needs a signed JWT (RS256) that only the server holds. The public `/api/rpc`
  passes **read-only methods** only (no `eth_sendRawTransaction`), with bounded `eth_getLogs` ranges.
- **Secrets.** Keys live in environment variables (Vercel) and the git-ignored `.secrets/` folder,
  never in the repository.

## 6. Testing

- **Contracts:** 65 Hardhat tests (`cd contracts && npm test`): 39 for `AgentWallet`, 16 for
  `FileEscrow` and 10 for `MockTHB`. They include:
  - the prompt-injection case "send everything to 0xEvil" (reverts with `RecipientNotAllowed`)
  - over-cap payments (`ExceedsPerTxLimit`, `ExceedsDailyLimit`)
  - a non-neutral arbiter, the wrong token, rogue escrows
  - paused-wallet refusals
  - mandate replay and expiry
  - seller-only and buyer-only moves
  - the key-confirmation payout
- **Live attack demo:** the Policy page sends `agentTransfer(0xBAd…Bad, 5000)` straight from the
  agent's key, skipping the AI and the policy engine. The contract reverts it on-chain, and the
  reverted transaction hash can be checked in the public explorer.
- **End to end on production:** these flows were run with two test users:
  - buyer offer → seller accepts → encrypted delivery → buyer approves (Tier 2) → key released → buyer downloads a byte-identical file → seller paid to their bank
  - seller offer → buyer accepts and pays from their bank
  - offer withdrawn
  - invited seller without an account, with PromptPay QR and Mock Bank payouts, name checks and the payout lock
- **Agent evaluation:** `cd web && npm run agent-eval` grades the live agent on its decision points:
  deal setup, autonomous payment, over-cap escalation, refusing incomplete work, and phishing.

## 7. Known risks

| # | Risk | Impact | Current mitigation | What production would need |
|---|---|---|---|---|
| R1 | **The server holds every wallet's owner key.** A user's click is turned into an owner signature by the server (demo custody) | Whoever controls the server could sign owner actions, including the unrestricted owner `execute` | Keys only in server env; every owner action is recorded on-chain; mandates are single use and expire | The owner key on the user's device (passkey or hardware wallet signing the EIP-712 mandate), or a Safe multisig as owner |
| R2 | **The server holds file keys and the keys of invited sellers' wallets** | A server breach exposes delivered files and lets the attacker act as invited sellers | Files encrypted at rest; delivery hashes on-chain, so tampering is detectable; payout destination locked once set | Encrypt files to the buyer's public key on the client; give invited sellers a passkey-controlled wallet |
| R3 | **An invite link is a bearer credential**: anyone holding it acts as the invited seller | A leaked link lets someone accept or deliver in the seller's name | Only the link's hash is stored; 30-day expiry; the buyer can rotate it; `no-referrer`, `noindex`; the **payout destination is set once and locked**, so a leaked link cannot redirect money; name check on Mock Bank accounts; strict rate limit on payout attempts | One-time code by SMS or email before the first action; device binding |
| R4 | **The chain has one validator**, on a home PC reached through Tailscale Funnel | If the PC is off, the app cannot transact; one operator could rewrite history | QBFT, account permissioning, JWT-protected RPC; contracts and the Base Sepolia deployment kept as a fallback | Four or more validators run by different parties (BFT), monitoring, backups |
| R5 | **PromptPay and other-bank payouts are simulated.** We are a mock bank, so money leaves through an internal "external" account | Nothing real is paid out; PromptPay ids cannot be name-checked | Clearly labelled as a demo in the UI; Mock Bank to Mock Bank transfers are real ledger transfers with a name check | Integration with a licensed bank or ITMX PromptPay APIs, with name inquiry |
| R6 | **An AI arbiter decides disputes about the work** | A wrong ruling pays the wrong side | The arbiter is neutral by contract (`ArbiterNotNeutral`) and is a separate model call with its own instructions, not the buyer's agent. It judges only against the written acceptance criteria and treats both parties' text as untrusted. It settles alone only at ≥ 75% confidence; below that a human arbiter decides at `/admin/disputes`. Key disputes are checked mechanically (hash), not by AI. Findings and rationale are shown to both sides | An appeal window before `resolve`, a panel of human arbiters for large amounts, and an evaluation set of past disputes |
| R7 | **Prompt injection or a hallucinating model** | The agent proposes the wrong thing | Allowlist, caps and neutral-arbiter checks are on-chain; Tier 1 needs the user's click; injection scanner; the tools validate every input | Already the main control; add per-counterparty limits and anomaly alerts |
| R8 | **Agent session key leak** | Spending up to the caps to allowlisted payees | Caps, allowlist, expiry, instant `revokeSession`, `pause()` | Short-lived keys from a KMS/HSM; alerts on unusual spending |
| R9 | **Smart contract bugs** | Locked or lost test funds | OpenZeppelin 5 primitives, `ReentrancyGuard`, `SafeERC20`, 65 tests | External audit, Slither/Echidna in CI, formal checks of the escrow state machine |
| R10 | **Public explorer and RPC load** | Heavy scraping could slow the node | Read-only methods, bounded log ranges, rate limits on `/api/rpc` | Caching indexer and a separate read replica |
| R11 | **Shared demo database** (Neon, one schema per deployment) | Test data of several testers sits together | Users see only their own wallets; names never on-chain; export and delete in the profile | Per-tenant isolation, encryption of personal fields, retention policy |

## 8. Compliance notes

- **Test money only**: Mock Bank balances and mTHB/mCNY tokens have no value; the chain is private
  and permissioned. No real bank credentials are ever requested (the UI says so on every bank screen).
- **Audit trail**: every lock, approval, delivery, release, payout and pause is a transaction or event
  on-chain, visible in the public explorer and through the read-only RPC.
- **Data minimisation (PDPA)**: only hashes and amounts go on-chain; personal data stays deletable.
- **Human in the loop**: committing money (Tier 1) always needs the user; the agent's own authority
  (Tier 2) is capped by the contract, not by the prompt.
