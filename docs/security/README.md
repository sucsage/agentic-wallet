# Security documentation

Working security record for Agentic Wallet, maintained by @NawaratKhem (testing, security, contract review).
It is the base for the competition `SECURITY.md` self-assessment. English only.

| File | What it holds | Status |
|---|---|---|
| [AUDIT-2026-10-14.md](AUDIT-2026-10-14.md) | Source audit of commit `9858229`: ranked findings, design-claims check, key custody, test plan | Findings open unless marked |
| [SLITHER.md](SLITHER.md) | Static analysis run, triage of every result, how to reproduce | Complete for `9858229` |
| [poc/AW-H-01-stale-factory-return.ts](poc/AW-H-01-stale-factory-return.ts) | Reference test for the factory behaviour behind AW-H-01 (not run by `npm test`) | Passes today by design |

| [TEAM-BRIEF-2026-10-15.md](TEAM-BRIEF-2026-10-15.md) | What changed against the PDF plan, questions for the team, planned `SECURITY.md` corrections | Draft, to share |
| [PROPOSAL-dispute-timeout.md](PROPOSAL-dispute-timeout.md) | Draft design for a dispute timeout | Draft, awaiting the contract matrix |

| [SECURITY-CORRECTIONS.md](SECURITY-CORRECTIONS.md) | Fact check of `SECURITY.md`, `EVIDENCE.md` and README against the code: ranked problems, paste-ready replacements, new risk rows | Proposed edits, to send as a PR |

Rules for this folder: add a row above for every new file; findings are re-checked against the code before a status
changes; no keys, `.env` values, or live credentials.
