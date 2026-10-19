# Kravii cue cards (10 min)

Exact words only where marked EXACT. Everything else: improvise from the bullets.

1. TITLE (0:30)
- Kravii, formerly Agentic Wallet
- A wallet an AI agent runs
- EXACT: "The agent proposes. The user approves. The contract enforces."

2. PROBLEM (1:00)
- Staged payments run on trust
- Agent with money = risky
- Injection, wrong amount, leaked key
- Rules in a prompt break

3. AUTHORITY (1:15)
- User owns
- Agent: session key, capped, expires, allowlist
- Contract decides
- Tiers 0 to 3
- EXACT: "A fooled agent can be wrong, but not wrong with more money than the contract allows."

4. ARCHITECTURE (1:00)
- Guard 1: policy, off-chain
- Guard 2: contract, on-chain
- Bank debit, mint, lock
- Anyone can read the chain

5. DEAL (1:15)
- Draft, lock, deliver, preview, approve, pay
- EXACT: "Nothing moves before Approve and Lock."
- File encrypted, hash on chain
- Key released after approval

6. PROOF (1:15)
- Agent's own key
- Pay a stranger
- Contract reverts
- Check it yourself

7. PRODUCT (1:00)
- Desktop app, companies, KYC
- Split payment, public links, arbiter
- Test money

8. TESTING (1:30)
- We attacked it
- 115 / 15 / 22, in CI
- Two Highs found, 7-day timeout
- PR awaiting merge
- One open finding

9. RISKS (0:45)
- Server holds keys
- One validator
- Disputes off
- Unsigned builds

10. CLOSE (0:30)
- EXACT: "The agent proposes. The user approves. The contract enforces."
- Check it yourself
- Thank you
