#!/usr/bin/env bash
# Deploys the contracts to the private Besu chain (chain/docker-compose.yml must be running) and
# writes .secrets/besu.env with what the web app needs. Same role keys as Base Sepolia; no gas
# funding step, because gas is free on this chain.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; source .secrets/base-sepolia.env; set +a
RPC_URL=http://127.0.0.1:8555

addr() { (cd web && node -e "import('viem/accounts').then(a=>console.log(a.privateKeyToAccount(process.argv[1]).address))" "$1"); }
BANK="$(addr "$BANK_PRIVATE_KEY")"

(cd contracts && DEPLOYER_PRIVATE_KEY="$OWNER_PRIVATE_KEY" BANK_ADDRESS="$BANK" \
  npx hardhat run scripts/deploy.ts --network besu)

D=contracts/deployments/20261020.json
j() { node -e "console.log(require('./$D')$1)"; }
umask 077
cat > .secrets/besu.env <<ENV
CHAIN=besu
RPC_URL=$RPC_URL
USDC_ADDRESS=$(j .contracts.MockUSDC)
ESCROW_ADDRESS=$(j .contracts.MilestoneEscrow)
FACTORY_ADDRESS=$(j .contracts.AgentWalletFactory)
MTHB_ADDRESS=$(j .contracts.MockTHB)
FILE_ESCROW_ADDRESS=$(j .contracts.FileEscrow)
START_BLOCK=$(j .startBlock)
ARBITER_ADDRESS=$ARBITER_ADDRESS
ENV
echo "Wrote .secrets/besu.env (addresses only; the keys stay in .secrets/base-sepolia.env)."
