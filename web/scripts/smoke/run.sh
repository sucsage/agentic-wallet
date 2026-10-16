#!/usr/bin/env bash
# Smoke test: the app's main money flow on a throwaway local stack.
#   cd web && npm run smoke
# Starts a Hardhat node (8545), a Postgres container (55433) and the dev server (3000), runs smoke.mts,
# and ALWAYS tears everything down, even when a step fails. Only Hardhat's public test keys are used.
set -uo pipefail

WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="$(cd "$WEB/.." && pwd)"
WORK="$(mktemp -d /tmp/aw-smoke.XXXXXX)"
DB=aw-smoke-pg
PIDS=()

log() { printf '[smoke] %s\n' "$*"; }

cleanup() {
  trap - EXIT INT TERM
  log "tearing down"
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill -TERM -- "-$pid" 2>/dev/null
  done
  sleep 1
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill -KILL -- "-$pid" 2>/dev/null
  done
  docker rm -f "$DB" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

need() { command -v "$1" >/dev/null 2>&1 || { log "missing tool: $1"; exit 2; }; }
need docker; need node; need npx; need rsync; need python3; need curl; need ss

for port in 8545 3000 55433; do
  if ss -ltn "sport = :$port" | grep -q LISTEN; then
    log "port $port is busy; stop whatever uses it and run again"
    exit 2
  fi
done
if docker ps -a --format '{{.Names}}' | grep -qx "$DB"; then
  log "container $DB already exists; remove it (docker rm -f $DB) and run again"
  exit 2
fi

# Start a command in its own process group (so teardown can kill the whole tree; never pkill -f).
# Runs in this shell, not a subshell, so the PID is remembered. Usage: spawn <dir> <logfile> <command...>
spawn() {
  local dir="$1" out="$2" here="$PWD"; shift 2
  cd "$dir" || return 1
  setsid "$@" >"$out" 2>&1 &
  PIDS+=("$!")
  cd "$here" || return 1
}

wait_for() { # description, attempts, command...
  local what="$1" tries="$2"; shift 2
  for _ in $(seq 1 "$tries"); do "$@" >/dev/null 2>&1 && return 0; sleep 2; done
  log "timed out waiting for $what"; return 1
}

# ---- 1. chain ------------------------------------------------------------------------------
log "starting Hardhat node"
spawn "$ROOT/contracts" "$WORK/hardhat.log" npx hardhat node || exit 1
wait_for "the chain" 30 curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545 || { tail -5 "$WORK/hardhat.log"; exit 1; }

log "deploying contracts"
( cd "$ROOT/contracts" \
  && BANK_ADDRESS=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 \
     FUND_ADDRESSES=0x70997970C51812dc3A010C7d01b50e0d17dc79C8,0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 \
     npx hardhat run scripts/deploy.ts --network localhost >"$WORK/deploy.log" 2>&1 ) || { tail -15 "$WORK/deploy.log"; exit 1; }
DEPLOY="$ROOT/contracts/deployments/31337.json"
addr() { python3 -c "import json,sys; print(json.load(open('$DEPLOY'))['contracts'][sys.argv[1]])" "$1"; }

# ---- 2. database ---------------------------------------------------------------------------
log "starting Postgres ($DB on 55433)"
docker run -d --name "$DB" -e POSTGRES_PASSWORD=awsmoke -e POSTGRES_DB=awsmoke -p 127.0.0.1:55433:5432 postgres:16-alpine >/dev/null || exit 1
wait_for "Postgres" 30 docker exec "$DB" pg_isready -U postgres -d awsmoke || exit 1
sleep 2

# ---- 3. app (a copy, so the shared checkout stays untouched) --------------------------------
cat >"$WORK/env.sh" <<ENV
export CHAIN=hardhat RPC_URL=http://127.0.0.1:8545
export USDC_ADDRESS=$(addr MockUSDC) ESCROW_ADDRESS=$(addr MilestoneEscrow) FACTORY_ADDRESS=$(addr AgentWalletFactory)
export MTHB_ADDRESS=$(addr MockTHB) MCNY_ADDRESS=$(addr MockCNY) FILE_ESCROW_ADDRESS=$(addr FileEscrow)
export ARBITER_ADDRESS=0x90F79bf6EB2c4f870365E785982E1f101E93b906
# Hardhat's well-known public test keys #0-#4. Local chain only; never use them anywhere else.
export OWNER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export AGENT_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export CONTRACTOR_PRIVATE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
export ARBITER_PRIVATE_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
export BANK_PRIVATE_KEY=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
export DATABASE_URL=postgresql://postgres:awsmoke@127.0.0.1:55433/awsmoke DIRECT_URL=postgresql://postgres:awsmoke@127.0.0.1:55433/awsmoke
export BETTER_AUTH_SECRET=smoke-secret-not-for-anything-else-0123456789 BETTER_AUTH_URL=http://localhost:3000
export MOCK_IDP_SECRET=smoke-idp-secret-0123456789 KYC_AUTO_APPROVE=true
export SMOKE_DB_CONTAINER=$DB
ENV
# shellcheck disable=SC1091
source "$WORK/env.sh"

log "copying the app and preparing it"
rsync -a --exclude node_modules --exclude .next --exclude '.env*' "$WEB/" "$WORK/web/" || exit 1
ln -s "$WEB/node_modules" "$WORK/web/node_modules"   # webpack follows it; turbopack does not
( cd "$WORK/web" && npx prisma generate >"$WORK/prisma.log" 2>&1 && npx prisma db push >>"$WORK/prisma.log" 2>&1 ) || { tail -10 "$WORK/prisma.log"; exit 1; }

log "starting the dev server (3000)"
spawn "$WORK/web" "$WORK/next.log" npx next dev --webpack -p 3000 || exit 1
wait_for "the app" 60 curl -sf -m 20 http://localhost:3000/api/auth/ok || { tail -15 "$WORK/next.log"; exit 1; }

# ---- 4. the test ---------------------------------------------------------------------------
log "running the checks"
( cd "$WORK/web" && npx tsx --conditions=react-server scripts/smoke/smoke.mts )
status=$?
if [ "$status" -ne 0 ]; then
  log "FAILED (exit $status). Last lines of the app log:"
  tail -n 15 "$WORK/next.log"
fi
exit "$status"
