# SECURITY.md and README corrections (proposed)

Source: line-by-line fact check of `SECURITY.md`, `EVIDENCE.md` and the README reviewer statements against the code at
`origin/main` `156d6b7` (2026-10-15). Line numbers refer to that revision. Verdict: **changes requested**: the
documents are a strong base, but several absolute statements are false or too strong. Fixing them costs little
and protects the security score (30%). The full claim-by-claim table is in the owner's review archive.

## What is wrong, ranked

| ID | Severity | Problem | Section |
|---|---|---|---|
| SD-01 | High | "Personal data stays off-chain / only hashes on chain" is false: delivery identifiers, terms, reasons and key bytes are public call data | `SECURITY.md:17,73-75,154`, `README.md:51-53` |
| SD-02 | High | Agent release of evidence is presented as safe; policy lets `EvidenceSubmitted` through with no acceptance check (AW-H-02) | `SECURITY.md:30,101-103,142,156` |
| SD-03 | Medium | "Neutral arbiter" holds at setup only; later role changes can break it (AW-M-03) | `SECURITY.md:46-47,141-143` |
| SD-04 | Medium | "All write routes rate-limited": the limiter is per instance and trusts the forwarded-IP header | `SECURITY.md:100,138,145` |
| SD-05 | Medium | Five-PIN lock can be raced by parallel requests (AW-M-02) | `SECURITY.md:94-96` |
| SD-06 | Medium | Reserve backing is stated as an invariant, but no reconciler runs | `SECURITY.md:56-62` |
| - | Low | Test count is 66 (39 / 16 / 11), not 65 | `SECURITY.md:112-120`, `README.md:134` |
| - | Low | README architecture still describes the MilestoneEscrow/mUSDC sandbox and "chain is the only database" | `README.md:45-53` |

## Paste-ready replacements

1. Replace `SECURITY.md:17`, `:73-75`, and `:154` with: “Personal data and delivered-file contents are stored in Postgres and can be exported or deleted there. The current chain records amounts, hashes and application/contract call data; users must not place personal data in public terms, evidence, reasons or delivery metadata. Production needs an enforced off-chain reference format and PII canary tests.”
2. Replace `SECURITY.md:21-24` with: “The agent uses a separate session key with expiry and caps. In this demo the server also holds the owner key to sign user-authorized mandates, so server compromise defeats that separation. Direct agent actions are checked by the policy engine and again by the contract; owner recovery actions remain explicitly broader.”
3. Replace the final sentence of `SECURITY.md:30` with: “For direct agent actions, the wallet enforces an active session, per-transaction and daily caps, allowlisted recipient/escrow, buyer role and settlement token. These mechanical checks do not verify that untrusted delivery evidence satisfies acceptance criteria.”
4. Replace `SECURITY.md:31` with: “`pause()` blocks proposal, mandate and direct-agent paths marked `whenNotPaused`; only the owner can `unpause()`, and the owner can revoke a session immediately. The owner recovery `execute` path is not paused.”
5. Replace `SECURITY.md:46-47` with: “At deal setup the arbiter cannot be the current wallet, owner, approver or active session key. Production must also prevent later role or ownership changes from creating a party/arbiter conflict for active deals.”
6. Replace `SECURITY.md:56-62` with: “Minting and redemption use per-record ids and the Mock Bank mint key is role-restricted. The application is designed to keep token supply and the Mock Bank reserve aligned through idempotent funding/payout flows; production still needs an independent reconciler and alerts.”
7. Replace `SECURITY.md:100` with: “Write routes apply best-effort demo rate limits. Production needs a shared rate-limit store and trusted proxy-derived client identity.”
8. Replace `SECURITY.md:94-96` with: “Mock Bank PINs are scrypt-hashed and the application intends to lock after five failed attempts for 15 minutes. Atomic parallel-attempt enforcement remains a required regression test before any non-demo use.”
9. Replace `SECURITY.md:112-113` and `README.md:134` with: “Contracts: 66 current Hardhat test declarations (39 `AgentWallet`, 16 `FileEscrow`, 11 `MockTHB`); run `cd contracts && npx hardhat test` to record the passing result for this revision.”
10. Replace `SECURITY.md:121-130` with: “The repository contains evidence links and scripts for the attack demonstration, end-to-end flows and agent evaluation. Attach dated receipts, run logs and environment/version identifiers before representing them as independently verified live results.”
11. Replace `README.md:3-6` with: “The agent uses a scoped, expiring session key and the contract mechanically limits direct agent actions. In this demo the server holds the owner key for user-authorized actions; therefore the controls limit agent-key misuse but do not make server compromise harmless.”
12. Replace `README.md:51-53` with: “Current application state spans Postgres and the chain. Delivered files are encrypted in Postgres; the chain stores deal state and call payloads. Do not treat current on-chain fields as a PII-safe document store.”
13. Replace `README.md:64-66` with: “Tier-1 `Call` selectors are allowlisted for escrow setup and limited buyer/seller FileEscrow moves. Dedicated checked paths handle direct agent transfers/releases; the owner `execute` recovery path is intentionally unrestricted.”

