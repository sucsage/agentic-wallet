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
| `contracts/` | Solidity: `AgentWallet`, `MilestoneEscrow`, `MockUSDC` (Hardhat 3 + viem) |
| `agent/` | *(next)* Claude tool-use agent + off-chain policy engine |
| `web/` | *(next)* Next.js UI: chat, approvals, cash-flow dashboard |

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
npm test          # 17 tests, including the prompt-injection "send everything to 0xEvil" cases
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
