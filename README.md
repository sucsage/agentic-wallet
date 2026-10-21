# Agentic Wallet

An AI agent that runs its own on-chain wallet and pays SME contractors milestone by milestone
(deposit → delivery → FAT → SAT → retention). The agent never holds the owner key. It gets a scoped,
expiring session key, and the smart contract enforces every rule, so a manipulated or hallucinating
agent still cannot move funds outside policy.

Built for the 2026 Shenzhen International FinTech Competition (FinTechathon), International Track,
Topic F: Agent Wallet.

## For reviewers

| | |
|---|---|
| Live app | https://www.kravii.com (sign up with email, demo KYC approves at once, test money only) |
| Public chain explorer (no sign-in) | https://www.kravii.com/explorer |
| Read-only JSON-RPC (chain id 20261020) | `https://www.kravii.com/api/rpc` |
| Transaction hashes, grouped by what they prove | [EVIDENCE.md](EVIDENCE.md) |
| Technical documentation (architecture, core algorithms, security design) | [TECHNICAL.md](TECHNICAL.md) |
| Security self-assessment (permission tiers, known risks) | [SECURITY.md](SECURITY.md) |

Our chain is a private, permissioned Hyperledger Besu network: only the app's keys can **write**, but
anyone can **read**. To check a transaction hash yourself, without trusting our explorer:

```bash
cast receipt <tx hash> --rpc-url https://www.kravii.com/api/rpc
```

`cd web && npx tsx --conditions=react-server --env-file=.env.local scripts/evidence.mts` regenerates
EVIDENCE.md from the live chain.

## Layout

| Path | What |
|---|---|
| `contracts/` | Solidity: `AgentWallet`, `AgentWalletFactory`, `MilestoneEscrow`, `MockUSDC` (Hardhat 3 + viem) |
| `web/` | Next.js 16 app on Vercel: landing page, per-visitor sandbox, agent chat, approvals, deals, audit log |
| `desktop/` | Desktop app (Bun, one executable per OS): each user's own deal chain on their computer, linked to the other party's and anchored on-chain (`desktop/README.md`) |
| `web/src/lib/agent.ts` | LLM tool-use loop (any Anthropic-compatible API: PSU gateway, OpenRouter, Anthropic): 7 validated tools, untrusted-document handling |
| `web/src/lib/policy.ts` | Guard #1: off-chain policy engine (tier routing, injection scan) |
| `web/src/lib/actions.ts` | Every on-chain action, shared by the agent's tools and the UI |
| `scripts/deploy-base-sepolia.sh` | One-command testnet deploy + gas funding + Vercel env file |

## Architecture

```
Visitor ──► Next.js (Vercel) ──► Claude agent ──► Guard 1: policy engine ──► Guard 2: AgentWallet ──► MilestoneEscrow
              │  chat, approvals,     tools          tier routing, caps,          on-chain caps,           evidence hash,
              │  deals, audit         (7)            allowlist, injection scan     allowlists, N-of-M       release, dispute
              └─► "Launch sandbox" ──► AgentWalletFactory: one tx = configured wallet + 10,000 mUSDC
```

The chain is the only database: deal terms and evidence ride on-chain as `data:` URIs, and the
audit log is read from contract events. Each visitor gets an isolated wallet, so judges can't
interfere with each other.

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

## Run locally

```bash
cd contracts && npm install && npx hardhat node          # terminal 1: local chain
cd contracts && npx hardhat run scripts/deploy.ts --network localhost
cd web && npm install && cp .env.example .env.local      # fill addresses + Hardhat test keys
npm run dev                                              # http://localhost:3000
npm run e2e                                              # backend end-to-end flow against the chain
```

The chat agent needs one LLM provider: `LLM_BASE_URL` + `LLM_API_KEY` (any Anthropic-compatible gateway; default model `openai/gpt-6-luna`), `OPENROUTER_API_KEY`, or `ANTHROPIC_API_KEY`. Every other button works without one.

`npm run agent-eval` grades the live agent on the demo's decision points (deal setup, autonomous payments, over-cap approval, refusing an incomplete SAT, phishing). With the PSU gateway, `openai/gpt-6-luna`, `deepseek/deepseek-v4.1-flash` and `qwen/qwen3.7-plus` all scored 8/8; gpt-6-luna did so 3/3 runs at ~35 s.

## Deploy (Base Sepolia + Vercel)

