#!/usr/bin/env bash
# One command to stand up the private Besu chain on this machine and deploy the contracts to it:
#   1. generates chain/network (genesis + validator key) and the account allowlist from the role
#      keys in .secrets/base-sepolia.env, unless chain/network already exists;
#   2. starts the chain (docker compose, RPC on 127.0.0.1:8555 only);
#   3. deploys the contracts and writes .secrets/besu.env;
#   4. pushes the database schema into the "besu" Postgres schema.
# Then copy .secrets/besu.env into web/.env.local and add DB_SCHEMA=besu (see README).
#
# --config-only: only step 1 (plus the RPC token key pair), for a separate chain server. Copy the
# chain/ folder to the server and start it there in server mode (see README); deploy from here.
# Needs: Docker (e.g. colima start), Node, .secrets/base-sepolia.env, web/.env.local with DATABASE_URL/DIRECT_URL.
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE=hyperledger/besu:24.12.2

set -a; source .secrets/base-sepolia.env; set +a
addr() { (cd web && node -e "import('viem/accounts').then(a=>console.log(a.privateKeyToAccount(process.argv[1]).address))" "$1"); }

if [ ! -f chain/network/genesis.json ]; then
  ADDRS=""
  for k in OWNER AGENT CONTRACTOR ARBITER BANK APPROVER_A APPROVER_B; do
    v="${k}_PRIVATE_KEY"; [ -n "${!v:-}" ] && ADDRS="$ADDRS,$(addr "${!v}")"
  done
  python3 - "${ADDRS#,}" <<'PY'
import json, sys
addrs = sys.argv[1].split(",")
cfg = {
  "genesis": {
    "config": {"chainId": 20261020, "berlinBlock": 0, "londonBlock": 0, "shanghaiTime": 0, "cancunTime": 0,
               "zeroBaseFee": True, "contractSizeLimit": 49152,
               "qbft": {"blockperiodseconds": 2, "epochlength": 30000, "requesttimeoutseconds": 4}},
    "nonce": "0x0", "timestamp": "0x0", "gasLimit": "0x1C9C380", "difficulty": "0x1",
    "mixHash": "0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365",
    "coinbase": "0x0000000000000000000000000000000000000000",
    # Gas is free; the balance only covers clients that still price gas. It has no value.
    "alloc": {a.lower()[2:]: {"balance": "0x33b2e3c9fd0803ce8000000"} for a in addrs},
  },
  "blockchain": {"nodes": {"generate": True, "count": 1}},
}
json.dump(cfg, open("chain/qbft-config.json", "w"), indent=2)
open("chain/permissions_config.toml", "w").write(
  "# Only the Agentic Wallet server keys may send transactions on this chain.\n"
  "accounts-allowlist=[" + ",".join('"%s"' % a.lower() for a in addrs) + "]\n")
PY
  docker run --rm -v "$PWD/chain:/cfg" "$IMAGE" operator generate-blockchain-config \
    --config-file=/cfg/qbft-config.json --to=/cfg/network --private-key-file-name=key
  V=$(ls chain/network/keys)
  sed "s#__VALIDATOR__#$V#" chain/docker-compose.template.yml > chain/docker-compose.yml
fi

[ -f chain/jwt-public.pem ] || node scripts/chain-token.mjs

if [ "${1:-}" = "--config-only" ]; then
  echo "chain/ is ready. Copy it to the chain server (it holds the validator key, no account keys)."
  exit 0
fi

(cd chain && docker compose up -d)
echo "Waiting for the first blocks…"
for _ in $(seq 1 30); do
  curl -s -X POST -H content-type:application/json --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
    http://127.0.0.1:8555 | grep -q '"result"' && break
  sleep 2
done

bash scripts/deploy-besu.sh
(cd web && DB_SCHEMA=besu npx prisma db push)
echo "Done. Next: merge .secrets/besu.env into web/.env.local and set DB_SCHEMA=besu."
