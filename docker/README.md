# Run the whole system locally (for judges)

Needs Docker with Compose v2. No Node, no database, no wallet install. From the repository root:

```bash
docker compose up --build
```

First build takes a few minutes (contracts compile, app build). When the `web` service reports healthy, open **http://localhost:3000**.

## What starts

| Service | What it is | Port on your machine |
|---|---|---|
| `postgres` | Mock Bank ledger and app database | 55432 |
| `chain` | Hardhat node, chain id 31337, funded test accounts | 8545 |
| `deployer` | One-shot: deploys the contracts to `chain`, writes their addresses to a shared volume, then exits | none |
| `web` | The Next.js app: agent, policy engine, Mock Bank, explorer at `/explorer` | 3000 |
| `desktop` | The desktop app (its own signed deal chain, MCP server), run from source and pointed at `web` | 47821 |

Start order is enforced: postgres and chain healthy, then deployer finishes, then web (creates the schema, then serves), then desktop.

## Demo data

A one-time `seed` job fills the system after `web` is healthy, through the app's own API and the chain (so the records are real). Sign in through the Mock Bank (Thailand) with PIN `123456`:

| Username | Who |
|---|---|
| `somchai` | Buyer. Company admin. Has a completed deal, one paid and delivered, and sent transfers. |
| `nong` | Has a delivered deal waiting for approval. Company member who cannot sign. |
| `mali` | Has an offer waiting to accept. Company signer. |
| `preecha` | Received a transfer. |

Also: all four are friends with each other (nong and mali too); top-ups and transfers between them; the company **Siam Craft Co., Ltd.** (signers somchai and mali, 2 of 2) with one completed 5,000 THB deal and one 2,400 THB deal with one of two votes in. Deals are in stages: proposed, paid, delivered, released. Watch them on `/explorer`.

Set `SEED_DEMO_DATA=false` for an empty system. The job skips itself when the data already exists, and runs again after `docker compose down -v`. See what it did with `docker compose logs seed`.

## The desktop app

It is a local app that normally opens in your browser with a one-time link. Get the link:

```bash
docker compose logs desktop | grep "Open:"
```

Open that `http://127.0.0.1:47821/#t=...` link. The token changes on every start. Linking the app to an account:

1. In the website (http://localhost:3000) sign in through the Mock Bank, verify your identity with the demo digital ID, and create your wallet.
2. Website: Profile → Desktop app → **Make a link code** (valid 10 minutes).
3. In the desktop app: the server address is already `http://localhost:3000`; enter the code, a device name and a passphrase.

Then use the AI chat, deals and chain verification there. The app's data lives in the `desktopdata` volume. Its MCP mode (`--mcp`, for Claude Desktop or Cursor) is not exposed from the container; it is for a desktop install.

## One environment file

`.env.example` at the root is the single configuration for every container. It works as is, so nothing needs editing to start. To add your own values (the LLM key), copy it:

```bash
cp .env.example .env
```

Compose reads `.env.example` first and `.env` on top, so `.env` only needs the lines you change. Set **one** LLM provider (`LLM_BASE_URL` + `LLM_API_KEY`, or `OPENROUTER_API_KEY`, or `ANTHROPIC_API_KEY`); without one, the app runs but the chat agent and the AI arbiter cannot answer. Contract addresses are not in the file: the deployer writes them.

All keys in the file are Hardhat's public test keys for a throwaway local chain. Never reuse them.

## Useful commands

```bash
docker compose logs -f web
```

```bash
docker compose down -v
```

The second command stops everything and wipes the chain and the database (a clean start). A plain `docker compose down` keeps the database but the chain is in memory, so after any restart run `docker compose up` again to redeploy; contract addresses are the same each time on a fresh chain.

## Notes

- If port 3000 is busy, set `WEB_PORT` and also `BETTER_AUTH_URL` / `APP_ORIGIN` to the new port, or sign-in and POST requests are refused (origin check).
- The browser only talks to `web`. Exposing `chain` and `postgres` is for inspection (MetaMask, psql) and is bound to 127.0.0.1.
- Verified 2026-10-20: the repo's end-to-end smoke test (25 checks) passes against this stack.

## Production (own server, own database)

`docker-compose.prod.yml` is separate from the local test stack. It runs the web app with **its own Postgres container** (instead of a hosted Neon database), plus a small `cron` job. It does not start a chain: point it at the existing one (Besu server or Base Sepolia).

| Service | Job |
|---|---|
| `postgres` | The database. Data in the `pgdata` volume. No published port: only `web` reaches it. |
| `web` | The app. Creates the tables on start (`prisma db push`, refuses data loss). Listens on `127.0.0.1:3000` for your reverse proxy or tunnel (TLS there). |
| `cron` | Once a day calls `/api/cron/offers` with `CRON_SECRET` (what Vercel's cron does hosted): withdraws lapsed offers and anchors desktop chain heads. |

Set it up with one env file, `.env.prod` (copy `.env.prod.example`; it lists every value, with the chain addresses and role keys of the chain you use):

```bash
cp .env.prod.example .env.prod
```

Start it:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Back up the database (run it from cron on the server and copy the file off the machine):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres pg_dump -U aw agenticwallet > backup.sql
```

Notes:
- Compose refuses to start while `POSTGRES_PASSWORD`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `RPC_URL` or `CRON_SECRET` is empty.
- Use hex secrets (`openssl rand -hex 32`); the password is placed inside the database URL.
- Do not leave `DB_SCHEMA=` empty in the file (an empty value breaks the schema step); leave the line out.
- Moving existing data from Neon: `pg_dump` from Neon and restore into this container (not done here).
- `docker compose ... down` keeps the data; `down -v` deletes it.
