# Kravii: 5-minute demo guide

Story in one line: a buyer asks the AI to hire a seller; the AI only drafts; the buyer's click locks the money; the seller delivers; the buyer approves; the seller is paid; then we show the contract refusing the agent's own key.

Example used: Buyer "A" hires Seller "B" for a logo, 2 milestones, 500 THB each. Test money only.

## Before you start (do this 1 hour earlier)

1. Open https://agentic-wallet-inky.vercel.app in a clean browser profile. Confirm the page loads and sign-up works.
2. Two accounts ready, both with KYC done and a wallet open: Buyer A and Seller B (use two browser profiles, or one normal and one private window, so you can switch without signing out).
3. Top up Buyer A with test money (Top up on the dashboard). Check the balance covers 1,000 THB.
4. Explorer tab open: /explorer.
5. Terminal ready with the refusal command (see step 7) and the full hash from EVIDENCE.md.
6. A small file to deliver (a logo image).
7. Do one full dry run. Disputes are off in this build, so do not demo them.
8. Confirm the AI chat answers (it needs an LLM key). If it does not, use the fallback at the bottom.

Button names below come from the code on main. Check them against the screen on the day.

## The flow at a glance

| # | Time | Who | What happens |
|---|---|---|---|
| 1 | 0:00 | A | Show the wallet and the agent's limits |
| 2 | 0:30 | A | Ask the AI to draft the deal |
| 3 | 1:15 | A | Approve & lock |
| 4 | 2:00 | B | Accept the offer, deliver the work |
| 5 | 2:50 | A | Preview, approve, seller is paid |
| 6 | 3:40 | A | Show it on the explorer |
| 7 | 4:10 | terminal | The agent's own key is refused |
| 8 | 4:50 | - | One-line close |

## Steps (what to click, what to say)

### 1. The wallet and its limits (0:00 to 0:30). Buyer A

- Click: open the dashboard. Point at the balance and the agent's limits (per-transaction cap, daily cap, allowed recipients).
- Say: "This is a Kravii wallet. The AI agent can spend only inside these limits. The owner key is not with the agent."
- Must show: the limits on screen.

### 2. Ask the AI to draft the deal (0:30 to 1:15). Buyer A

- Click: open the AI chat.
- Type: "Hire B to design a logo. Two milestones: sketch, 500 THB, and final files, 500 THB."
- Wait for the draft card (the agent calls its propose-deal tool and saves a draft).
- Say: "The agent only drafts. Nothing is signed. No money has moved."
- Must show: the preview card with amounts and milestones, and that the balance has not changed.

### 3. Approve & lock (1:15 to 2:00). Buyer A

- Click: Approve & lock on the draft.
- Say: "Now my click signs one instruction. The bank is debited and exactly that amount is locked in escrow."
- Must show: balance drops, deal status shows locked or waiting for the seller.
- Repeat: "Nothing moves before Approve and Lock."

### 4. Seller accepts and delivers (2:00 to 2:50). Seller B

- Switch to B's window. Open Deals.
- Click: accept the offer. Then deliver the work for milestone 1, attach the logo file, submit.
- Say: "The seller delivers an encrypted file. Its hash is recorded on chain, so it cannot be swapped later."
- Must show: status changes to delivered.

### 5. Preview, approve, paid (2:50 to 3:40). Buyer A

- Switch to A. Open the deal. Show the watermarked preview.
- Click: approve milestone 1.
- Say: "I only get the key after I approve. Now the escrow pays the seller."
- Must show: switch to B, the balance went up by 500.

### 6. Show it on chain (3:40 to 4:10)

- Click: explorer tab. Open the latest transaction of the deal.
- Say: "Every step is a public transaction. Anyone can read it."
- Must show: one transaction page with a block number.

### 7. The agent's own key is refused (4:10 to 4:50). Terminal

- Run (replace with the full hash from EVIDENCE.md, section "Attack refused on-chain"):

```text
cast receipt 0x7f47a0c19501d7f7ae5f19863e99009eef2b3cb2c2365939d360e9c4011f3191 --rpc-url https://agentic-wallet-inky.vercel.app/api/rpc
```

- Say: "This is the agent's own key trying to pay a stranger, skipping the AI and the policy engine. The contract reverted it."
- Must show: the receipt with status 0 (failed).
- Do not claim the error name unless it is shown on screen.

### 8. Close (4:50 to 5:00)

- Say: "The agent proposed, I approved, the contract enforced."

## Fallbacks

- AI chat down: create the deal on the Deals page by hand, and say so. Skip step 2's typing.
- Seller delivery slow: use a deal you already delivered in a dry run, and say "this one was delivered earlier".
- Chain unreachable (the chain runs on a home PC): show pre-recorded clips and the transaction pages in EVIDENCE.md. Do not claim it is live.
- Over time: skip step 6, never skip step 7.

## Do not show

Keys, `.env`, the admin page, real personal data, any dispute screen.

## Not verified

I have not run this flow. The button names come from reading the code, the timings are estimates, and the live app and the chain have not been checked. Do a dry run before recording.
