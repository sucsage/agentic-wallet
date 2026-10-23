# Security self-assessment

Kravii (formerly Agentic Wallet / MilestonePay) · FinTechathon 2026, International Track, Topic F (Agent Wallet)

Updated 2026-10-19 for desktop 0.6.3. The rename changed names and logos only: signed-message
formats and hashed texts keep their original "Agentic Wallet" wording, so every existing device
signature, chain block and on-chain anchor still verifies.

This document covers the permission tiers, how each one is enforced, what we tested, and the risks
we know about. Everything runs on test money: a simulated bank ("Mock Bank") and tokens with no value
on our own permissioned chain. No real funds, bank accounts or credentials are involved.

## 1. What is being protected

| Asset | Where it lives | Who may move it |
|---|---|---|
| Buyer's money (simulated baht) | Mock Bank ledger (Postgres) until a deal is locked | Only the buyer's own click, debited just in time for one deal |
| Money locked for a deal | `FileEscrow` contract (mTHB tokens) | The escrow rules: buyer approval, review windows, neutral arbiter |
| The agent's spending power | `AgentWallet` contract, one per user | Session key within caps and allowlists; everything else needs the owner |
| Delivered files | Postgres, AES-256-GCM encrypted | The seller; the buyer only after approving and the key being released on-chain |
| Personal data (names, deal titles, chat) | Postgres only | Never written on-chain (PDPA): the chain holds hashes and amounts |

## 2. Permission tiers

The agent never holds the owner key. It has a **session key** with an expiry, a per-transaction cap and
a daily cap. Every action is checked twice: by the off-chain policy engine
(`web/src/lib/policy.ts`, guard 1) and again by the `AgentWallet` contract (guard 2). A bug, a
jailbreak or a stolen agent key can get past guard 1, but the contract still refuses.

