#!/usr/bin/env bash
# Deploys the shared contracts to Base Sepolia, funds the demo role keys with gas,
# and writes .secrets/vercel.env (all variables the web app needs, ready to paste into Vercel).
#
# Prerequisite: the OWNER address in .secrets/base-sepolia.env holds ~0.08 Base Sepolia ETH.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; source .secrets/base-sepolia.env; set +a
RPC_URL="${RPC_URL:-https://sepolia.base.org}"

addr() { (cd web && node -e "import('viem/accounts').then(a=>console.log(a.privateKeyToAccount(process.argv[1]).address))" "$1"); }
FUND="$(addr "$AGENT_PRIVATE_KEY"),$(addr "$APPROVER_A_PRIVATE_KEY"),$(addr "$APPROVER_B_PRIVATE_KEY"),$(addr "$CONTRACTOR_PRIVATE_KEY")"

(cd contracts && BASE_SEPOLIA_RPC_URL="$RPC_URL" DEPLOYER_PRIVATE_KEY="$OWNER_PRIVATE_KEY" \
  FUND_ADDRESSES="$FUND" FUND_ETH="${FUND_ETH:-0.01}" \
  npx hardhat run scripts/deploy.ts --network baseSepolia)

D=contracts/deployments/84532.json
j() { node -e "console.log(require('./$D')$1)"; }
umask 077
cat > .secrets/vercel.env <<ENV
CHAIN=baseSepolia
RPC_URL=$RPC_URL
USDC_ADDRESS=$(j .contracts.MockUSDC)
ESCROW_ADDRESS=$(j .contracts.MilestoneEscrow)
FACTORY_ADDRESS=$(j .contracts.AgentWalletFactory)
START_BLOCK=$(j .startBlock)
OWNER_PRIVATE_KEY=$OWNER_PRIVATE_KEY
AGENT_PRIVATE_KEY=$AGENT_PRIVATE_KEY
APPROVER_A_PRIVATE_KEY=$APPROVER_A_PRIVATE_KEY
APPROVER_B_PRIVATE_KEY=$APPROVER_B_PRIVATE_KEY
CONTRACTOR_PRIVATE_KEY=$CONTRACTOR_PRIVATE_KEY
ENV
echo "Wrote .secrets/vercel.env. Add ANTHROPIC_API_KEY in Vercel yourself."
