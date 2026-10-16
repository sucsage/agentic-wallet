# Smoke test

`npm run smoke` runs the app's main money flow on a throwaway local stack and removes it afterwards.

- Needs: Docker, Node, rsync, curl, python3. Free ports: 8545 (Hardhat), 3000 (app), 55433 (Postgres container `aw-smoke-pg`).
- It starts a Hardhat node, deploys the contracts, starts Postgres, copies `web/` to a temp dir and runs the dev server there. The shared checkout is not touched.
- The flow: a company with two signers and one non-signer receives a seller's offer; the non-signer and an outsider are refused; a signer accepts and pays; the seller delivers; a signer approves; the seller is paid; a settled milestone refuses every further move.
- Output is PASS/FAIL per check; exit code 1 if any fails. Takes about 3 to 5 minutes.
- Only Hardhat's public test keys are used. Nothing leaves the machine.
