# Slither static analysis

Target: commit `9858229`, contracts under `contracts/contracts/` (OpenZeppelin and tests excluded).
Tool: Slither 0.11.6, solc 0.8.28 (optimizer 200, as in `hardhat.config.ts`). 102 detectors, 22 results.

## Reproduce

```bash
python3 -m venv ~/.venvs/slither && ~/.venvs/slither/bin/pip install slither-analyzer solc-select
export PATH=$HOME/.venvs/slither/bin:$PATH
solc-select install 0.8.28 && solc-select use 0.8.28
cd contracts && npm ci && npx hardhat build
slither . --compile-force-framework hardhat --hardhat-ignore-compile --filter-paths "node_modules|test"
```

## Triage

| Detector | Impact | Where | Verdict |
|---|---|---|---|
| arbitrary-send-erc20 | High | `FileEscrow.accept` (`FileEscrow.sol:157`) | False positive. `transferFrom(d.buyer, ...)` runs only when `msg.sender == d.buyer`, after `msg.sender != counterparty` reverts. The caller pays from their own balance. |
| uninitialized-local (2) | Medium | `total` in `FileEscrow._create` (`:328`), `MilestoneEscrow.createDeal` (`:86`) | Benign. `total` is an accumulator that starts at zero by design. |
| unused-return (2) | Medium | `Address.functionCall` in `AgentWallet._executeProposal` (`:668,:680`) | Accepted. Return data of allowlisted `approve`/escrow calls is not needed; failure reverts. |
| reentrancy-benign, reentrancy-events | Low | `AgentWalletFactory.createWallet` (`:20-22`) | Accepted. `config.token.mint` is an external call before the wallet is recorded; the new wallet is empty and the factory holds no funds, so re-entry has no effect. Move the push and event before the mint to silence it. |
| timestamp (11) | Low | FileEscrow windows, session/proposal expiry | Accepted. Windows are hours to days, so miner skew is irrelevant. Boundary behaviour (`== deadline`) needs explicit tests. |
| costly-loop (3) | Info | `_setApprover` in the constructor | Accepted. Bounded by the approver list given at creation. |
| missing-inheritance | Info | `MockUSDC` vs `IMintable` | Cosmetic. |

No result changes the audit ranking. Slither does not model the web layer, the key custody, or role changes
after deal setup (AW-M-03); those come from the manual audit.

## Contract sizes (deployed bytecode, optimizer on)

AgentWallet 20,079 bytes (limit 24,576), FileEscrow 8,717, MilestoneEscrow 6,937, MockTHB 4,486. AgentWallet
has about 4.5 KB of headroom, so planned additions (group wallets, AIArbiter hooks) need a size check.
