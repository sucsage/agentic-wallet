#!/usr/bin/env bash
# Deploys the shared contracts to Base Sepolia, funds the demo role keys with gas,
# and writes .secrets/vercel.env (all variables the web app needs, ready to paste into Vercel).
#
# Prerequisite: the OWNER address in .secrets/base-sepolia.env holds ~0.1 Base Sepolia ETH, and the
# file sets BANK_PRIVATE_KEY (the Mock Bank's minting key; a fresh key, not the owner's).
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; source .secrets/base-sepolia.env; set +a
RPC_URL="${RPC_URL:-https://sepolia.base.org}"

addr() { (cd web && node -e "import('viem/accounts').then(a=>console.log(a.privateKeyToAccount(process.argv[1]).address))" "$1"); }
BANK="$(addr "$BANK_PRIVATE_KEY")"
FUND="$(addr "$AGENT_PRIVATE_KEY"),$(addr "$CONTRACTOR_PRIVATE_KEY"),$BANK"

(cd contracts && BASE_SEPOLIA_RPC_URL="$RPC_URL" DEPLOYER_PRIVATE_KEY="$OWNER_PRIVATE_KEY" \
  BANK_ADDRESS="$BANK" FUND_ADDRESSES="$FUND" FUND_ETH="${FUND_ETH:-0.01}" \
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
MTHB_ADDRESS=$(j .contracts.MockTHB)
FILE_ESCROW_ADDRESS=$(j .contracts.FileEscrow)
START_BLOCK=$(j .startBlock)
ARBITER_ADDRESS=$ARBITER_ADDRESS
OWNER_PRIVATE_KEY=$OWNER_PRIVATE_KEY
AGENT_PRIVATE_KEY=$AGENT_PRIVATE_KEY
CONTRACTOR_PRIVATE_KEY=$CONTRACTOR_PRIVATE_KEY
BANK_PRIVATE_KEY=$BANK_PRIVATE_KEY
ENV
echo "Wrote .secrets/vercel.env. Add the LLM variables (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL) and DATABASE_URL/DIRECT_URL in Vercel yourself."
