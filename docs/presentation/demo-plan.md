# Kravii: 5-minute demo plan

Target: hosted app https://agentic-wallet-inky.vercel.app (default; local stack fallback below). All test money. Record the screen; narrate live or add voice-over.

Status of the target: [VERIFY] health of the live app and the Besu PC (it runs on a home computer through Tailscale; if the PC is off, nothing transacts). Check on recording day, at least 1 hour before.

## Before recording (checklist)

1. Open the app in a clean browser profile. Confirm sign-up works (email sign-up, demo KYC approves at once).
2. Prepare two accounts: Buyer (A) and Seller (B), both with KYC done and wallets open. Top up A with test money.
3. Have the explorer open in a second tab: `/explorer`.
4. Have a terminal ready with `cast receipt <tx> --rpc-url https://agentic-wallet-inky.vercel.app/api/rpc` and one real hash from EVIDENCE.md.
5. Pick a tiny deal text and a small file (an image) to deliver. Keep the AI key working: the chat needs an LLM provider.
6. Disputes are OFF in the build. Do not demo a dispute.

## Run sheet

| Time | Screen | Action | Say |
|---|---|---|---|
| 0:00 to 0:30 | Dashboard (A) | Show wallet, balance, agent limits | "This is a Kravii wallet. The agent can only spend within these limits." |
| 0:30 to 1:30 | AI chat (A) | Type: hire B for a logo, 2 milestones, 500 THB each | "The agent drafts the deal. Nothing is signed yet." Show the preview card. |
| 1:30 to 2:15 | Deal draft | Press Approve and Lock | "Now my click signs one mandate. The bank is debited and the money locks in escrow." Open the explorer, show the lock transaction. |
| 2:15 to 3:15 | As B | Accept, deliver the file | "The seller delivers an encrypted file. Its hash is on chain." |
| 3:15 to 4:00 | As A | See watermarked preview, approve milestone 1 | "The key is released only after I approve." Show the seller's balance credited. |
| 4:00 to 4:45 | Terminal / explorer | Run the attack-refused hash with `cast receipt` | "I took the agent key and tried to send money to a stranger. The contract reverted: RecipientNotAllowed." |
| 4:45 to 5:00 | Desktop app | Brief shot of the Kravii desktop window with the same deal | "Same account, in the desktop app." |

## Fallbacks

- LLM down: skip the chat, use the Deals page to create the deal by hand. Say so.
- Besu PC off: use the Base Sepolia fallback if configured [VERIFY], otherwise show pre-recorded clips and the EVIDENCE.md hashes.
- Anything slow: cut the desktop shot first, then the delivery step (use a pre-delivered deal).

## Do not show

Real keys, `.env` files, the admin page, real personal data, or any dispute screen.
