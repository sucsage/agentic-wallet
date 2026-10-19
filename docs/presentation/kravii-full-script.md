# Kravii: full script (10 minutes)

## Slide 1: Title (0:30)

Hello, we are team Kravii, We built a wallet that an AI agent can run, and that still cannot lose your money, even if the agent is fooled. This is our entry for Topic F, Agent Wallet. The agent proposes, the user approves, the contract enforces. In the next ten minutes: the problem, how the design works, how a payment flows, how we tested it, and where it is still weak.

## Slide 2: The problem (1:00)

Small businesses pay contractors in stages: a deposit, a delivery, an acceptance test, a retention payment. Today that is trust, chat messages and bank transfers. Disputes are slow, and the buyer often pays before seeing the work.

AI agents could do this paperwork for us. But an agent that can move money is dangerous. It can be prompt-injected by a document, it can hallucinate an amount, and its key can leak. If the safety rules live in the agent's prompt, one clever message breaks them.

So the question for this topic is: how do you let an agent act, while the rules are enforced by something the agent cannot talk its way past?

## Slide 3: Three layers of authority (1:15)

The user owns the wallet. The agent only holds a session key. The contract decides.

The session key is scoped: it expires, it has a per-transaction cap and a daily cap, and it can pay only addresses on an allowlist. The owner key never goes to the agent. Anything outside those limits needs the user's own click.

We call the actions tiers. Tier 0, read. Tier 1, the agent proposes and a human approves. Tier 2, the agent acts alone, but only inside the on-chain caps. Tier 3, emergency: the agent, an approver or the owner can pause the wallet, and only the owner can unpause.

The point: a manipulated agent can be wrong, but it cannot be wrong with more money than the contract allows.

## Slide 4: Architecture (1:00)

Here is the system. The user talks to an AI chat, in the web app or in our desktop app. The agent has tools, and every tool call passes Guard 1, an off-chain policy engine that routes by tier, scans for injection and checks the allowlist.

Then Guard 2: the AgentWallet smart contract, one per user, which checks the same rules again on chain. A bug or a jailbreak can get past Guard 1, but the contract still refuses.

Money in the real world is a simulated bank ledger. When a deal is approved, the server debits the bank, mints a bank-backed token for exactly that amount, and locks it in an escrow contract. When the escrow pays out, the seller's bank is credited. The chain is a private Hyperledger Besu network. Only our app can write to it, but anyone can read it through a public explorer.

## Slide 5: A deal, step by step (1:15)

A buyer tells the agent: hire this designer, three milestones. The agent drafts the deal. Nothing is signed, and no money moves, until the buyer presses Approve and Lock.

Then the escrow contract runs a fair exchange between strangers. The seller delivers an encrypted file, and its hash is recorded on chain. The buyer sees a watermarked preview. The key is released only after the buyer approves, or after the review window ends. Then the escrow pays the seller, and the seller's bank account is credited.

People without an account can join through a private link, protected by a one-time code and a password. A seller's payout destination is set once and then locked, so a leaked link cannot redirect money.

## Slide 6: Proof, the on-chain refusal (1:15)

Here is the strongest evidence. We took the agent's own key and tried to send money to a random address, skipping the AI and the policy engine entirely. The contract reverted it, because that address is not on the allowlist. This is a real transaction on our chain, and you can check it yourself with one command against our read-only RPC.

We also fixed an early bug where the agent could approve a file twice and skip the challenge window. Now the contract lets the agent approve only a delivered milestone.

## Slide 7: Built around the core (1:00)

The product is more than a contract. There is a desktop app for Windows and macOS, version 0.6.3, with its own signed chain of deals per device, an AI chat with web search, and MCP tools. There are company accounts where a group of signers controls the money, group payouts by vote, national-ID style KYC, top-ups by PromptPay and card in test mode, split payment, public job links where anyone can apply, and a neutral AI arbiter built from several models from different providers.

Everything runs on test money. No real funds or bank accounts are involved.

## Slide 8: How we tested it (1:30)

One team member took the role of security reviewer and attacked the system, rather than only reading it. The method: write a test that reproduces the bug first, then fix it.

The results: 115 contract tests, including property tests that try every move on every state of an escrow; 15 web security tests; and a 22-step end-to-end smoke test that runs the main money flow on a throwaway stack. All of it runs in continuous integration on GitHub.

What it found: a High-severity bug where a refund paid twice after a split ruling; a High-severity bug where a company member who was not a signer could spend the company's money; and a silent arbiter who could lock money forever, for which we added a seven-day timeout. These fixes are in a pull request awaiting merge.

We also found, in code review, that one desktop route could add a payee without a signer check. We did not exploit it. It is recorded as open.

## Slide 9: Known risks and next steps (0:45)

We want to be honest about the limits. In the demo, the server holds the owner keys. Production needs keys on the user's device, or a multisig. The chain has one validator, on a home computer. Production needs several, run by different parties. Disputes are switched off in the current build, so a buyer's protection against bad work is not approving, and a timeout that refunds a silent seller is the proposed fix. Desktop builds are unsigned, so updates need real code signing. All of these are written down in our security document as risks R1 to R15.

## Slide 10: Close (0:30)

To recap: the agent proposes, the user approves, and the contract enforces. The rules do not live in a prompt. They live where the agent cannot argue with them. Everything you saw is on a public chain you can check yourself. Thank you. The app, the explorer and the evidence are linked on this slide.
