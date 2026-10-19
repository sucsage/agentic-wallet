# Kravii: full script (10 minutes, about 1,500 words)

Read at a calm pace, about 150 words a minute. Pause at every slide change. Timings in brackets.

## Slide 1: Title (0:00 to 0:35)

Hello everyone, and thank you for having us. We are team Kravii, and this is our entry for Topic F, Agent Wallet.

Here is what we built in one sentence: a wallet that an AI agent can run for you, and that still cannot lose your money, even if the agent is fooled.

If you remember one line from today, let it be this one: the agent proposes, the user approves, the contract enforces.

In the next ten minutes we will show you the problem, how the design works, how a deal flows from start to payment, how we tested it, and where we are going next. After that, we will show it running live.

## Slide 2: The problem (0:35 to 1:35)

Let's start with a very ordinary situation. A small business hires a designer, a developer, a contractor. The work is paid in stages: a deposit, a delivery, an acceptance check, a final payment. Today that runs on trust, chat messages and bank transfers. Somebody always has to go first. Either the buyer pays before seeing any work, or the seller works before seeing any money.

AI agents are a natural fit for this paperwork. They can read the brief, draft the terms, track the milestones and make the payments. But the moment you give an agent the power to move money, you have a new problem. An agent can be tricked by a sentence hidden in a document. It can misread an amount. Its key can leak.

And if the safety rules live inside the agent's prompt, then one clever message can talk the agent out of them.

So the real question for this topic is: how do you let an agent do real work with real money, while the rules are enforced by something the agent cannot argue with?

## Slide 3: Three layers of authority (1:35 to 2:50)

Our answer is to take the rules out of the agent completely. We use three layers.

First, the user owns the wallet. The owner key never goes to the agent.

Second, the agent holds only a session key. That key is scoped. It expires. It has a limit per transaction and a limit per day. And it can pay only addresses on an allowlist the user has approved. The user can revoke it instantly.

Third, the contract decides. Every one of those limits is checked by the smart contract itself, not just by our software.

On top of this we defined four tiers of action. Tier 0 is read-only: balances, deals, history. Tier 1 is propose: the agent drafts something and a human has to approve it. Tier 2 is automatic, but only inside the on-chain caps. And Tier 3 is the emergency stop: the agent, an approver or the owner can pause the wallet at any time, and only the owner can unpause it.

What this gives you is simple. A manipulated agent can still be wrong, but it can never be wrong with more money than the contract allows.

## Slide 4: Architecture (2:50 to 3:50)

Here is how the pieces fit together. The user talks to an AI chat, in the web app or in our desktop app. The agent has tools, and every tool call goes through two guards.

Guard 1 is an off-chain policy engine. It routes each action to the right tier, scans documents for injection attempts, and checks the allowlist and the caps.

Guard 2 is the AgentWallet smart contract, one per user. It checks the same rules again, on chain. So even if there were a bug, or a clever jailbreak that got past Guard 1, the contract still says no.

Money moves like this. The buyer's bank balance is debited. A bank-backed token is minted for exactly that amount. The tokens are locked in an escrow contract. When the escrow pays out, the seller's bank account is credited. In our prototype the bank is simulated, so everything runs on test money.

The chain is a private Hyperledger Besu network. Only our application can write to it, but anyone can read it, through a public explorer and a read-only RPC. That matters, because it means you do not have to trust us. You can check.

## Slide 5: A deal, step by step (3:50 to 5:05)

Let's follow one deal. A buyer tells the agent: hire this designer, two milestones, five hundred baht each. The agent drafts the deal, with the terms, the milestones and the amounts. At this point nothing is signed and no money has moved.

Then the buyer presses Approve and Lock. That one click signs a single instruction, and the escrow locks exactly that money.

The seller delivers the work. The file is encrypted, and its hash is recorded on chain, so it cannot be swapped later. The buyer receives a watermarked preview. The key is released only after the buyer approves, or when the agreed review window ends. Then the escrow pays the seller, and the seller's bank account is credited.

We also thought about people who do not have an account. A seller can join through a private link protected by a one-time code and a password. And the seller's payout destination is set once and then locked, so even a leaked link cannot redirect the money.

## Slide 6: Proof, the on-chain refusal (5:05 to 6:10)

Now, a design is only worth something if it holds under attack. So here is the test we are proudest of.

We took the agent's own key and tried to send money to a random address, skipping the AI and skipping the policy engine completely. The contract refused. The transaction reverted, because that address is not on the allowlist.

This is not a mock-up. It is a real transaction on our chain. You can open it in the public explorer, or check it yourself with a single command against our read-only RPC. We list it, with the other transaction hashes, in our evidence document.

This is exactly what we mean by the contract enforces. The agent can be fooled, and the money is still safe.

## Slide 7: Built around the core (6:10 to 7:25)

The contract is the heart of Kravii, but we wanted it to be a product people could actually use.

There is a desktop app for Windows and macOS. Each device keeps its own signed chain of deals, linked to the other party's and anchored on chain. It has an AI chat with web search, tools through MCP, and in-app updates.

There are company accounts, where a group of signers controls the money, and group wallets with payouts by vote, for things like salaries and reimbursements.

There is identity check with a national digital ID, top-ups by PromptPay and by card in test mode, and split payment, where every part is paid before anything is locked or delivered.

There are public job links, where anyone can apply with a proposal, and the AI helps the owner compare the applicants. There are protected links, guarantors, agreed rounds of changes, and deal templates. And we designed a neutral arbiter, a panel of models from different providers, for the day disputes are switched on.

All of it runs on test money in this prototype.

## Slide 8: How we tested it (7:25 to 8:50)

Security is thirty percent of the score, and it is also the reason this project exists, so we treated testing as a feature.

One of us took the role of security reviewer and attacked the system, instead of only reading it. The method was simple: write a test that reproduces the problem first, then fix it, so the fix is proven.

The result is a test suite you can run yourself. There are one hundred and fifteen contract tests, including property tests that try every move in every state of an escrow. There are fifteen web security tests. And there is a twenty-two-step end-to-end smoke test that runs the main money flow, from sign-up to payment, on a throwaway stack.

All of it runs automatically in continuous integration on GitHub, on every change.

The internal audit is written down in our security folder, with each finding, its severity and its status. So the team, and you, can see exactly what was checked and what was changed.

## Slide 9: Where we are going (8:50 to 9:35)

We want to be clear about what this is: a working prototype on test money, built in a short time. And we have a clear path to production.

Today the server holds the owner keys, to keep the demo simple. The next step is to move the keys to the user's own device, or to a multi-signature wallet. Today the chain runs on one validator. The next step is several validators, run by different parties. We also plan code-signed desktop builds, an external audit, and live payment partners in place of test mode.

All of these are documented, with the reasoning, in our security document.

## Slide 10: Close (9:35 to 10:00)

To bring it together. Kravii lets an AI agent do real work with money, because the rules do not live in a prompt. They live where the agent cannot argue with them.

The agent proposes. The user approves. The contract enforces.

Everything you have seen is on a public chain that you can check yourself, and the app, the explorer and the evidence are linked on this slide.

Thank you. And now, let us show you how it works live.
