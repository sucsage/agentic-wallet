# Security documentation

Working security record for Agentic Wallet, maintained by @NawaratKhem (testing, security, contract review).
It is the base for the competition `SECURITY.md` self-assessment. English only.

| File | What it holds | Status |
|---|---|---|
| [AUDIT-2026-10-14.md](AUDIT-2026-10-14.md) | Source audit of commit `9858229`: ranked findings, design-claims check, key custody, test plan | Findings open unless marked |
| [SLITHER.md](SLITHER.md) | Static analysis run, triage of every result, how to reproduce | Complete for `9858229` |
| [poc/AW-H-01-stale-factory-return.ts](poc/AW-H-01-stale-factory-return.ts) | Reference test for the factory behaviour behind AW-H-01 (not run by `npm test`) | Passes today by design |

Rules for this folder: add a row above for every new file; findings are re-checked against the code before a status
changes; no keys, `.env` values, or live credentials.
