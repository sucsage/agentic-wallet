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