| Tier | Who acts | What it covers | On-chain enforcement (`contracts/contracts/AgentWallet.sol`) |
|---|---|---|---|
| **Tier 0 · Read** | Agent | Balances, deals, allowlist, history | Read-only calls |
| **Tier 1 · Human approves** | The owner (the user's click) | Locking money in a new deal, sending an offer, accepting an offer, anything above the agent's caps, adding a payee, changing caps | `propose()` → `approve()` by `threshold` approvers, or an **EIP-712 mandate** signed by the owner (`executeMandate`): bound to this wallet and chain, single use, with a deadline, revocable (`revokeMandate`), and void if the owner changes. Mandates pass the same checks as proposals |
| **Tier 2 · Agent acts alone** | Agent session key | Approving a delivered milestone (`agentApproveFile`), paying an allowlisted recipient (`agentTransfer`), releasing a milestone with evidence (`agentReleaseMilestone`) | Session active and not expired; **per-tx cap** and **daily cap** (`_spend`); recipient on the **allowlist**; escrow on the escrow allowlist; this wallet must be the deal's buyer; settlement token only |
| **Tier 3 · Emergency stop** | Agent, approvers or owner | Pausing the wallet when something looks wrong | `pause()` blocks every Tier 1 and Tier 2 path (`whenNotPaused`); **only the owner can `unpause()`**; the owner can `revokeSession` instantly |

Default caps for a bank-backed wallet: **฿5,000 per transaction and ฿20,000 per day** (¥1,000 / ¥4,000
for CNY customers). New wallets start with an **empty allowlist**: a friend becomes a payee only when
the user presses "Add to allowlist", which is an owner transaction.

Generic calls are narrow. A Tier 1 `Call` may only do these things:

- approve the wallet's token for an allowlisted escrow
- create a deal with an allowlisted payee in the wallet's token, under a neutral arbiter
- take the buyer's side of a `FileEscrow` deal: accept, approve, dispute, reclaim, cancel
- take the seller's side of a `FileEscrow` deal: offer, accept a buyer's offer, deliver, release the key, claim, refund, withdraw its own offer

The seller's moves can never take money out of the wallet. Anything else reverts with `InvalidProposal`.

**Neutral arbiter.** A deal's arbiter may not be the wallet itself, its owner, an approver or a session
key (`ArbiterNotNeutral`), so the buyer's side can never judge its own dispute.

## 3. Money flow controls (Mock Bank ↔ chain)

- **Just-in-time funding** (`web/src/lib/bank/funding.ts`). The steps are: check the owner's
  signature → debit the bank → mint the same amount → lock it in escrow. One funding id (the mandate's
  EIP-712 digest) keys every step, so a retry never debits or mints twice. If the lock **certainly**
  failed, the mandate is revoked first, the tokens are burned and the bank is refunded. If the outcome
  is unknown (a network error), the funding stays `PENDING` and nothing is refunded by guesswork.
- **Reserve invariant.** Every mTHB in circulation is backed by the Mock Bank reserve account. Mint and
  redeem ids are single use on-chain (`MockTHB.minted / redeemed`), and only the bank key (`BANK_ROLE`,
  separate from the owner key) can mint.
- **Ledger.** Every transfer has an idempotency key that is unique in the database. A debit and its
  balance check run in one statement, so concurrent requests cannot overdraw. Currencies never mix.
- **Payout.** When escrow pays a seller, the seller's tokens are redeemed (burned) and the same amount
  moves from the reserve to the seller's bank account, keyed by deal and milestone.

## 4. Files, evidence and privacy

- Delivered files are encrypted with **AES-256-GCM** and stored in Postgres. Only their **sha256**
  goes on-chain, as the work hash. The release on-chain carries a keccak commitment to the key.
- The buyer can download only once the escrow shows the key as released. Before that the server
  refuses, and the decrypted file's hash must match the on-chain work hash.
- After the buyer approves, the server decrypts the file, checks it against the on-chain hash and only
  then confirms the key for the buyer, which pays the seller at once. A key that does not open the file
  is never confirmed; the buyer can dispute it inside the window.
- PDPA: names, titles, milestone descriptions and chat stay in Postgres, where a user can export and
  delete them. The chain stores `sha256:` hashes of the terms and the amounts only. The public
  explorer labels user wallets as "Agent wallet (user)", without names.

## 4b. Disputes and the neutral arbiter

**Opening new disputes is turned off since 2026-10-19** (`config.disputesOpen`, only `DISPUTES=on`
enables it): the server refuses the `dispute` move on every path (website, private links, desktop
intents, AI tools, MCP requests), so nothing can reach the contract's `dispute()`. Disputes opened
before run to their ruling as described below. The consequence: a buyer's protection against bad work
is not approving, asking for changes within the agreed rounds, and the seller's refund; after the
review window the seller can claim.

- The buyer can dispute inside a review window. The reason is required and stored off-chain.
- **Key disputes** ("the released key does not open the file") are decided by a check, not by a model:
  the server decrypts the delivery and compares its sha256 with the work hash anchored at delivery.
- **Work disputes** go to the AI arbiter (`web/src/lib/bank/arbiter.ts`). Its inputs are:
  - the agreed terms and acceptance criteria
  - the seller's evidence and reply and, when the file is text, its content
  - the buyer's reason

  On FileEscrow v2 a mediator model first proposes a split; both sides must accept it. Otherwise
  three models from different providers rule independently, each signing its ruling with its own
  derived key; 2 of 3 must agree (within 10 points). Either side can appeal to five models (3 of 5).
  Only then does the arbiter key call `FileEscrow.resolveSplit`. No agreement goes to a human arbiter
  at `/admin/disputes`. Deals on the first escrow keep the single ruling at **≥ 75% confidence**.
- The resolve transaction is on-chain. Settlement to the bank then runs as for any payout or refund.

## 4c. Desktop app and device chains

What a user (or an attacker on their computer) can and cannot do with the chain they hold:

| Attempt | Result |
|---|---|
| Edit an old block on disk (amount, status) | Its hash no longer matches: "Verify now" fails, and the server refuses any block built on it. "Put back my last backup" restores the encrypted backup. |
| Rewrite history (a different block at an old height) | Refused: the server only accepts blocks that continue its countersigned head. |
| Invent a deal event ("milestone released") | Refused: events must carry the server's signature and be a known `DealEvent` for that wallet. |
| Sign a move with another key | Refused: every block and request is checked against the device key. |
| Replay a captured request | Refused: each request signature is accepted once within its 5-minute window. |
| Use a stolen `vault.json` | Needs the passphrase (scrypt + AES-GCM). Profile → Desktop app → Remove cuts the device off. |
| The server quietly swaps a user's head | The device holds every block and the server's countersignature; heads are anchored on-chain hourly, so an earlier anchor would no longer match. |

- Escrow money still moves only by FileEscrow's rules; the chain on the computer records and signs, it does not hold money. A move signed in the app runs through the same checks as the website (KYC limits, group votes, offer expiry, guarantors).
- The app's local server is reachable only from 127.0.0.1 with the per-launch token, Host-checked, no CORS; other web pages cannot drive it. Its one page without the token, `/topup-done`, only confirms a Stripe session that belongs to the signed-in device's user (idempotent per session).
- No sign-in in the app (since 0.3.0): accounts are made on the website and a computer is linked with a one-time code (10 minutes, stored as an HMAC) signed by the device key. Identity checks stay on the website.
- The app reaches the website's other API routes only through device-signed requests (`bridge.ts`): the proxy checks the signature over method, path with query, time and body before any route runs, strips a client-sent verified header, and passes a sealed one; replays, changed queries and forged headers were refused in testing. Admin, auth, cron and device routes are not reachable this way, and MCP agents cannot use it.
- AI cost abuse: tokens per user per day and per week on the team's key (TECHNICAL §3.21), checked before every agent turn, so a runaway loop or one heavy user cannot spend everyone's budget; admins can lower or raise one user's limit.
- AI boundaries in the app: custom instructions are fenced data after the rules; outside agents (MCP) hold a token that can read and queue only; a user's own AI key is sealed on their computer and used per request; the agent's tools only read or make previews, so neither a prompt nor an instruction can pay.

## 4d. The windowed app, its updates and its AI tools (desktop 0.5-0.6)

- **Updates** (since 0.6.2). The app reads `latest.json` from the project's GitHub Releases over
  HTTPS and installs only a file whose size and SHA-256 match it; nothing is unpacked or run before
  that check. On macOS the new bundle is swapped in by a small script after the app quits, and the
  old one is put back if the move fails; on Windows the Inno Setup installer runs silently. This
  proves the file is the one the release lists, not who built it: the checksum sits in the same
  release, and the builds are not code-signed (R12).
- **Windows build.** `bun.exe` is switched to a GUI program and both executables carry a manifest
  with per-monitor DPI awareness; the installer is per-user (no administrator rights).
- **Web tools** (`mcp__web__search`, `mcp__web__read_page`). They run on the user's computer. Page
  reads accept only http(s) to public hosts: a host that is, or resolves to, loopback, a private,
  link-local or CGNAT network or an IPv6 local address is refused, and every redirect is checked
  again, so a prompt cannot make the app read its own local server or the user's network (SSRF). What
  they return is fenced as untrusted data, and the tools' descriptions tell the model not to put
  personal or wallet data in a query. Users can turn them off or make them ask first.
- **MCP servers for the app's AI.** They run with the user's own access, like any program the user
  installs, which is why the app asks before each call unless the user chooses "always allow", and
  why they cannot sign, pay or confirm anything in the wallet. One-click Add (recommended servers and
  the official MCP Registry) accepts only an https URL or an npm package run with the app's Bun, never
  an arbitrary command; servers that need keys are added turned off. Saved keys are shown masked.
  Servers start with a time limit, so a broken one cannot hold the chat.
- **No stuck queue.** Every call to the website has a time limit (75 s; uploads 180 s), and the
  background sync never queues ahead of the user's own moves (0.6.1).
- **Window and page.** The app's page has no browser context menu (no Inspect or Reload); the local
  server, its token, Host check and CSP are unchanged; links that open a new window go to the system
  browser.

**Tests** (re-run before each release):

| Suite | Command | What it checks | Last result |
|---|---|---|---|
| Chain format, sanitizer, vault (unit) | `cd desktop && bun test` | edited / re-hashed / foreign-key / gap / fork blocks, forged or altered deal events, genesis rules, canonical hashing, request signatures over method+path+time+body, Merkle proofs and swapped heads; 12 XSS payloads against the Markdown renderer (only allowlisted tags, `<a>` with http(s) href only); passphrase, tamper and per-purpose keys of the vault | 34/34 pass (2026-10-19) |
| Web tools guard (manual) | script against `web-tools.ts` | page reads of `127.0.0.1`, `192.168.1.1`, `localhost`, `[::1]`, `file://` and a public name resolving to 127.0.0.1 (`localtest.me`) all refused; a public page read | pass (2026-10-19) |
| Request time limits (manual) | a server that never answers | signed JSON and signed raw calls give up after 75 s with "did not answer in time" | pass (2026-10-19) |
| In-app update (manual, macOS) | 0.6.2 installed in a test folder | update to 0.6.3: download, SHA-256 check, swap, reopen as 0.6.3, downloads cleaned | pass (2026-10-19); Windows not run |
| Live app + server | `AGENTIC_WALLET_DATA=… AW_PASS=… bun run security` | local server: token, Host (DNS rebinding), no CORS, agent token cannot sign, CSP; MCP: tools read, a move stays PENDING and the balance does not change; server: unsigned, foreign-signed, replayed and stale requests, forged events, history rewrite, foreign-key and edited blocks, a swapped delivery file, a refused BYOK key not echoed, a prompt-injection custom instruction that tries to make the AI pay | 17/17 pass (2026-10-18) |
| Contracts | `cd contracts && npx hardhat test nodejs` | includes `ChainAnchor` (anchorer only, no empty root) | pass |

- Private links: replacing a working link needs the 6-digit code its holder gets on their page (the inviter cannot take a link over alone); a link claimed by an account is destroyed at once; a finished deal's link closes 7 days later.
- Work files open in place: framing by this origin only; PDFs served without scripts or network (`default-src 'none'`), other types as downloads; a delivery stays encrypted until approval and is previewed only as watermarked page images.
- Known limits: the executables are not code-signed (R12) (Windows SmartScreen and macOS Gatekeeper warn once); a forgotten passphrase cannot be reset (link the computer again; deal history stays on the server and in the escrow); the anchor proves the head existed, not who was right in a deal.

## 5. Application security

- **Sign-in.** Mock Bank login with a 6-digit demo PIN, hashed with scrypt. After **5 wrong PINs the
  account locks for 15 minutes**. Sessions are handled by Better Auth. The login page states that
  this is a demo bank and must not get real credentials. New users sign in with email and password
  (scrypt) or Google / Apple. **Password reset:** a single-use emailed link valid 30 minutes; the
  answer is the same whether or not the email has an account, and a reset revokes every other
  session. Without a mail service in production the option is hidden rather than faked.
- **Authorization.** Every wallet route checks the session **and** that the wallet belongs to the
  user (`web/src/lib/guard.ts`). The browser never sends amounts or payees for a lock: approval reads
  the draft back from the database, so what gets locked is what the user saw.
- **Rate limits** on all write routes (approve, deal actions, deliveries, invites, payout checks, RPC).
- **Prompt injection.** Documents, invoices and evidence are passed to the model as untrusted data. A
  heuristic scanner flags overrides, urgency, changed bank details and unknown addresses. The real
  defence is on-chain: an address that is not on the allowlist reverts, whatever the model says.
- **The agent never shows addresses or internal data.** The model is given people's names only,
  never wallet addresses. Its tools turn a name back into an address on the server, and only for the
  user's own contacts, so an address in a document cannot become a payee. Every reply and tool result
  is filtered for 40-hex addresses, and streamed text holds back anything that could still grow into
  one. Database ids, keys and other users' data are never in what the tools return.
- **The agent's memory is kept on the server.** Saved chats (up to 20 per wallet) are stored server-side,
  and the model's history is rebuilt from them, so a browser cannot rewrite what the agent was told
  earlier. The browser receives each tool step as the chat shows it (name, redacted summary, draft
  card), never the raw tool result. Nicknames the user teaches the agent map to a contact on the
  server; the model still sees only names.
- **No draft from guesswork.** A deal draft needs acceptance criteria for every milestone and, for a
  parcel, a delivery address; otherwise the tool refuses with NEED_INFO and the agent must ask.
- **KYC through a national digital ID, without keeping the ID.** Thai customers verify with a mock
  ThaID, Chinese customers with a mock 国家网络身份认证 (National Network Identity), over OpenID Connect
  (authorization code + PKCE, state, nonce; the id_token's signature, issuer, audience and expiry are
  checked; codes are single use for 5 minutes). The ID holder must be the bank account holder. We
  store only a masked id and an HMAC of it (one identity verifies one account); the mock provider
  drops the claims once the token is issued. The Chinese flow follows the 网号 design: the app gets an
  opaque network id and a name-match result, never the resident ID number. Until verified, a
  customer can lock at most 2,000 THB / 400 CNY per deal and top up 1,000 THB / 200 CNY.
- **Card top-ups cannot be forged.** Top-ups use Stripe Checkout in test mode only (live keys are
  refused). The browser's return proves nothing: the server fetches the Checkout Session from Stripe
  and credits it only if Stripe says it is paid, for this user, in this currency, once per session id.
- **A linked card is charged only for a real shortfall, once.** Off-session charges carry the funding
  id as Stripe's idempotency key and the ledger key; they run only after the mint-cap check passes,
  so a deal that cannot be locked never charges the card. Only test keys are accepted, and the app
  stores the card's brand, last four digits and expiry, never the number.
- **Previews before payment cannot replace the work.** A delivered image is shown to the buyer only as
  a 720 px JPEG with a tiled watermark; the original stays encrypted until the key is released.
- **Two-step sign-in (2FA, demo).** Optional PIN (scrypt), email code, simulated SMS, or a WebAuthn
  credential on the device (face / fingerprint / passkey). While it is on, all customer routes return
  428 until this session passed; the pass is an httpOnly cookie holding an HMAC of the session id, so
  it cannot be copied to another session. Setup changes need a passed session (a stolen session
  cannot switch 2FA off); five wrong codes lock code checks for 10 minutes. Demo limits: SMS is
  simulated, emailed codes are shown on screen when no mailer is configured, and WebAuthn signatures
  are not verified server-side.
- **Blocking and reports.** A block works both ways (search, contact requests, transfers, group
  invites) and removes the blocked person from the blocker's allow transfer list on-chain. A blocked
  person gets the same answer as for an unknown username. Reports reach admins only, without telling
  the reported person who sent them; one report per pair per day.
- **Delivered websites are sandboxed.** An `.html` delivery is previewed with a CSP `sandbox` (opaque
  origin: no cookies, no access to the app) and `default-src 'none'`, framed only by this app
  (`X-Frame-Options: SAMEORIGIN`), with a PREVIEW ribbon. The file itself stays encrypted until the
  key is released.
- **Amendments cannot double-charge.** Confirming an amendment withdraws the old offer first and
  refuses if the other side accepted it in the meantime; the deposit flag is part of the hashed terms
  both sides saw.
- **Deal files and chat files.** A file on a deal is readable only through a wallet that is a party
  of that deal on-chain (the user's own, or an outsider's link wallet), and only the deal's creator
  adds or removes them. Group chat files are readable by members only. Both are served with
  `X-Content-Type-Options: nosniff` and a sandbox CSP; anything that is not an image or a PDF is a
  download, so an uploaded HTML or SVG never runs in the app's origin.
- **Agreed file formats are enforced on the server.** A file milestone's formats are part of the
  hashed terms, and a delivery in any other format is refused before it is encrypted or anchored.
- **Addresses are checked** against the official Thai province / district / sub-district list
  before they are saved; the AI can change the saved address only through the same check.
- **Private links are not bearer secrets any more.** Holding a link opens nothing: the person needs
  the one-time code the inviter sends separately, then their own password (scrypt). Access cookies
  are HMACs tied to an access version that a reset bumps; 5 wrong tries lock the link for 15 minutes.
  A reset needs a code only the person sees, so the inviter (who also holds the link) cannot take
  over the page once a password is set.
- **Unfair or nonsensical terms cannot be confirmed.** The terms review blocks them before a preview
  exists, and `approveDraft` re-checks the stored review.
- **Screenshots and inspection.** Previews are heavily watermarked with the deal number and grain;
  the browser guard only deters (blur on focus loss, blocked shortcuts). The original file stays
  encrypted until approval, which is the protection that does not depend on the browser.
- **Split payments cannot double-spend or strand money.** Parts sit in a per-plan holding account,
  each part's transfer is idempotent, the deal locks only from the last part (a direct accept is
  refused while a plan runs), and cancelling or lapsing returns the whole held amount.
