# Attack cases (35)

Each case: who attacks, what they try, what should stop it, and how it is covered. Status: **Tested** (a test passes today),
**Known gap** (a test passes and records current, unsafe behaviour; see the finding), **To write** (finding exists, test not
yet written). Contract tests run with `cd contracts && npm test` (97 passing at `e0113ed`). IDs refer to
[AUDIT-2026-10-14.md](AUDIT-2026-10-14.md) and the owner's delta-audit reports.

## Contracts and wallet

| # | Attacker and attack | Defence | Status | Where |
|---|---|---|---|---|
| 1 | A prompt-injected agent pays "everything" to 0xEvil | Recipient allowlist | Tested | `AgentWallet.ts` "blocks 'transfer all funds to 0xEvil' on every path" |
| 2 | The agent pays more than the per-payment cap | `ExceedsPerTxLimit` | Tested | `AgentWallet.ts`, `SpendWindow.ts` (cap edge) |
| 3 | The agent spends past the daily cap, or right at the edge | `ExceedsDailyLimit` | Tested | `SpendWindow.ts` (4 seeds, mutation-checked) |
| 4 | A leaked, expired session key is used | Expiry | Tested | `AgentWallet.ts` "session keys expire"; `SpendWindow.ts` |
| 5 | The agent keeps paying after a pause | `whenNotPaused` | Tested | `AgentWallet.ts`; `WalletFileDeal.ts` |
| 6 | A rogue or unlisted escrow is used for release | Escrow allowlist | Tested | `AgentWallet.ts` "blocks releasing from a non-allowlisted escrow" |
| 7 | A deal in another token or to another payee | Token and payee checks | Tested | `AgentWallet.ts` "SetupDeal rejects..." |
| 8 | A deal whose arbiter is on the buyer's side | `ArbiterNotNeutral` at setup | Tested | `AgentWallet.ts`; `WalletFileDeal.ts` (exact error) |
| 9 | The owner later makes the deal's arbiter an approver or session key (AW-M-03) | None today | Known gap | `WalletFileDeal.ts` |
| 10 | A signed mandate is replayed, altered, forged, used late or after an ownership change | EIP-712 domain, digest, deadline, current owner | Tested | `AgentWallet.ts` mandate tests |
| 11 | A stranger calls agent functions or approves proposals | `onlyAgent`, `onlyApprover` | Tested | `AgentWallet.ts` |
| 12 | A proposal approved after the approver set changed | Epoch staleness | Tested | `AgentWallet.ts` "proposals go stale..." |
| 13 | A non-bank key mints tokens (including the admin) | `BANK_ROLE` | Tested | `MockTHB.ts`; `Invariants.ts` |
| 14 | The bank key mints twice for one funding id, or above its caps | Single-use ids, caps | Tested | `MockTHB.ts`; `Invariants.ts` |
| 15 | The bank key burns someone else's tokens | Holder-only redeem | Tested | `MockTHB.ts` |
| 16 | A stranger or a party resolves a dispute | Arbiter only | Tested | `DisputeExits.ts` |
| 17 | The arbiter never rules; funds stay locked (DC-M-01) | None today | Known gap | `DisputeExits.ts` (both escrows) |
| 18 | The seller refunds a disputed deal before the arbiter rules (DC-L-01) | None today | Known gap | `DisputeExits.ts` |
| 19 | After the key is posted, the agent's second approval pays at once, with no key check (DC-H-01) | None today | Known gap | `WalletFileDeal.ts`; `DisputeExits.ts` |
| 20 | The same milestone counted twice against the agent's cap (DC-L-02) | None today | Known gap | `WalletFileDeal.ts` |
| 21 | Tokens created or lost through any sequence of escrow calls | Escrow accounting | Tested | `Invariants.ts` (4 seeds, mutation-checked) |
| 22 | A reentrant token callback during settlement | `ReentrancyGuard` | To write | Needs a hostile-token test contract |

## Web, bank and AI (tests need a database; to write)

| # | Attacker and attack | Defence | Status | Source |
|---|---|---|---|---|
| 23 | Two users create wallets at the same moment and get each other's (AW-H-01) | Address from the receipt (`b53222c`) | To write (regression) | `docs/security/poc/` |
| 24 | A seller's evidence text makes the agent release funds (AW-H-02) | Policy + caps only | To write (mocked model) | audit AW-H-02, SD-02 |
| 25 | Party text steers the AI arbiter into a high-confidence ruling (DA-H-01) | 75% threshold, human fallback | To write (mocked model) | delta audit |
| 26 | The buyer rewrites the dispute reason after review (DA-M-01) | None found | To write | delta audit |
| 27 | AI, human and settlement race on one dispute (DA-M-02) | Idempotent redeem ids only | To write | delta audit |
| 28 | Five parallel wrong PINs beat the lock (AW-M-02) | Counter, not atomic | To write | audit |
| 29 | Registration reveals which usernames exist | `USERNAME_TAKEN` | To write | audit |
| 30 | Two approvals of one draft debit twice (DB-01) | None found | To write | delta audit |
| 31 | Re-authorising a bank link while a funding runs still debits it (AW-L-01, DB-02) | None found | To write | audit, delta audit |
| 32 | Whoever holds an invite link sets the payout destination (DB-03) | Destination locked once set | To write | delta audit |
| 33 | A spoofed `x-forwarded-for` resets the rate limit (DB-06) | In-process limiter | To write | delta audit |
| 34 | One user reads or acts on another's wallet, draft or deal | `guard.ts` ownership check | To write (route matrix) | delta audit |
| 35 | The attack route, or a caller-chosen signing role for pause, burns shared gas | Auth only | To write | audit |

Counts: 21 tested or known-gap cases on the contracts, 1 contract case to write, 13 web cases to write.
Privacy test (canary text must not reach the chain on any path, SD-01) is tracked in [PRIVACY-DATA-MAP.md](PRIVACY-DATA-MAP.md).
