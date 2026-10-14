# Mock Bank sign-in and account API

For the frontend. Google / Apple sign-in is gone: everyone signs in through the **Mock Bank**
(Thailand → THB / mTHB, China → CNY / mCNY). Demo only: no real bank, no real money. Every bank
screen must show a "Demo bank — do not enter real credentials" banner.

All amounts are **strings in minor units** (satang / fen, 2 decimals): `"5000000"` = 50,000.00.
Errors are `{ "error": "..." }` for `/api/*` routes and `{ "code": "...", "message": "..." }` for
`/api/auth/*` routes.

## Sign-in flow (matches LoginScreen → BankAuthorizeScreen)

```ts
import { authClient } from "@/lib/auth-client";

// 1a. New tester: open a demo bank customer (gets two passbooks with opening money)
const { data, error } = await authClient.mockBank.register({
  bank: "thai",              // "thai" | "chinese"
  username: "gun",           // 3-32 of a-z 0-9 _ .   (unique per bank)
  displayName: "Gun",
  pin: "123456",             // exactly 6 digits, demo PIN only
  accountType: "personal",   // "personal" | "company" (optional, default personal)
});

// 1b. Returning tester: log in at the bank
const { data, error } = await authClient.mockBank.login({ bank: "thai", username: "gun", pin: "123456" });

// both return:
// { ticket, bank: { name, currency }, customer: { displayName, type },
//   accounts: [{ id, accountNo: "··4821", label, currency, balance, linked, isDefault }] }

// 2. Consent screen: the user ticks passbooks and the consent box
await authClient.mockBank.authorize({
  ticket: data.ticket,                 // single use, expires in 10 minutes
  accountIds: ["<id>", "<id>"],        // at least one
  defaultAccountId: "<id>",            // optional, must be one of accountIds
  consent: true,                       // must be literally true
});
// -> sets the session cookie; useSession() updates by itself
// returns { user: { id, name }, bank: { name, currency }, accounts: [...linked only] }

// Sign out (built in)
await authClient.signOut();
```

| error code | when | show |
|---|---|---|
| `USERNAME_TAKEN` (409) | register with a used username | "Username taken" |
| `INVALID_LOGIN` (401) | wrong username or PIN (never says which) | "Wrong username or PIN" |
| `LOCKED` (429) | 5 wrong PINs in a row → locked 15 minutes | the message |
| `TICKET_EXPIRED` (401) | ticket used twice or older than 10 minutes | send back to bank login |
| `VALIDATION_ERROR` (400) | bad input, e.g. PIN not 6 digits | the message |

## App API (needs the session cookie)

| method + path | what | response |
|---|---|---|
| `GET /api/me` | first call after sign-in | `{ user, bank: { name, currency, token, customerType, consentedAt }, accounts: [linked], wallets: [{ address, role, label, openProposals, createdAt }] }` |
| `DELETE /api/me` | PDPA delete: removes the user, unlinks the bank | `{ deleted: true }` |
| `GET /api/me/export` | PDPA export, downloads a JSON file | file |
| `GET /api/bank/accounts` | all the customer's passbooks (linked + unlinked) | `{ currency, accounts }` |
| `PUT /api/bank/accounts` | change linked accounts / default (consent again) | body `{ accountIds, defaultAccountId?, consent: true }` → `{ accounts }` |
| `GET /api/bank/accounts/:id/transactions?limit=30&cursor=` | statement of a linked account, newest first | `{ account, transactions: [{ id, kind, label, direction: "in"\|"out", amount, counterparty, txHash, explorer, createdAt }], nextCursor }` |
| `POST /api/workspace` | create the user's agent wallet in their currency | `{ address, outcome, units: { symbol, decimals }, bankAccountId }` |

Every existing `/api/workspace/:address/...` route now also returns `token: { symbol, decimals, currency }`
in the wallet state, and all amounts in it are already formatted for that token.

`401` = not signed in → go to the bank login. `403` = signed in without a bank (old account) → sign in again.

---

# Deals, approvals, policy, social, summary

All need the session cookie and an agent wallet (created by the first `/api/me` visit through the
app shell, or `POST /api/workspace`). Amounts in these responses are **decimal strings in the bank's
currency** (`"1000.00"` = ฿1,000.00), except `/api/summary`, which uses plain numbers.

## Deals (FileEscrow, paid just in time from the bank)

