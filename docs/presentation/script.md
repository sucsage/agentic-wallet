# Kravii (Agentic Wallet): 10-minute presentation script

FinTechathon 2026, International Track, Topic F (Agent Wallet). English narration, about 1,350 words (about 135 words per minute). Slide numbers match `slides-brief.md`.

Assumptions (owner did not answer, defaults taken 2026-10-19): English; product name "Kravii" with "formerly Agentic Wallet" once; security audit slide included, fixes described as "in review" until PR #5 is merged; live demo on the hosted app.

Marks: [FACT] stated in the repo docs or proven by CI; [VERIFY] check before recording.

---

## Slide 1: Title (0:00 to 0:30)

Hello, we are team Kravii, formerly called Agentic Wallet. We built a wallet that an AI agent can run, and that still cannot lose your money, even if the agent is fooled. This is our entry for Topic F, Agent Wallet. In the next ten minutes: the problem, how the design works, how a payment flows, what we did to test it, and where it is still weak.

## Slide 2: The problem (0:30 to 1:30)

Small businesses pay contractors in stages: a deposit, a delivery, an acceptance test, a retention payment. Today that is trust, chat messages and bank transfers. Disputes are slow, and the buyer often pays before seeing the work.

AI agents could do this paperwork for us. But an agent that can move money is dangerous. It can be prompt-injected by a document, it can hallucinate an amount, and its key can leak. If the safety rules live in the agent's prompt, one clever message breaks them.

So the question for this topic is: how do you let an agent act, while the rules are enforced by something the agent cannot talk its way past?

## Slide 3: Our answer, three layers of authority (1:30 to 2:45)

The user owns the wallet. The agent only holds a session key. The contract decides.

The session key is scoped: it expires, it has a per-transaction cap and a daily cap, and it can pay only addresses on an allowlist. The owner key never goes to the agent. Anything outside those limits needs the user's own click.

We call the actions tiers. Tier 0, read. Tier 1, the agent proposes and a human approves. Tier 2, the agent acts alone, but only inside the on-chain caps. Tier 3, emergency: the agent, an approver or the owner can pause the wallet, and only the owner can unpause. [FACT: SECURITY.md section 2]

The point: a manipulated agent can be wrong, but it cannot be wrong with more money than the contract allows.

## Slide 4: Architecture (2:45 to 3:45)

Here is the system. The user talks to an AI chat in the web app or in our desktop app. The agent has tools, and every tool call passes Guard 1, an off-chain policy engine that routes by tier, scans for injection and checks the allowlist.

Then Guard 2: the AgentWallet smart contract, one per user, which checks the same rules again on chain. A bug or jailbreak can get past Guard 1, but the contract still refuses.

Money in the real world is a simulated bank ledger in Postgres. When a deal is approved, the server debits the bank, mints a bank-backed token for exactly that amount, and locks it in an escrow contract. When the escrow pays out, the seller's bank is credited. The chain is a private Hyperledger Besu network. Only our app can write, but anyone can read it through a public explorer. [FACT: TECHNICAL.md section 1]

## Slide 5: How a deal flows (3:45 to 5:00)

A buyer tells the agent: hire this designer, three milestones. The agent drafts the deal. Nothing is signed, and no money moves, until the buyer presses Approve and Lock.

Then the FileEscrow contract runs a fair exchange between strangers. The seller delivers an encrypted file, and its hash is recorded on chain. The buyer sees a watermarked preview. The key is released only after the buyer approves, or after the review window ends. Then the escrow pays the seller, and the seller's bank account is credited.

People without an account can join through a private link, protected by a one-time code and a password. A seller's payout destination is set once and then locked, so a leaked link cannot redirect money. [FACT: SECURITY.md R3]

## Slide 6: Proof the guard works (5:00 to 6:15)

Here is the strongest evidence. We took the agent's own key and called a transfer to a random address, skipping the AI and the policy engine entirely. The contract reverted it with RecipientNotAllowed. This is a real transaction on our chain, and you can check it yourself with one command against our read-only RPC. [FACT: EVIDENCE.md, "Attack refused on-chain"]

We also fixed an early bug where the agent could approve a file twice and skip the challenge window. Now the contract lets the agent approve only a delivered milestone. [FACT: SECURITY.md DC-H-01]

## Slide 7: What we built around it (6:15 to 7:15)

The product is more than a contract. There is a desktop app for Windows and macOS, version 0.6.3, with its own signed chain of deals per device, an AI chat with web search, and MCP tools. There are company accounts where a group of signers controls the money, group payouts by vote, national-ID style KYC, top-ups by PromptPay and card in test mode, split payment, public job links where anyone can apply, and a neutral AI arbiter built from several models from different providers. [FACT: TECHNICAL.md section 3]

Everything runs on test money. No real funds or bank accounts are involved.

## Slide 8: How we tested security (7:15 to 8:45)

One team member took the role of security reviewer and attacked the system, rather than only reading it. The method: write a test that reproduces the bug first, then fix it.

Results: 115 contract tests including property tests that try every move on every state of an escrow; 15 web security tests; and a 22-step end-to-end smoke test that runs the main money flow on a throwaway stack. All of it runs in continuous integration on GitHub. [FACT: CI green on PR #5, 2026-10-18]

What it found: a High bug where a refund paid twice after a split ruling; a High bug where a company member who was not a signer could spend the company's money; and a silent arbiter who could lock money forever, for which we added a seven-day timeout. These fixes are in a pull request awaiting merge. [VERIFY merged or not before recording]

We also found that one desktop route could add a payee without a signer check. We recorded it and it is open. [FACT: bug DC-CO-04, code-read, not yet reproduced. Say "found in review" not "exploited".]

## Slide 9: Known risks and what is next (8:45 to 9:30)

We want to be honest about limits. In the demo, the server holds the owner keys. Production needs keys on the user's device or a multisig. The chain has one validator on a home computer. Production needs several, run by different parties. Disputes are switched off in the current build, so a buyer's protection against bad work is not approving, and a timeout that refunds a silent seller is the proposed fix. Desktop builds are unsigned, so updates need real code signing. All of these are written down in our security document as risks R1 to R15. [FACT: SECURITY.md section 7]

## Slide 10: Close (9:30 to 10:00)

To recap: the agent proposes, the user approves, and the contract enforces. The rules do not live in a prompt. They live where the agent cannot argue with them. Everything you saw is on a public chain you can check yourself. Thank you. The app, the explorer and the evidence are linked on this slide.

---

## Notes for recording

- Total 10:00. If over, cut slide 7 to 30 seconds (list only).
- Do not say "audited by a third party". The audit was internal.
- Do not claim the live app is healthy until checked on recording day. [VERIFY]
- Do not mention the crypto pivot unless the team has decided it. If contracts are removed, slides 3 to 6 need rewriting. Todo #19.
