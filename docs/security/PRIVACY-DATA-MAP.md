# Privacy and data map (PDPA / PIPL)

Basis: code read at `origin/main` `156d6b7` (2026-10-15): `web/prisma/schema.prisma`, `web/src/app/api/me/`,
`web/src/lib/bank/`, the contracts. Nothing was run against a live database or chain. This is the content for the
privacy section of `SECURITY.md`, plus the gaps found while writing it.

## 1. What is stored, where, for how long, and who can read it

| Data | Where | Why | Who can access | Deleted when the user deletes their account? | In the data export? |
|---|---|---|---|---|---|
| Name, email, session tokens, IP address, user agent | Postgres: `User`, `Session`, `Account` | Sign-in | The user; the operator (database) | Yes (cascade) | Name only; not sessions or IP |
| Language, phone (optional) | Postgres: `Profile` | UI, contact | The user; the operator | Yes (cascade) | Yes |
| Bank username, display name, hashed PIN, failed-PIN count | Postgres: `BankCustomer` | Mock Bank login | The user; the operator | **No.** The row stays, only the link to the user is cleared (the code says the bank is a separate party) | Username and display name |
| Bank accounts, balances, transfers | Postgres: `BankAccount`, `BankTransfer` | Ledger | The user; the operator | Accounts are unlinked, not deleted. Transfers stay | Linked accounts and their transfers |
| Deal drafts: title, summary, milestones | Postgres: `DealDraft` | Chat-to-deal | The user; group members for group drafts | Yes (cascade) | **No** |
| Friends, groups, votes | Postgres: `Friendship`, `Group*` | Social features | The users involved | Friendships and memberships: yes (cascade). A group's own row and proposals follow their group | **No** |
| Seller's delivery: note, file name, encrypted file, file key | Postgres: `DealDelivery` | Delivery and dispute | Buyer after key release; arbiter; the operator (the server holds the file key) | **No.** The table has no link to the user | **No** |
| Dispute reason, AI findings, rationale | Postgres: `DealDispute` | Arbitration | Both parties; admin arbiter | **No.** No link to the user | **No** |
| Invited seller: name, payout method, PromptPay id or bank account, payout name | Postgres: `SellerInvite` | Pay sellers without an account | The inviting buyer; the operator | **No.** The invite is tied to the buyer only by a plain id, with no cascade | **No** |
| Chain mirror: wallet events, legacy proposals incl. `reason` text | Postgres: `Event`, `Proposal`, `Wallet` | Audit log, UI | The user's wallet owner; the operator | **No** (keyed by wallet address) | Wallet links only |
| Deal state, amounts, addresses, hashes, call data | The chain (public, permanent) | Escrow and audit | Anyone | **Cannot be deleted** | n/a |

Retention: no retention period or purge job exists in the code (searched for TTL, purge, cleanup). Data stays until the user deletes
the account, and the tables marked "No" survive even then.

## 2. What goes on chain

- **Main flow (FileEscrow):** amounts, wallet addresses, `sha256` of the agreed terms (`termsURI = sha256:<hash>`), a work hash,
  an opaque delivery id (`app-delivery:<id>`), and the file key encrypted to the buyer (`encryptedKey`). No names or free text. `[code-read]`
- **Legacy flow (MilestoneEscrow tools in `web/src/lib/actions.ts`):** the deal terms and evidence text are written as `data:` URIs
  (`toDataUri(terms)`, `toDataUri({...doc, text})`) and proposal `reason` text is stored on chain. This can contain a PO number, a job
  title and a summary. It is permanent and public. `[code-read]`
- Wallet addresses are pseudonymous but, with the public explorer, link a user's activity together.

## 3. Gaps found (to fix or to disclose)

| # | Gap | Evidence | Suggested change |
|---|---|---|---|
| P1 | Account deletion leaves delivery notes and files, dispute text, invited sellers' payout details and the bank customer row | `DELETE /api/me` removes only user-linked tables; `DealDelivery`, `DealDispute`, `SellerInvite` have no relation to `User`. Confirmed against a real database in `web/scripts/security/web-security.test.mts` (deleting the user row leaves all three) | Delete or anonymise those rows for the user's deals; or state clearly what survives and why |
| P2 | The data export leaves out drafts, friends, groups, deliveries, disputes and invites | `web/src/app/api/me/export/route.ts` | Add them, or narrow the claim to "profile, wallets and bank data" |
| P3 | Free text can reach the chain on the legacy path | `actions.ts:105,236` | Hash on chain, store the text off chain as in the FileEscrow flow; or disable the legacy tools |
| P4 | The server holds delivery file keys | `DealDelivery.fileKey`, `SECURITY.md` R2 | Disclose (already in R2); the PDF's "key never touches the server" is not what is built |
| P5 | No retention rule | no purge code | Define one (for example drafts 90 days, sessions on expiry) or state "kept until deletion" |
| P6 | IP address and user agent are stored with sessions | schema `Session.ipAddress`, `userAgent` | List them in the privacy notice |

## 4. Text for `SECURITY.md`, section "Privacy" (ready to paste)

> **Privacy (PDPA / PIPL).** The app stores the following in Postgres: sign-in data (name, email, sessions with IP address and user
> agent), an optional profile, the Mock Bank customer record and ledger, deal drafts, friends and groups, delivered work (notes, file
> name and the encrypted file), dispute reasons and rulings, and payout details of invited sellers. Delivered files are encrypted at
> rest; in this demo the server holds the file keys. Users can download their profile, wallet and bank data and delete their account
> from the profile page. Deleting the account removes the user, profile, sessions, drafts, friendships and wallet links and withdraws
> the bank consent. Delivery records, dispute records, invited-seller payout details, the Mock Bank customer record and the ledger are
> kept and are not yet covered by the export or the deletion; these are listed as known gaps. No retention period is enforced yet.
> The chain holds amounts, addresses, hashes and encrypted keys, which cannot be deleted. In the main file-exchange flow no free text
> is written on chain; the legacy milestone tools can still write deal text on chain and are not recommended for personal data.
