# Agentic Wallet

An AI agent that runs its own on-chain wallet and pays SME contractors milestone by milestone
(deposit → delivery → FAT → SAT → retention). The agent never holds the owner key. It gets a scoped,
expiring session key, and the smart contract enforces every rule, so a manipulated or hallucinating
agent still cannot move funds outside policy.

Built for the 2026 Shenzhen International FinTech Competition (FinTechathon), International Track,
Topic F: Agent Wallet.

## Layout

| Path | What |
|---|---|
| `contracts/` | Solidity: `AgentWallet`, `AgentWalletFactory`, `MilestoneEscrow`, `MockUSDC` (Hardhat 3 + viem) |
| `web/` | Next.js 16 app on Vercel: landing page, per-visitor sandbox, agent chat, approvals, deals, audit log |
| `web/src/lib/agent.ts` | Claude (`claude-opus-5-5`) tool-use loop: 7 tools, untrusted-document handling |
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

`ANTHROPIC_API_KEY` is only needed for the chat agent; every other button works without it.

## Deploy (Base Sepolia + Vercel)

1. Fund the `OWNER` address from `.secrets/base-sepolia.env` with ~0.08 Base Sepolia ETH (any faucet).
2. `./scripts/deploy-base-sepolia.sh`: deploys contracts, funds the other role keys, writes `.secrets/vercel.env`.
3. Import the repo in Vercel with root directory `web/`, paste `.secrets/vercel.env` plus `ANTHROPIC_API_KEY`.

## Contracts

```bash
cd contracts
npm install
npm test          # 19 tests, including the prompt-injection "send everything to 0xEvil" cases
```

Deploy to Base Sepolia (testnet keys only):

```bash
npx hardhat keystore set BASE_SEPOLIA_RPC_URL
npx hardhat keystore set DEPLOYER_PRIVATE_KEY
AGENT_ADDRESS=0x... APPROVERS=0x...,0x... CONTRACTOR=0x... \
  npx hardhat run scripts/deploy.ts --network baseSepolia
```

## Known risks (draft for the security self-assessment)

1. **Prompt injection** through documents → policy is enforced on-chain; malicious recipients revert (tested).
2. **Hallucinated address or amount** → recipient allowlist; milestone amounts are read from the escrow, not from the agent.
3. **Session key leak** → per-tx and daily caps, expiry, instant revoke, pause.
4. **Owner key compromise** → the owner has an unrestricted `execute`; it should be a hardware wallet or a Safe.
5. **Contract bugs** → OpenZeppelin primitives, ReentrancyGuard, tests; Slither still to run.
6. **Compliance** → only KYC'd counterparties get allowlisted; every action emits an event as an audit trail.