| method + path | what |
|---|---|
| `GET /api/deals` | `{ deals: [{ id, role: "buyer"\|"seller", counterparty, counterpartyLabel, title, total, status: "Proposed"\|"Active"\|"Cancelled", reviewHours, milestones: [{ index, amount, hasFile, status, deadline }] }], drafts: [open drafts] }` |
| `GET /api/deals/:id` | the deal plus `title, summary, demoSeller, canCancel`, and per milestone `name, acceptance, moves: ["approve"\|"dispute"\|"reclaim"]`, `deliverable` (demo file text + sha256 once the key is out) |
| `POST /api/deals/:id/action` | body `{ action: "approve"\|"dispute"\|"reclaim"\|"cancel", index }` → `{ tier: 1\|2, outcome }`. Approve uses the agent alone within its caps (Tier 2), else the owner's mandate (Tier 1) |

Milestone status: `Pending → Delivered → Approved → KeyReleased → Released`, or `Disputed` / `Refunded`.
`deadline` (unix seconds) ends the current window: the buyer's review while `Delivered`, the challenge
window while `KeyReleased`. The **demo contractor** (the only seller for now) accepts, delivers, releases
the key and claims by itself; payouts and refunds settle to the bank automatically. Poll `GET /api/deals/:id`
every few seconds to see it move.

Drafts: `GET /api/workspace/:address/drafts`, approve with `POST /api/workspace/:address/drafts/:id/approve`
(the chat's "Approve & lock").

## Approvals

`GET /api/approvals` → `{ count, drafts: [...], reviews: [{ dealId, title, index, amount, reviewUntil, tier }], groupVotes: [{ proposalId, group, title, yes }], proposals: [...] }` — use `count` for the sidebar badge.

## Policy

| method + path | what |
|---|---|
| `GET /api/policy` | `{ wallet, explorer, token, paused, threshold, session: { maxPerTx, dailyLimit, remainingToday, expiresAt, active }, recipients: [{ address, label, friendshipId, allowed }], escrows: { milestone, file }, tiers }` |
| `PUT /api/policy/limits` | body `{ maxPerTx, dailyLimit }` in the currency (max ฿10,000 / ฿100,000; ¥2,000 / ¥20,000) |
| `POST /api/policy/pause` | body `{ paused: true\|false, reason? }` — Tier 3 emergency stop / resume |
| `DELETE /api/policy/recipients` | body `{ address }` — remove a payee |

## Friends (same bank only)

| method + path | what |
|---|---|
| `GET /api/friends` | `{ friends: [{ friendshipId, userId, name, username, status: "PENDING"\|"ACCEPTED", direction: "incoming"\|"outgoing"\|"mutual", wallet, allowlisted }] }` |
| `POST /api/friends` | body `{ username }` — request (asking someone who asked you accepts) |
| `POST /api/friends/:friendshipId` | accept an incoming request |
| `DELETE /api/friends/:friendshipId` | decline / unfriend |
| `PUT /api/friends/:friendshipId/payee` | body `{ allowed }` — let the agent pay this friend (on-chain, Tier 1). Being friends alone never does this |

## Groups (shared decisions, no pooled money)

| method + path | what |
|---|---|
| `GET /api/groups` | `{ groups: [{ id, name, currency, threshold, members: [{ userId, name, role }], openProposals }] }` |
| `POST /api/groups` | body `{ name, memberIds: [friend userIds], threshold }` (N of M, creator included) |
| `GET /api/groups/:id` | group + `proposals: [{ id, title, milestones, status: "OPEN"\|"EXECUTED"\|"REJECTED"\|"FAILED", yes, no, myVote, dealId }]` |
| `POST /api/groups/:id/proposals` | body `{ draftId }` — put one of your drafts to the vote (your yes counts) |
| `POST /api/groups/proposals/:proposalId/vote` | body `{ approve }` — the vote reaching the threshold locks the deal from the proposer's bank |

## Summary (CFO)

| method + path | what |
|---|---|
| `GET /api/summary?from=2026-01-01&to=2027-01-01` | `{ currency, totals: { income, spent, refunds, net, openingDeposits }, months: [...], deals: [{ title, spent, refunded }], tax: { kind, year, income, taxable, tax, vatWarning, notes } \| null }` (Thai tax; null for CNY) |
| `POST /api/summary/ai` | body `{ lang: "en"\|"th" }` → `{ summary: "markdown bullets", numbers }`. The AI sees aggregates only |
| `GET /api/summary/export` | CSV download (Excel / Sheets) |