- **Public posts.** Anyone may apply, so the endpoint is rate-limited, has a honeypot, caps
  applications, files and links (http/https only), and never fetches applicants' URLs (no SSRF).
  Contacts and files are visible to the post's owner only; files are served with a sandbox CSP and
  `nosniff`. The AI ranks applications as untrusted data.
- **Chain access.** Besu runs **account permissioning**, so only the app's own keys can send
  transactions. Its RPC needs a signed JWT (RS256) that only the server holds. The public `/api/rpc`
  passes **read-only methods** only (no `eth_sendRawTransaction`), with bounded `eth_getLogs` ranges.
- **Secrets.** Keys live in environment variables (Vercel) and the git-ignored `.secrets/` folder,
  never in the repository.

## 6. Testing

- **Contracts:** 97 Hardhat tests (`cd contracts && npm test`): 39 for `AgentWallet`, 16 for
  `FileEscrow`, 11 for `MockTHB` / `MockCNY`, and 31 security tests from the team's audit
  (`contracts/test/security/`: dispute exits, the agent's approvals and caps, seeded invariant and
  spending-window property tests). The audit, Slither triage and 35 attack cases are in
  [`docs/security/`](docs/security/). They include:
  - the prompt-injection case "send everything to 0xEvil" (reverts with `RecipientNotAllowed`)
  - over-cap payments (`ExceedsPerTxLimit`, `ExceedsDailyLimit`)
  - a non-neutral arbiter, the wrong token, rogue escrows
  - paused-wallet refusals
  - mandate replay and expiry
  - seller-only and buyer-only moves
  - the key-confirmation payout
