# Run the whole system locally

One command starts the full system on your machine in containers: database, blockchain, the web app, the desktop app, and demo data. No Node, Postgres or wallet install needed. This is the setup for reviewers and judges to test everything end to end.

- [Quick start](#quick-start)
- [What you get](#what-you-get)
- [Try it: a 10-minute tour](#try-it-a-10-minute-tour)
- [The desktop app](#the-desktop-app)
- [Configuration (one env file)](#configuration-one-env-file)
- [Everyday commands](#everyday-commands)
- [Troubleshooting](#troubleshooting)
- [Production (own server, own database)](#production-own-server-own-database)

## Quick start

**You need:** Docker with Compose v2 (Docker Desktop, or Docker Engine on Linux), about 6 GB of free RAM and 5 GB of disk, and these ports free on your machine: `3000`, `8545`, `47821`, `55432`.

```bash
git clone https://github.com/sucsage/agentic-wallet.git
cd agentic-wallet
```

(Optional, for the AI chat agent) add one LLM key. Without it everything works except the chat agent and the AI arbiter:

```bash
cp .env.example .env
```

Open `.env` and fill **one** provider: `OPENROUTER_API_KEY`, or `ANTHROPIC_API_KEY`, or `LLM_BASE_URL` + `LLM_API_KEY`.

Start everything (the first build takes a few minutes: it compiles the contracts and builds the app):

```bash
docker compose up --build -d --wait
```

When it returns, open **http://localhost:3000**. The demo data is loaded by a one-time job a minute or so later; check it finished:

```bash
docker compose logs seed
```

It ends with `[seed] done.`

## What you get

```
 your browser ──► web :3000 ──► postgres :55432      app + Mock Bank data
                  │   └──────► chain :8545           contracts, deals, money (local Hardhat)
 your browser ──► desktop :47821 ──► web             a user's own signed deal chain
 deployer ──► chain      (runs once: deploys the contracts)
 seed ──► web            (runs once: creates the demo people and deals)
```

| Service | What it does | Keeps data in |
|---|---|---|
| `postgres` | Postgres 16: the Mock Bank ledger, users, sessions, companies, groups, deal drafts. | volume `pgdata` |
| `chain` | Local blockchain (Hardhat, chain id 31337) with funded test accounts. | memory only |
| `deployer` | Deploys the contracts to `chain`, writes their addresses to a shared volume, then exits (that is normal). | none |
| `web` | The Next.js app: AI agent, policy engine, Mock Bank, deals, chain explorer at `/explorer`. Creates the database tables on start. | uses `postgres` and `chain` |
| `seed` | Fills the system with demo people, wallets, transfers, a company and deals. Skips itself if the data exists. | none |
| `desktop` | The desktop app, run from source: each user's own signed copy of their deals. | volume `desktopdata` |

Start order is enforced: postgres and chain are healthy, then the deployer finishes, then web, then seed and desktop.

Where to look:

| What | Address |
|---|---|
| The app | http://localhost:3000 |
| Public chain explorer | http://localhost:3000/explorer |
| Desktop app | the link from `docker compose logs desktop \| grep "Open:"` |
| Chain RPC (MetaMask, `cast`) | http://127.0.0.1:8545 (chain id 31337) |
| Database | `psql postgresql://postgres:awlocal@127.0.0.1:55432/agenticwallet` |

## Try it: a 10-minute tour

**1. Sign in as a demo person.** On "Log in to continue" tick the consent box, choose **Thai bank**, and press **Continue with Thai bank**. On the Mock Bank page log in with a username below and PIN `123456`, then pick the passbook and press **Allow & continue**:

| Username | Who | What they have |
|---|---|---|
| `somchai` | Buyer, company admin | A completed 3,500 THB deal, a 1,200 THB deal in progress, transfers sent. |
| `nong` | Freelancer, company member who cannot sign | An 800 THB deal delivered and waiting for her approval. |
| `mali` | Copywriter, company signer | A 650 THB offer waiting to be accepted. |
| `preecha` | Shop owner | Received a transfer. |

All four are friends, and each has a verified identity, a wallet, and a Mock Bank balance. Their balances come from the Mock Bank's sign-up money plus recorded top-ups and transfers.

**2. Walk the deal flow.**
- As `nong`: open the delivered 800 THB deal and **approve** it. The money is released from escrow.
- As `mali`: **accept** the 650 THB offer. It is paid into escrow.
- As `somchai`: open the completed deal and look at its history.

**3. Look at the company.** The company **Siam Craft Co., Ltd.** has two signers (`somchai`, `mali`, 2 of 2) and one member who cannot sign (`nong`). Switch to it with "Acting as". It has one completed 5,000 THB deal, and one 2,400 THB deal with one of two votes in: sign in as `mali` and vote to execute it. `nong` is refused, because only signers can move company money.

**4. See it on the chain.** Open http://localhost:3000/explorer: every deal move is a real transaction on the local chain, with the escrow contract's state.

**5. Try the AI agent** (needs an LLM key in `.env`). Open the chat and ask it to draft a deal, for example "Hire Nong to translate my menu for 800 baht". It drafts the deal, you confirm, and the guard checks it against the policy before anything is signed. Ask it for something outside the policy (a payee that is not allowed, an amount over the cap) and watch it be refused.

**6. Sign up as a new person** with a new username (any PIN): the demo identity check passes at once and your wallet is created on the chain.

## The desktop app

The desktop app keeps each user's own signed copy of their deal chain. Normally you install it on your computer; here it runs in a container and opens in your browser.

Get its one-time link (the token changes on every start):

```bash
docker compose logs desktop | grep "Open:"
```

Open that `http://127.0.0.1:47821/#t=...` link, then link the app to an account:

1. In the website (http://localhost:3000) sign in, for example as `somchai` (his wallet exists already).
2. Website: Profile → Desktop app → **Make a link code** (valid 10 minutes).
3. In the desktop app: the server address is already `http://localhost:3000`. Enter the code, a device name and a passphrase of at least 8 characters.

Then use its deals, AI chat and chain verification. Its data lives in the `desktopdata` volume. Its MCP mode (`--mcp`, for Claude Desktop or Cursor) is not exposed from the container; it is for a normal desktop install.

## Configuration (one env file)

`.env.example` at the repo root is the single configuration for every container. It works as is. Compose reads it first and then `.env` (if you create one) on top, so `.env` only needs the lines you change. Typical changes:

| Variable | Default | Change it to |
|---|---|---|
| `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `LLM_BASE_URL` + `LLM_API_KEY` | empty | your key (one provider) |
| `LLM_MODEL` | empty (provider default) | a model name |
| `SEED_DEMO_DATA` | `true` | `false` for an empty system |
| `DISPUTES` | `on` | `off` to hide disputes |
| `WEB_PORT`, `CHAIN_PORT`, `POSTGRES_PORT` | 3000, 8545, 55432 | other host ports; if you move the web port, also set `BETTER_AUTH_URL` and `APP_ORIGIN` to match, or sign-in and POST requests are refused |

The keys in the file are Hardhat's public test keys for a throwaway local chain. Never reuse them anywhere else. Contract addresses are not in the file: the deployer writes them. An LLM key is the only thing you must add yourself, and only for the chat agent.

## Everyday commands

Show the state of every service (`deployer` and `seed` show "Exited (0)", which is normal):

```bash
docker compose ps -a
```

Follow the app's logs:

```bash
docker compose logs -f web
```

Stop everything but keep the database and desktop data (the chain is in memory, so run `up` again to redeploy it):

```bash
docker compose down
```

Stop everything and wipe all data for a clean start (chain, database, desktop, then demo data is loaded again):

```bash
docker compose down -v
```

After `down` (without `-v`) the database still lists earlier deals but the new chain has none of them. For a consistent state, use `down -v`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `port is already allocated` | Another program uses 3000, 8545, 47821 or 55432. Stop it, or change the port in `.env` (see the table above). 47821 is fixed. |
| The page loads but sign-in or buttons fail with "Cross-site request refused" | You opened the app on a different address or port than `BETTER_AUTH_URL`. Use http://localhost:3000, or set `BETTER_AUTH_URL` and `APP_ORIGIN` to the address you use. |
| No demo people yet | The seed job runs after the app is healthy. Wait a minute and check `docker compose logs seed`. |
| Chat agent or AI arbiter does not answer | No LLM key in `.env`. Add one and run `docker compose up -d` again. |
| A deal looks stuck right after an action | The app reads the chain a moment behind; reload after a few seconds. |
| Build fails or runs out of memory | Give Docker at least 6 GB RAM, then `docker compose up --build -d --wait` again. |
| Desktop link says the token is missing | The link changes on every start. Get a fresh one with `docker compose logs desktop \| grep "Open:"`. |
| `web-entrypoint.sh: no such file or directory` (Windows) | The script had Windows (CRLF) line endings. Fixed in the images and by `.gitattributes`. If you cloned before the fix, update, then `docker compose build --no-cache`. |
| Everything is in an odd state | `docker compose down -v`, then start again. |

## Source

All of this lives in the repository root and `docker/`:

| File | Purpose |
|---|---|
| `docker-compose.yml`, `.env.example` | The local stack and its single env file |
| `docker/contracts.Dockerfile`, `docker/deploy.mjs` | Chain image and the contract deployer |
| `docker/web.Dockerfile`, `docker/web-entrypoint.sh` | Web image: build, create tables, start |
| `docker/desktop.Dockerfile`, `docker/desktop-entrypoint.sh` | Desktop app image |
| `docker/seed.mts` | The demo-data job (people, wallets, transfers, company, deals) |
| `docker-compose.prod.yml`, `.env.prod.example` | Production (below) |

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