### Proposed known-risk rows (R12 onward)

| # | Risk | Impact | Current mitigation | What production would need |
|---|---|---|---|---|
| R12 | **Untrusted delivery evidence can influence an autonomous release within existing caps** | An allowlisted seller may receive a cap-compliant payment for work that does not satisfy acceptance criteria | Untrusted-data prompt, scanner, allowlist and caps; none is a deterministic acceptance gate | Human approval or independent deterministic verifier before evidence-based release; adversarial-model regression suite |
| R13 | **Arbiter neutrality can change after deal setup; one arbiter key is systemic** | A conflicted or compromised arbiter can resolve disputed funds unfairly | Setup-time party/controller checks; separate configured key | Active-deal conflict checks on every role/owner mutation, key custody/HSM, rotation and appeal process |
| R14 | **Reserve backing has no independent reconciler** | Ledger/token/escrow drift or incomplete compensation may persist undetected | Idempotency keys, on-chain mint/redeem ids and retry-aware flows | Scheduled snapshot reconciliation, alerting, repair runbook and failure-window tests |
| R15 | **Demo rate limits are instance-local and forwarded-header keyed** | Request floods, PIN guessing or signer-gas griefing can evade intended limits | In-memory buckets on selected routes | Shared rate-limit store, authenticated/verified client identity, proxy configuration and load tests |
| R16 | **PIN lockout has a concurrent-update race** | More than five PIN guesses can be attempted before account lock | Intended 5-attempt/15-minute rule and framework rate limiting | Atomic conditional increment/lock, uniform errors and concurrent integration test |
| R17 | **On-chain payloads can contain personal data** | Irreversible public disclosure conflicts with minimisation/deletion statements | Hashes for some fields and encrypted file storage | Strict off-chain references, schema validation/rejection of PII payloads, disclosure and canary tests |

## Accurate, but incomplete

| Claim | What is missing | Evidence |
|---|---|---|
| Caps/allowlists protect all agent actions | They protect only the three direct agent paths; owner `execute`, approved proposals and mandates are intentionally outside session caps. | `AgentWallet.sol:243-254,270-301,351-370`; audit `:65-66`. |
| Neutral arbiter | Creation-time neutral only; active deals can become conflicted after role/owner mutation. Arbiter-key custody is external/systemic. | Audit `:36,77,98`; `config.ts:98-100`. |
| Reserve invariant/JIT safety | Per-step idempotency is not a reconciler. No production job ties reserve, supply, locks and payouts together; JIT has no production caller according to audit. | `funding.ts:141-278`; audit `:67,137`. |
| Rate limits | They are best-effort per-instance maps keyed by forwarded header, not shared/identity-safe production controls. | `guard.ts:85-95`; audit `:68,151`. |
| File hash/key controls | A server-held file key is verified by server code, not by the contract; silence can settle after a deadline, and on-chain payload privacy is overclaimed. | `deals.ts:521-538`; audit `:78-80`. |
| Server custody risk | Owner, agent, contractor, bank and arbiter roles are separate keys but server/environment custody of several keys means compromise defeats the “agent never owner” boundary. | `config.ts:87-105`; audit `:88-105`. |

## Needs dated evidence, or softer wording

- All live URLs, chain ID/block height, transaction hashes, deployed addresses and explorer/RPC availability in `EVIDENCE.md:3-155` and `README.md:15-29,90-102,148-161`.
- “End to end on production” flows and byte-identical downloads in `SECURITY.md:124-128`.
- The Policy-page attack transaction and exact revert in `SECURITY.md:121-123` / `EVIDENCE.md:151-155`; also reconcile the 5,000 wording with EVIDENCE's 500,000 minor-unit amount.
- Agent-evaluation scores and timing in `SECURITY.md:129-130` / `README.md:80`.
- Home-PC/one-validator/Tailscale topology, Besu account permissioning and Base Sepolia fallback in `SECURITY.md:139`, `README.md:88-123`.
- Vercel/Neon configuration, no real credentials, secret placement, customer export/delete, invite headers, name checks and actual payout-bank movements.

## Open questions for the team

1. Must every evidence-based payout have a human or independent verifier, or is autonomous release an accepted, documented risk?
2. Who owns reconciliation, retries and alerts for funding and settlement?
3. Should active escrows block conflicting role changes, or allow counterparty-approved arbiter rotation?
4. Which fields may be public on chain, and how is the historical demo data disclosed?