- **Live attack demo:** the Policy page sends `agentTransfer(0xBAd…Bad, 5000)` straight from the
  agent's key, skipping the AI and the policy engine. The contract reverts it on-chain, and the
  reverted transaction hash can be checked in the public explorer.
- **End to end on production:** these flows were run with two test users:
  - buyer offer → seller accepts → encrypted delivery → buyer approves (Tier 2) → key released → buyer downloads a byte-identical file → seller paid to their bank
  - seller offer → buyer accepts and pays from their bank
  - offer withdrawn
  - invited seller without an account, with PromptPay QR and Mock Bank payouts, name checks and the payout lock
- **Agent evaluation:** `cd web && npm run agent-eval` grades the live agent on its decision points:
  deal setup, autonomous payment, over-cap escalation, refusing incomplete work, and phishing.

## 7. Known risks

| # | Risk | Impact | Current mitigation | What production would need |
|---|---|---|---|---|
| R1 | **The server holds every wallet's owner key.** A user's click is turned into an owner signature by the server (demo custody) | Whoever controls the server could sign owner actions, including the unrestricted owner `execute` | Keys only in server env; every owner action is recorded on-chain; mandates are single use and expire | The owner key on the user's device (passkey or hardware wallet signing the EIP-712 mandate), or a Safe multisig as owner |
| R2 | **The server holds file keys and the keys of invited sellers' wallets** | A server breach exposes delivered files and lets the attacker act as invited sellers | Files encrypted at rest; delivery hashes on-chain, so tampering is detectable; payout destination locked once set | Encrypt files to the buyer's public key on the client; give invited sellers a passkey-controlled wallet |
| R3 | **An invite link is a bearer credential**: anyone holding it acts as the invited seller | A leaked link lets someone accept or deliver in the seller's name | Only the link's hash is stored; 30-day expiry; the buyer can rotate it; `no-referrer`, `noindex`; the **payout destination is set once and locked**, so a leaked link cannot redirect money; name check on Mock Bank accounts; strict rate limit on payout attempts | One-time code by SMS or email before the first action; device binding |
| R4 | **The chain has one validator, and the web app, database and validator run on one machine** (Docker, behind a Cloudflare Tunnel) | If that machine or its network is down, the whole site is down; one operator could rewrite history | QBFT, account permissioning, JWT-protected RPC; contracts and the Base Sepolia deployment kept as a fallback | Four or more validators run by different parties (BFT), monitoring, backups |
| R5 | **Payouts to people without an account** | A wrong account or a fraudulent payee gets the money | Bank-account payouts are real transfers through **Opn Payments** (test mode): the seller becomes an Opn recipient, which must be verified and then **activated by the operator in Opn's dashboard** before any money can go to it (new-payee review); each paid milestone is one Opn transfer, claimed in our database before it is sent, so it is sent once. The payout destination is set once and locked. PromptPay payouts are still simulated | Live Opn keys (or a licensed bank's PromptPay / ITMX payout API, or Stripe Connect where available) with name inquiry before the first transfer and sanctions screening |
| R6 | **An AI arbiter decides disputes about the work** | A wrong ruling pays the wrong side | The arbiter is neutral by contract (`ArbiterNotNeutral`) and is a separate model call with its own instructions, not the buyer's agent. It judges only against the written acceptance criteria and treats both parties' text as untrusted. No single model decides: a mediator only proposes, both sides may reject, then 2 of 3 models from different providers must agree, with an appeal to 3 of 5. Each ruling is signed by its model's key and shown to both sides. Disagreement goes to a human arbiter. Key disputes are checked mechanically (hash), not by AI | A panel of human arbiters for large amounts, and an evaluation set of past disputes |
| R7 | **Prompt injection or a hallucinating model** | The agent proposes the wrong thing | Allowlist, caps and neutral-arbiter checks are on-chain; Tier 1 needs the user's click; injection scanner; the tools validate every input | Already the main control; add per-counterparty limits and anomaly alerts |
| R8 | **Agent session key leak** | Spending up to the caps to allowlisted payees | Caps, allowlist, expiry, instant `revokeSession`, `pause()` | Short-lived keys from a KMS/HSM; alerts on unusual spending |
| R9 | **Smart contract bugs** | Locked or lost test funds | OpenZeppelin 5 primitives, `ReentrancyGuard`, `SafeERC20`, 102 tests, internal audit (`docs/security/`) | External audit, Slither/Echidna in CI, formal checks of the escrow state machine |
| R10 | **Public explorer and RPC load** | Heavy scraping could slow the node | Read-only methods, bounded log ranges, rate limits on `/api/rpc` | Caching indexer and a separate read replica |
| R11 | **Shared demo database** (one PostgreSQL for every tester) | Test data of several testers sits together | Users see only their own wallets; names never on-chain; export and delete in the profile | Per-tenant isolation, encryption of personal fields, retention policy |
| R12 | **Unsigned desktop builds and the update channel** | A compromised GitHub account or release could ship a malicious update; the SHA-256 in `latest.json` would match it | Releases only from the repository's tagged workflow; checksum and size checked before anything runs; HTTPS to GitHub | Apple notarisation and Windows Authenticode signing, with the updater checking the signature (or a release key the app pins) |
| R13 | **Third-party MCP servers** run code with the user's access | A malicious server could read the user's files or misuse its own access | Ask before each call by default; one-click Add only for an https URL or an npm package; servers cannot sign or pay in the wallet; results fenced as untrusted | A sandbox for local servers (no file system or network beyond what the user grants), a reviewed allowlist |
| R14 | **Web search and page reads** | A page could carry prompt-injection text; a model could put sensitive words in a query | Results fenced as untrusted; public hosts only (SSRF guard); the agent's tools still cannot pay; switch off or ask-first | A search API with a data-processing agreement, query filtering for personal data |
| R15 | **Disputes turned off** | A buyer cannot get an arbiter's ruling on bad work; after the review window the seller can claim | Buyer does not approve, asks for changes within the agreed rounds, or asks for a refund | Re-enable disputes (`DISPUTES=on`) with the panel, or a timeout that refunds when the seller does not answer (`docs/security/PROPOSAL-dispute-timeout.md`) |

