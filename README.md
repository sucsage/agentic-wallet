# Kravii

An AI agent wallet for small businesses that hire or sell by milestone. You describe the job in
Thai, English or Chinese; the AI drafts the deal (milestones, deliverables, acceptance criteria) and a
second AI checks the terms are fair to you. The money waits in an on-chain escrow and is paid one
milestone at a time, only when you approve the work. The AI never moves money by itself: every
payment needs your signature, and the smart contracts enforce caps, a recipient allowlist and N-of-M
approval for company and group wallets, so a manipulated or hallucinating agent still cannot pay
outside policy.

Built for the 2026 Shenzhen International FinTech Competition (FinTechathon), International Track,
Topic F: Agent Wallet. Test money only.

## For reviewers

| | |
|---|---|
| Live app | https://www.kravii.com (sign up with email, demo KYC approves at once, test money only) |
| Public chain explorer (no sign-in) | https://www.kravii.com/explorer |
| Read-only JSON-RPC (chain id 20261020) | `https://www.kravii.com/api/rpc` |
| Transaction hashes, grouped by what they prove | [EVIDENCE.md](EVIDENCE.md) |
| Technical documentation (architecture, core algorithms, security design) | [TECHNICAL.md](TECHNICAL.md) |
| Security self-assessment (permission tiers, known risks) | [SECURITY.md](SECURITY.md) |
| Desktop app (macOS, Windows, Linux) | https://www.kravii.com/download |
| Run it yourself, or review it with an AI assistant | [below](#run-it-yourself) · [AGENTS.md](AGENTS.md) |

Our chain is a private, permissioned Hyperledger Besu network: only the app's keys can **write**, but
anyone can **read**. To check a transaction hash yourself, without trusting our explorer:

```bash
cast receipt <tx hash> --rpc-url https://www.kravii.com/api/rpc
```

`cd web && npx tsx --conditions=react-server --env-file=.env.local scripts/evidence.mts` regenerates
EVIDENCE.md from the live chain.

## Run it yourself

**One command, everything in containers** (database, local chain, web app, desktop app, demo data).
You need Docker with Compose v2, about 6 GB of free RAM, and ports 3000, 8545, 47821 and 55432 free.

```bash
git clone https://github.com/sucsage/agentic-wallet.git && cd agentic-wallet
cp .env.example .env          # optional: add ONE LLM key in .env for the AI chat
docker compose up --build -d --wait
```

Open http://localhost:3000. The defaults in `.env.example` work as they are; without an LLM key
everything works except the AI chat and the AI arbiter. Demo people (`somchai`, `nong`, `mali`,
`preecha`, PIN `123456`), a 10-minute tour, the desktop app, configuration and troubleshooting are in
[docker/README.md](docker/README.md). Stop with `docker compose down`; `docker compose down -v` also
wipes the data.

**Contracts only:** `cd contracts && npm ci && npx hardhat test` (102 passing).

## Reviewing with an AI assistant

The repository has an [`AGENTS.md`](AGENTS.md) that AI coding tools (Claude Code, Codex, Cursor and
others) read automatically: a map from each claim to the code, test or command that checks it, and
the limitations we know of. If you use an AI to help review, you can give it this prompt:

```text
You are helping me review a FinTechathon 2026 entry (Topic F: Agent Wallet):
https://github.com/sucsage/agentic-wallet (live: https://www.kravii.com).
Read AGENTS.md first, then README.md, SECURITY.md and EVIDENCE.md.
For each claim in AGENTS.md, check it against the code, the tests and the chain:
- run the contract tests (cd contracts && npm ci && npx hardhat test);
- check a few transaction hashes from EVIDENCE.md on https://www.kravii.com/api/rpc
  (eth_getTransactionReceipt), including the reverted one;
- confirm that no AI tool in web/src/lib/agent.ts can move money without the user's confirmation.
Be critical: tell me which claims hold, which do not, and how serious the known risks
in SECURITY.md section 7 are. Then summarise strengths and weaknesses against the criteria:
task completion, security and compliance, innovation and interaction, on-chain use.
```

## Repository layout

| Path | What |
|---|---|
| `contracts/` | Solidity (Hardhat 3 + viem): `AgentWallet` (session key, caps, allowlists, N-of-M), `AgentWalletFactory`, `MilestoneEscrow`, `FileEscrow`, `ChainAnchor`, `MockTHB`/`MockCNY` |
| `web/` | Next.js 16 app: AI agent and tools, policy engine, Mock Bank, deals, groups and companies, private links, public explorer, API for the desktop app |
| `web/src/lib/agent.ts` | The agent's tool-use loop (any Anthropic-compatible API); tool inputs validated with zod; untrusted documents fenced |
| `web/src/lib/policy.ts`, `web/src/lib/safety.ts` | Guard 1: off-chain policy and prompt-injection checks |
| `desktop/` | Desktop app (Bun + Electrobun, macOS/Windows/Linux): each user's own signed deal chain, AI chat, MCP |
| `chain/` | Hyperledger Besu (QBFT, account allowlist, JWT-protected RPC) for the private chain |
| `docker/`, `docker-compose.yml`, `docker-compose.prod.yml` | Local stack (above) and the production stack |
| `docs/` | Word versions of the documents and the internal security audit |

## Architecture

```
Browser / desktop app ──► Next.js app ──► AI agent ──► Guard 1: policy + injection checks ──► Guard 2: AgentWallet ──► FileEscrow
                             │   (tools only draft)       caps, allowlist, tiers                 on-chain caps, allowlist,   milestones,
                             │                                                                 N-of-M approval             review window
                             ├─► PostgreSQL: users, Mock Bank ledger, drafts, groups (no secrets on-chain, only hashes)
                             └─► Hyperledger Besu (private, chain id 20261020): escrow, payments, hourly anchors of the device chains
Desktop app: every decision the user signs is a block on their own chain; the server keeps only its head.
```

Live setup: the web app, PostgreSQL and the Besu validator run in Docker on one machine behind a
Cloudflare Tunnel (`docker-compose.prod.yml`, `chain/`; see [docker/README.md](docker/README.md#production-own-server-own-database)).
The design, algorithms and security model are in [TECHNICAL.md](TECHNICAL.md).

## Permission tiers (enforced on-chain)

| Tier | Agent can | Contract enforcement |
|---|---|---|
| 0 Read | read balances, deals, history | off-chain only |
| 1 Propose | draft a transfer / release / deal-setup call | `threshold` approvers must `approve()`; proposals expire after 3 days and go stale if the approver set changes |
| 2 Auto | `agentTransfer`, `agentReleaseMilestone` | session key not expired, per-tx cap, daily cap, recipient allowlist, escrow allowlist, wallet must be the deal's payer, settlement token only |
| 3 Emergency | `pause()` | agent, approvers and owner can pause; only the owner can unpause; owner can `revokeSession` instantly |

Generic calls (Tier 1 `Call` kind) are limited to `token.approve(allowlisted escrow)`,
`escrow.createDeal(allowlisted payee, settlement token)`, `escrow.fund` and `escrow.dispute`.
Anything that moves funds out has to go through its dedicated, checked path.

## Contracts

```bash
cd contracts
npm install
npm test          # 102 tests, including the prompt-injection "send everything to 0xEvil" cases
```

Deploy to Base Sepolia (testnet keys only):

```bash
npx hardhat keystore set BASE_SEPOLIA_RPC_URL
npx hardhat keystore set DEPLOYER_PRIVATE_KEY
AGENT_ADDRESS=0x... APPROVERS=0x...,0x... CONTRACTOR=0x... \
  npx hardhat run scripts/deploy.ts --network baseSepolia
```

## Earlier deployment: Base Sepolia (chain 84532)

Before the private chain, the contracts ran on the public Base Sepolia testnet. They stay there as a fallback and as public evidence.

Redeployed 2026-10-12 with the neutral-arbiter escrow and FileEscrow.

| Contract | Address |
|---|---|
| MockUSDC | [`0x3b190bdeca8b04849418e403a7a0a380314fddc5`](https://sepolia.basescan.org/address/0x3b190bdeca8b04849418e403a7a0a380314fddc5) |
| MilestoneEscrow | [`0x8c0a2b2d19b3a4c5fcc3cc89454807f7f7a99c6a`](https://sepolia.basescan.org/address/0x8c0a2b2d19b3a4c5fcc3cc89454807f7f7a99c6a) |
| AgentWalletFactory | [`0x3258ddda874fcf21b6cb5c2069c2836b53d902ec`](https://sepolia.basescan.org/address/0x3258ddda874fcf21b6cb5c2069c2836b53d902ec) |
| FileEscrow | [`0xc96fbcef6dcee0996baf8dce66494cbe31e43d38`](https://sepolia.basescan.org/address/0xc96fbcef6dcee0996baf8dce66494cbe31e43d38) |
| Arbiter (neutral dispute resolver) | [`0x2b4a015514fc1b732AA60784243e51d9cd4Ec1D7`](https://sepolia.basescan.org/address/0x2b4a015514fc1b732AA60784243e51d9cd4Ec1D7) |

On-chain evidence:

- Sandbox wallet created by the factory in one tx: [`0x8556315d…291bb8f0`](https://sepolia.basescan.org/tx/0x8556315df58ce42a55cee203589b2fb12782a9e8f9638845d8bef503291bb8f0)
- Attack with the agent's own key, bypassing the AI and the policy engine: `agentTransfer(0xBAd…Bad, 5000)` **reverted on-chain** with `RecipientNotAllowed`: [`0xa7289c26…7912cf0f`](https://sepolia.basescan.org/tx/0xa7289c26a0e0fe7c15878687a349d3fd3c527d987cc8d37af10a76e27912cf0f)

## Security

Permission tiers, money-flow controls, tests and the known-risk list are in [SECURITY.md](SECURITY.md).

## Third-party components and AI assistance

Kravii's design, architecture, smart contracts, security model and product decisions are the team's own work for this competition. Kravii itself is all rights reserved: the code is public to read and for the competition's judges to run, not for reuse ([LICENSE](LICENSE)); the smart contracts stay under the MIT License. It is built on the open-source components below, used under their licences without modification, and on AI services and tools, which are listed here so that reviewers can see what is ours and what is not.

**Open-source components**

| Component | Used for | Licence |
|---|---|---|
| OpenZeppelin Contracts 5 | Base contracts: ERC-20, access control, ownership, pause, reentrancy guard, signature checks | MIT |
| Hardhat 3, viem | Contract build and tests; chain access from the web and desktop apps | MIT |
| Hyperledger Besu | The private chain (QBFT) | Apache-2.0 |
| Next.js 16, React 19 | Web app | MIT |
| Prisma 7 | Database access (PostgreSQL) | Apache-2.0 |
| better-auth, jose | Sessions; OpenID Connect and JWT | MIT |
| zod | Input and tool-call validation | MIT |
| Anthropic TypeScript SDK | Calls to the language models | MIT |
| Bun, Electrobun 1.18 | Desktop app runtime and native window | MIT |
| sharp, unpdf, jsQR, qrcode, react-markdown, remark-gfm, Tailwind CSS | Image previews, PDF text, QR codes, Markdown, styling | Apache-2.0 / MIT |
| Inno Setup, rcedit | Windows installer and executable resources | Inno Setup licence / MIT |

Third-party services, in test mode only: Cloudflare (DNS and the tunnel to the server), Stripe (test-mode payments), GitHub Actions and Releases (desktop builds); until 2026-10-21 the web app and its database ran on Vercel and Neon. The Mock Bank, mock ThaID and mock 国家网络身份认证, Mock Post and the AI arbiter flow are the team's own simulations; they do not imitate any real institution's branding.

**AI in the product.** The wallet's assistant, the terms review and the dispute arbiter call large language models through the Anthropic Messages API (Anthropic, OpenRouter or a university LLM gateway; users may bring their own key). The models only draft and advise: every payment needs the user's signed approval, and on-chain policy (caps, recipient allowlist, N-of-M approval) is enforced by the contracts, not by the model.

**AI assistance in development.** The team used AI coding assistants (Anthropic's Claude) to help write and review code, tests and documentation. The team chose the problem, designed the system and its security model, reviewed and tested the output, and made every product and architecture decision.