1. Fund the `OWNER` address from `.secrets/base-sepolia.env` with ~0.08 Base Sepolia ETH (any faucet).
2. `./scripts/deploy-base-sepolia.sh`: deploys contracts, funds the other role keys, writes `.secrets/vercel.env`.
3. Import the repo in Vercel with root directory `web/`, then paste `.secrets/vercel.env` plus the LLM variables (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`).

## Private chain (Hyperledger Besu) — permissioned writes, public reads

The app runs on its own permissioned chain instead of a public testnet: QBFT, chain id 20261020,
free gas, and an **account allowlist** so only the app's keys can send transactions. Reading is
public: the app's explorer at `/explorer` and read-only JSON-RPC at `/api/rpc` (no sign-in).
App data for this chain lives in the `besu` Postgres schema (`DB_SCHEMA=besu`), apart from the
Base Sepolia data in `public`.

```
Vercel (web + signing keys) ──HTTPS + Bearer JWT──▶ Tailscale Funnel ──▶ Besu   (chain server, e.g. a home PC)
```

Besu checks a bearer JWT on every RPC call itself (no proxy): no token or a bad one gets 401. The
token is issued on the dev machine (`node scripts/chain-token.mjs [days]`, private key in `.secrets/`,
public key in `chain/jwt-public.pem`). The chain server holds only the validator key and that public key.

**Chain server on a home PC (Windows, no domain, no public IP)**:

1. Install Docker Desktop (WSL 2) and Tailscale; set Windows sleep to *Never* and let both start at
   sign-in.
2. On the dev machine: `bash scripts/setup-besu.sh --config-only` (genesis, validator key, allowlist,
   JWT key pair and `.secrets/chain-token.txt`). Copy the `chain/` folder to the PC.
3. On the PC, in PowerShell, in `chain/`:
   `docker compose -f docker-compose.yml -f docker-compose.server.yml up -d`, then
   `tailscale funnel --bg 8555` for a fixed public HTTPS URL `https://<pc>.<tailnet>.ts.net`.
4. From the dev machine:
   `BESU_RPC_URL=https://<pc>.<tailnet>.ts.net CHAIN_TOKEN=$(cat .secrets/chain-token.txt) bash scripts/deploy-besu.sh`
   and `cd web && DB_SCHEMA=besu npx prisma db push`.

The chain is only up while the PC is: keep it powered and online during the review and the final,
and keep the Base Sepolia deployment as a fallback. Tokens expire (default 90 days); issue a new one
with `node scripts/chain-token.mjs` and update Vercel.

**Vercel env**: the values from `.secrets/besu.env`, plus `RPC_URL=https://<pc>.<tailnet>.ts.net`,
`CHAIN_TOKEN=<contents of .secrets/chain-token.txt>`, `DB_SCHEMA=besu` and the usual keys, database
and LLM settings.

**All on one machine** (development): `bash scripts/setup-besu.sh` starts the chain with its RPC on
127.0.0.1:8555, deploys and pushes the schema; merge `.secrets/besu.env` into `web/.env.local` and
add `DB_SCHEMA=besu`. Stop with `cd chain && docker compose down` (`down -v` wipes the chain).

## Contracts

```bash
cd contracts
npm install
npm test          # 101 tests, including the prompt-injection "send everything to 0xEvil" cases
```

Deploy to Base Sepolia (testnet keys only):

```bash
npx hardhat keystore set BASE_SEPOLIA_RPC_URL
npx hardhat keystore set DEPLOYER_PRIVATE_KEY
AGENT_ADDRESS=0x... APPROVERS=0x...,0x... CONTRACTOR=0x... \
  npx hardhat run scripts/deploy.ts --network baseSepolia
```

## Live on Base Sepolia (chain 84532)

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

Third-party services used in test mode only: Vercel (hosting), Neon (PostgreSQL), Stripe (test-mode payments), GitHub Actions and Releases (desktop builds), Tailscale Funnel (access to the chain server). The Mock Bank, mock ThaID and mock 国家网络身份认证, Mock Post and the AI arbiter flow are the team's own simulations; they do not imitate any real institution's branding.

**AI in the product.** The wallet's assistant, the terms review and the dispute arbiter call large language models through the Anthropic Messages API (Anthropic, OpenRouter or a university LLM gateway; users may bring their own key). The models only draft and advise: every payment needs the user's signed approval, and on-chain policy (caps, recipient allowlist, N-of-M approval) is enforced by the contracts, not by the model.

**AI assistance in development.** The team used AI coding assistants (Anthropic's Claude) to help write and review code, tests and documentation. The team chose the problem, designed the system and its security model, reviewed and tested the output, and made every product and architecture decision.
