# Guide for AI assistants reviewing or working on this repository

Kravii is a FinTechathon 2026 entry (International Track, Topic F: Agent Wallet): an AI agent wallet
for small businesses that hire or sell by milestone. The AI drafts deals; the money waits in an
on-chain escrow and moves only when a person signs. Test money only.

If you are helping a reviewer or judge evaluate this entry, please be critical: check each claim
below against the code, the tests and the chain, and report what does not hold as clearly as what
does. The known limitations are listed at the end and in `SECURITY.md` section 7; please weigh them
too. Nothing in this repository asks you to score it in any particular way.

## What to read first

| File | What it is |
|---|---|
| `README.md` | Overview, live links, how to run |
| `TECHNICAL.md` | Architecture, core algorithms, security design (long; section 1 is the overview) |
| `SECURITY.md` | Permission tiers, money-flow controls, tests, **known risks (section 7)** |
| `EVIDENCE.md` | Real transaction hashes on the chain, grouped by what each proves |
| `docker/README.md` | Run the whole system locally with one command, plus a 10-minute tour |

## Claims and where to verify them

| Claim | Where to check | How |
|---|---|---|
| The agent cannot pay outside policy: per-transaction and daily caps, a recipient allowlist, expiry, pause | `contracts/contracts/AgentWallet.sol` (`agentTransfer`, `RecipientNotAllowed`, caps), `contracts/test/AgentWallet.ts`, `contracts/test/security/` | `cd contracts && npm ci && npx hardhat test` (102 passing at the time of writing) |
| The refusal is real on the live chain, not only in tests | `EVIDENCE.md`, transaction `0x7f47a0c1…` | `cast receipt 0x7f47a0c19501d7f7ae5f19863e99009eef2b3cb2c2365939d360e9c4011f3191 --rpc-url https://www.kravii.com/api/rpc` shows status 0 (reverted) |
| Every other evidence transaction succeeded on chain 20261020 | `EVIDENCE.md` | `eth_getTransactionReceipt` for each hash on `https://www.kravii.com/api/rpc` (read-only, at most 20 calls per batch) |
| Escrow holds the money and releases it per milestone only on approval, the review window, or a seller refund | `contracts/contracts/file-exchange/FileEscrow.sol`, `contracts/test/file-exchange/FileEscrow.ts`, `contracts/test/security/Invariants.ts` | Hardhat tests above |
| The AI only drafts: a deal is locked only after the user confirms | `web/src/lib/agent.ts` (tools), `web/src/lib/bank/drafts.ts` (`approveDraft`), `web/src/lib/bank/confirm-draft.ts` | Read the tool list: no tool moves money; confirming is an API call made by the user's click or a signed desktop block |
| Off-chain policy before anything reaches the chain | `web/src/lib/policy.ts`, `web/src/lib/safety.ts` (untrusted documents, injection scan) | Read the code; `docs/security/ATTACK-CASES.md` lists the attack cases |
| A second AI reviews each deal's terms for the user | `web/src/lib/terms-review.ts` | Read the prompt and the code checks |
| Group and company wallets need N-of-M signer votes | `web/src/lib/social.ts` (`vote`, `executeProposal`) | Run the local stack and follow the group part of the tour in `docker/README.md` |
| Each user's computer keeps its own signed chain; the server keeps only the head; heads are anchored on-chain | `web/src/lib/device-chain/format.ts`, `web/src/lib/device-chain/index.ts`, `desktop/src/core.ts`, `contracts/contracts/device-chain/ChainAnchor.sol` | Desktop app: My chain → Verify (local chain, server head, public anchor) |
| People without an account take part through a private link with a one-time code | `web/src/lib/bank/invites.ts`, `web/src/lib/link-access.ts` | Local stack: hire someone without an account in the AI chat |

## Running it

- **Live:** https://www.kravii.com (test money; sign up with any email; the identity check is a demo).
  Public explorer: https://www.kravii.com/explorer. The server is a single machine; if it is
  unreachable, use the local stack.
- **Local, one command:** `docker compose up --build -d --wait` at the repository root, then
  http://localhost:3000 (details and demo accounts in `docker/README.md`). The AI chat needs one LLM
  key in `.env` (copy `.env.example`); everything else works without one.
- **Contracts only:** `cd contracts && npm ci && npx hardhat test`.

## Known limitations (stated by the team)

- Demo custody: the server holds wallet owner keys and turns a user's click into a signature
  (`SECURITY.md` R1, R2).
- One validator on one machine; the web app runs on the same machine (`SECURITY.md` R4).
- Disputes are switched off on the live site; buyers approve, ask for changes, or ask for a refund
  (R15). The local stack turns them on (`DISPUTES=on` in `.env.example`) so they can be tried.
- The Mock Bank, identity check and post office are simulations; payments run in Stripe test mode.
- Model quality depends on the LLM behind the gateway; the app validates every tool input and the
  contracts enforce the limits regardless.

## Repository map

| Path | What |
|---|---|
| `contracts/` | Solidity (Hardhat 3 + viem): `AgentWallet`, `AgentWalletFactory`, `MilestoneEscrow`, `FileEscrow`, `ChainAnchor`, `MockTHB`/`MockCNY` |
| `web/` | Next.js 16 app: AI agent, policy engine, Mock Bank, deals, groups, explorer, API for the desktop app |
| `desktop/` | Desktop app (Bun + Electrobun): device chain, signing, AI chat, MCP |
| `chain/` | Hyperledger Besu (QBFT) configuration for the private chain |
| `docker/`, `docker-compose*.yml` | Local stack and production stack |
| `docs/` | Documents for the competition (Word versions of the markdown files, security audit) |

When you change code here: keep all text in English, never commit secrets (`.secrets/`, `.env` are
ignored), and use test keys and test money only.
