#!/bin/sh
# Local stack: loads the contract addresses written by the deployer. Production: no deployer, the
# addresses come from the environment. Then creates the schema and starts the app.
set -eu
if [ -f /shared/contracts.env ]; then
  set -a
  . /shared/contracts.env
  set +a
fi
if [ "${DB_PUSH:-true}" = "true" ]; then
  echo "[web] pushing the database schema"
  npx prisma db push
fi
echo "[web] starting on :3000"
exec npx next start -p 3000
