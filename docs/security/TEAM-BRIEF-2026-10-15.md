# Security and testing brief for the team (2026-10-15)

From @NawaratKhem (tests, security, contract review). Deadline: 2026-10-20 22:59 Thai time. Branch `team/NawaratKhem`; nothing here changes code you own.

## 1. Where the contract plan stands

The architecture PDF v0.8 listed contract items that the team has since built differently. This is what I will test and document unless you say otherwise:

| PDF item | State on `main` (156d6b7) | What I will do |
|---|---|---|
| `AIArbiter` (2-of-3 EIP-712, appeal) | Not built. An AI arbiter runs on the server with one key and a human fallback (`web/src/lib/bank/arbiter.ts`) | Test and document the real design. `SECURITY.md` must not describe the 2-of-3 jury as built |
| `resolveSplit`, `settle` | Not built | Drop from the test plan |
| `timeoutResolve` | Not built | See [PROPOSAL-dispute-timeout.md](PROPOSAL-dispute-timeout.md) |
| `createGroupWallet` | Not built. Groups live in the web database | Drop from the contract tests. Group rules are tested at the web level |
| mTHB, `BANK_ROLE` | Built (`MockTHB`, plus `MockCNY`) | Invariant and fuzz tests |
| Wallet seller moves | Built in `3fa5226`, `1edfa85` | Review and negative tests |

Please tell me if any of these is still planned, so I do not remove tests you expect.

## 2. What the review of `main` (156d6b7) found

Review by reading the code, with the contract suite rerun (66 passing). Nothing was exploited, and nothing was run against the live chain.

| Where | Finding | Severity |
|---|---|---|
| Contracts | After the seller releases a key, `agentApproveFile` calls `approve` again and `FileEscrow` pays at once, skipping the challenge window and the arbiter | High |
| AI arbiter | Seller and buyer text goes to the model, which can resolve irreversibly at 75% confidence | High |
| Contracts | A disputed milestone has no exit if the arbiter never rules (`MilestoneEscrow` has none at all) | Medium |
| Contracts | Arbiter neutrality is only checked at setup; later role changes can break it | Medium |
| AI arbiter | A buyer can rewrite the dispute reason after review; AI, human and settlement states are not atomic; the rationale can leak withheld text | Medium |
| Web | Two approvals of one draft can double-debit; a re-authorization can unlink a bank account that is still debited; the invite link is a bearer credential for the payout destination; legacy paths still write text on chain; PIN lock race; rate limiter is per instance | Medium |

Already fixed upstream: the wrong-wallet race (AW-H-01, `b53222c`). Details: [AUDIT-2026-10-14.md](AUDIT-2026-10-14.md) (old commit) and the newer delta reports kept in the owner's review archive; the corrections to `SECURITY.md` are in [SECURITY-CORRECTIONS.md](SECURITY-CORRECTIONS.md).

## 3. Questions that need an owner

1. **Stuck disputes.** A milestone in `Disputed` leaves only through the arbiter's `resolve`, or a seller `refund` on a FileEscrow deal. If the arbiter never rules, the money stays locked. Is a `timeoutResolve` acceptable, and who adds it? Draft: [PROPOSAL-dispute-timeout.md](PROPOSAL-dispute-timeout.md).
2. **Key confirmation by the server.** After the buyer approves, the server confirms the key for the buyer and pays the seller (`024963e`). Under our P2P rule (funds stay locked until the counterparty confirms) the buyer's own click should be the confirmation. Is the server step intended only for the demo?
3. **Agent approval of a released key.** The first High above lets the AI agent trigger an immediate payout once the key is out. Should only the buyer's own click do that, as the P2P rule says?
4. **Contract freeze.** Can we agree not to change the contracts after 2026-10-18 so the final tests, `SECURITY.md` and the transaction-hash evidence match what is deployed?

## 4. `SECURITY.md` corrections I will send as a pull request

`SECURITY.md` (root) is a strong base. A review against the code and my audit found statements that are incomplete or too strong. I will propose edits, not rewrite it:

- Tier 1 approvals, owner mandates and the owner's `execute` call are not bound by the session caps; only the agent's three direct paths are.
- Key custody: the `BANK_ROLE` key and the arbiter key are held by the server like the owner key, and are not listed as risks.
- No production check compares the bank reserve with the token supply.
- Rate limiting is per server instance and trusts the forwarded IP header.
- The Run-attack route lets the caller pick the signing role.
- The mock-bank PIN lock can be raced by parallel requests; registration reveals whether a username exists.
- Test counts and the Slither result (22 results, none real) need updating.

The line-by-line fact check is done: see [SECURITY-CORRECTIONS.md](SECURITY-CORRECTIONS.md) for ready-to-paste replacements and new risk rows R12 to R17. Test count is 66 (39 / 16 / 11).

## 5. What I need from each of you

| Person | Need |
|---|---|
| @Qscawjds | Confirm what contract work is still planned, and your view on the timeout draft |
| @sucsage | Answers to section 3 (items 1 to 4); a heads-up before any further contract change |
| @NapatFoythong, @Gun-comp | Nothing for now |

Audit and Slither results: [AUDIT-2026-10-14.md](AUDIT-2026-10-14.md) (commit `9858229`) and [SLITHER.md](SLITHER.md).