### Fixed after the internal audit (2026-10-16)

| ID | Finding | Fix |
|---|---|---|
| DC-H-01 (High) | After the seller released a key, the agent's second `agentApproveFile` paid at once, skipping the challenge window, and charged the agent's cap twice (DC-L-02) | `AgentWallet` lets the agent approve only a `Delivered` milestone (`MilestoneNotDelivered`); confirming a released key is the buyer's own owner mandate. New factory `0xa537…186c` on Besu. Wallets made by the earlier factory keep their code, so the server applies the same rule before calling the agent path |
| DB-01 (High, mock money) | Overlapping approvals of one draft locked it several times and debited the bank each time | A per-draft lease (`DealDraft.approvingUntil`): one approval runs at a time, later clicks get "already being approved" or the same result. Three concurrent approvals now lock one deal and debit once |

Open audit items (dispute timeout DC-M-01, arbiter neutrality after setup AW-M-03, PIN-lock race
AW-M-02, unlinked-account debit AW-L-01, deletion leftovers P1) are tracked in
[`docs/security/AUDIT-2026-10-14.md`](docs/security/AUDIT-2026-10-14.md).

## 8. Compliance notes

- **Test money only**: Mock Bank balances and mTHB/mCNY tokens have no value; the chain is private
  and permissioned. No real bank credentials are ever requested (the UI says so on every bank screen).
- **Audit trail**: every lock, approval, delivery, release, payout and pause is a transaction or event
  on-chain, visible in the public explorer and through the read-only RPC.
- **Data minimisation (PDPA)**: only hashes and amounts go on-chain; personal data stays deletable.
- **Human in the loop**: committing money (Tier 1) always needs the user; the agent's own authority
  (Tier 2) is capped by the contract, not by the prompt.
