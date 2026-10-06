# Agentic Wallet: web app

Next.js 16 (App Router) + viem + Claude. See the [root README](../README.md) for the architecture, local setup and deployment.

- `src/app/page.tsx`: landing page
- `src/app/w/[address]`: sandbox workspace (chat, wallet, approvals, deals, audit)
- `src/app/api/*`: route handlers; all signing happens server-side with testnet demo keys
- `scripts/e2e.mts`: `npm run e2e` runs the full demo flow against a live chain without the LLM
