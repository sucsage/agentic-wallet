# Kravii: full script (11 slides, about 10 minutes, about 1,500 words)

Matches the Canva deck exported on 2026-10-20 (11 slides). Read at a calm pace, about 150 words a minute. Pause at every slide change.

## Slide 1: Title (0:00 to 0:30)

Hello everyone, and thank you for having us. We are team Kravii, formerly called Agentic Wallet, and this is our entry for Topic F, Agent Wallet.

In one sentence: we built a wallet that an AI agent can run for you, and that still cannot lose your money, even if the agent is fooled.

If you remember one line from today, let it be this one: the agent proposes, the user approves, the contract enforces. Then we will show it running live.

## Slide 2: The problem (0:30 to 1:25)

Take a very ordinary situation. A small business hires a designer, a developer, a contractor. The work is paid in stages: a deposit, a delivery, an acceptance check, a final payment. Today that runs on trust, chat messages and bank transfers. Somebody always has to go first. Either the buyer pays before seeing any work, or the seller works before seeing any money.

AI agents are a natural fit for this paperwork. They can read the brief, draft the terms and track the milestones. But the moment an agent can move money, there is a new risk. It can be tricked by a sentence hidden in a document. It can misread an amount. Its key can leak. And if the safety rules live inside the prompt, one clever message can talk the agent out of them.

So the question is: how do you let an agent do real work with real money, while the rules are enforced by something the agent cannot argue with?

## Slide 3: Three layers of authority (1:25 to 2:35)

Our answer is to take the rules out of the agent completely, with three layers.

First, the user owns the wallet. The owner key never goes to the agent.

Second, the agent holds only a session key. It is scoped: it expires, it has a limit per transaction and a limit per day, and it can pay only addresses on an allowlist. The user can revoke it instantly.

Third, the contract decides. Every one of those limits is checked by the smart contract itself.

We defined four tiers of action. Tier 0 is read-only. Tier 1 is propose: the agent drafts and a human approves. Tier 2 is automatic, but only inside the on-chain caps. Tier 3 is the emergency stop: the agent, an approver or the owner can pause the wallet, and only the owner can unpause it.

So a manipulated agent can still be wrong, but it can never be wrong with more money than the contract allows.

## Slide 4: Architecture (2:35 to 3:30)

Here is how the pieces fit. The user talks to an AI chat, on the web or in our desktop app. Every action the agent takes passes two guards.

Guard 1 is an off-chain policy engine. It routes each action to the right tier, scans for injection attempts, and checks the allowlist and the caps.

Guard 2 is the AgentWallet smart contract, one per user. It checks the same rules again, on chain. Even if a clever jailbreak got past Guard 1, the contract still says no.

Money moves like this: the buyer's bank balance is debited, a bank-backed token is minted for exactly that amount, and it is locked in an escrow contract. When the escrow pays out, the seller's bank is credited. The bank is simulated in this prototype, so everything is test money.

The chain is a private Hyperledger Besu network. Only our app can write to it, but anyone can read it. You do not have to trust us. You can check.

## Slide 5: A deal, step by step (3:30 to 4:35)

Let's follow one deal. A buyer tells the agent: hire this designer, two milestones, five hundred baht each. The agent drafts the deal. Nothing is signed and no money has moved.

Then the buyer presses Approve and Lock. That one click signs a single instruction, and the escrow locks exactly that money. No money moves before Approve and Lock.

The seller delivers the work. The file is encrypted and its hash is recorded on chain, so it cannot be swapped later. The buyer sees a watermarked preview, and the key is released only after the buyer approves. Then the escrow pays the seller.

People without an account can join through a private link protected by a one-time code and a password, and the payout destination is set once and then locked, so a leaked link cannot redirect money.

## Slide 6: Proof, the on-chain refusal (4:35 to 5:35)

A design is only worth something if it holds under attack. So here is the test we are proudest of.

We took the agent's own key and tried to send money to a random address, skipping the AI and the policy engine completely. On the right is the real transaction page from our explorer: the status says reverted, the sender is the agent key, and the call is the agent wallet's transfer. The contract refused, because that address is not on the allowlist.

This is not a mock-up. You can open it in the public explorer, or check it with the single command on the left against our read-only RPC. It is listed with our other transaction hashes in the evidence document.

This is what we mean by the contract enforces. The agent can be fooled, and the money is still safe.

## Slide 7: One agent, three ways in (5:35 to 6:45)

Now let's look at the AI itself. The agent has three ways in, and each one is designed so that the AI never carries the safety on its own.

The first is the system prompt. It sets the role, not the limits. The agent acts for the buyer and turns a brief or a quotation into a milestone deal. It asks for what is missing and never invents an amount. Documents, files and tool results are treated as untrusted data, never as instructions. And if it sees a fraud signal, it refuses, explains the red flags, and may pause the wallet.

The second is tools. These are typed calls with strict schemas: about twenty of them, to draft a deal, change an offer, make a group payment, open a call for applicants, rank the applicants, or explain the app. In a baht wallet, no tool moves money on its own. Each one shows a preview, and the user presses Confirm. Every result still goes through Guard 1 and the contract.

The third is MCP, in both directions, on the desktop. Kravii is an MCP server, so Claude, Cursor and other AI apps can read the wallet and request a deal, and the user approves it inside Kravii. And Kravii is an MCP client, so our chat can use the user's own MCP servers and web search, asked before each call, with outside results treated as untrusted.

The prompt can be talked around. The tools and the contract cannot.

## Slide 8: Built around the core (6:45 to 7:40)

The contract is the heart of Kravii, but we wanted it to be something people can actually use.

There is a desktop app for Windows and macOS. Each device keeps its own signed chain of deals, linked to the other party's and anchored on chain. There are company accounts, where a group of signers controls the money, and group payouts by vote, for things like salaries and reimbursements.

There is identity check with a national digital ID, and top-ups by PromptPay and by card in test mode. There is split payment, where every part is paid before anything is locked or delivered. There are public job links, where anyone can apply and the AI helps compare the applicants. And we designed a neutral arbiter, a panel of models from different providers, for the day disputes are switched on.

All of it runs on test money in this prototype.

## Slide 9: How we tested it (7:40 to 8:45)

Security is a large part of the score, and it is the reason this project exists, so we treated testing as a feature.

One of us took the role of security reviewer and attacked the system, instead of only reading it. The method: write a test that reproduces the problem first, then fix it, so the fix is proven.

The result is a test suite you can run yourself. One hundred and fifteen contract tests, including property tests that try every move in every state of an escrow. Fifteen web security tests. And a twenty-two-step end-to-end smoke test that runs the main money flow on a throwaway stack. All of it runs automatically in continuous integration on GitHub.

The internal audit is written down in our security folder, with each finding, its severity and its status.

## Slide 10: Where we are going (8:45 to 9:25)

We want to be clear about what this is: a working prototype on test money, built in a short time, with a clear path to production.

Today the server holds the owner keys to keep the demo simple. The next step is keys on the user's own device, or a multi-signature wallet. Today the chain has one validator. The next step is several validators run by different parties. We also plan code-signed desktop builds, an external audit, and live payment partners in place of test mode. All of this is documented in our security document.

## Slide 11: Close (9:25 to 10:00)

To bring it together. Kravii lets an AI agent do real work with money, because the rules do not live in a prompt. They live where the agent cannot argue with them.

The agent proposes. The user approves. The contract enforces.

Everything you have seen is on a public chain that you can check yourself. The app, the explorer and the evidence are linked on this slide.

Thank you. And now, let us show you how it works live.
