# Kravii: presenter guide, slide by slide (10 minutes)

How to use: one card per slide, in the same order as the deck. Say the bullets in your own words. **Bold** = the words to stress. 🔁 = say it again, on purpose. ➜ = how you hand over to the next slide.

Your anchor line, 🔁 three times (slides 1, 3, 10):
**"The agent proposes. The user approves. The contract enforces."**

---

## 1. Title · 0:30

- We are **Kravii**, formerly Agentic Wallet. Topic F, Agent Wallet.
- One sentence: a wallet an **AI agent runs**, that **cannot lose your money**, even if the agent is fooled.
- 🔁 Anchor line.
- Roadmap in five words: problem, design, flow, testing, weak spots.
- ➜ "Let's start with why this is hard."

## 2. The problem · 1:00

- Small businesses pay contractors in **stages**: deposit, delivery, acceptance, retention.
- Today it is **trust**, chat and bank transfers. Buyer pays before seeing the work.
- Agents could do the paperwork, but an agent that moves money is **dangerous**:
  - **prompt injection** from a document
  - a **hallucinated** amount
  - a **leaked key**
- Rules inside the prompt = **one clever message breaks them**.
- The question: how can an agent act when the rules must **survive manipulation**?
- ➜ "Our answer is to move the rules out of the agent."

## 3. Three layers of authority · 1:15

- **User owns**, **agent holds a session key**, **contract decides**.
- The session key is **scoped**: expires, per-transaction cap, daily cap, allowlist.
- The owner key **never** goes to the agent.
- Tiers: **0** read · **1** propose, human approves · **2** auto, inside caps · **3** emergency pause.
- 🔁 Anchor line.
- Key sentence: a fooled agent can be wrong, but **not wrong with more money than the contract allows**.
- ➜ "Here is how that is built."

## 4. Architecture · 1:00

- Trace one path with your hand, left to right: **user → agent → Guard 1 → Guard 2 → escrow**.
- **Guard 1** = off-chain policy: tier routing, injection scan, allowlist.
- **Guard 2** = the contract, **checks again on chain**. A jailbreak can pass Guard 1; the contract still says no.
- Money: bank is **debited**, token is **minted**, funds are **locked** in escrow. Payout credits the seller's bank.
- Chain is private, but **anyone can read it** (public explorer).
- Do not explain every box.
- ➜ "Now what that looks like for one deal."

## 5. A deal, step by step · 1:15

- Six steps: draft, approve and lock, deliver, preview, approve, pay.
- 🔁 **"Nothing moves before Approve and Lock."**
- The seller's file is **encrypted**; its **hash is on chain**.
- The key is released **only after the buyer approves**.
- People without an account join through a **private link**; payout destination is **locked once set**, so a leaked link cannot redirect money.
- ➜ "Does the guard really hold? Here is a real attempt."

## 6. Proof: the on-chain refusal · 1:15

- Setup: we took the **agent's own key** and tried to pay a **stranger**, skipping the AI and the policy engine.
- Result: the contract **reverted** it.
- It is a **real transaction**, anyone can **check it with one command**.
- Say the error name **only if your screenshot shows it**. Otherwise: "reverted, recipient not allowlisted".
- Bonus (one line): we fixed a bug where the agent could approve twice; now only a **delivered** milestone.
- ➜ "That is the core. Around it, we built a product."

## 7. Built around the core · 1:00

- Fast, list only, do not demo:
  - **desktop app** (Windows, macOS, 0.6.3)
  - **company accounts**, group votes
  - **KYC**, PromptPay and card top-ups
  - **split payment**, **public job links**
  - **neutral AI arbiter**, several models
- 🔁 **"All test money."**
- ➜ "Building it is half the job. Attacking it is the other half."

## 8. How we tested it · 1:30

- We **attacked** the system, not only read it. Method: **reproduce first, then fix**.
- Numbers: **115** contract tests · **15** web security tests · **22**-step smoke test · all in **CI**.
- Found:
  - **High**: refund paid **twice** after a split
  - **High**: company member **not a signer** could spend
  - silent arbiter could **lock money**; fix: **7-day timeout**
- Status: fixes are **in a pull request, awaiting merge** (change this if it has merged).
- One more finding, **open**: desktop payee path lacked a signer check. Say **"found in review"**, never "exploited".
- ➜ "We want to be just as honest about what is still weak."

## 9. Known risks, next steps · 0:45

- Four risks, each with its fix:
  - **server holds owner keys** (demo) → device keys or multisig
  - **one validator** on a home PC → several validators
  - **disputes off** → timeout refund or re-enable
  - **unsigned desktop builds** → code signing
- Written down as **R1 to R15** in our security document.
- Slow down here. Judges respect honesty.
- ➜ "To close."

## 10. Close · 0:30

- 🔁 Anchor line, slowly.
- "The rules do not live in a prompt. They live where the agent **cannot argue**."
- Everything is on a **public chain you can check yourself**.
- Point to the links: app, explorer, EVIDENCE.md. **Thank you.** Stop.

---

## Words to repeat (the "peaks")

| Word or line | Where |
|---|---|
| "Proposes, approves, enforces" | 1, 3, 10 |
| "Cannot be talked around / cannot argue" | 3, 4, 10 |
| "Nothing moves before Approve and Lock" | 5 (and demo) |
| "Check it yourself" | 6, 10 |
| "Test money" | 7, 9 |
| "Honest" / named limits | 8, 9 |

## Never say

- "Third-party audit" (it was internal) · "all bugs fixed" · "the live app is healthy" (unless checked that day)
- The error name, if your screenshot does not show it
- Anything about dropping crypto (not decided)

## If you run over

Cut slide 7 to one sentence; shorten slide 5. Never cut 3, 6, 9.

## Judge questions (short answers)

- **Jailbreak or key leak?** Key is capped, expiring, allowlisted, revocable; owner can pause instantly.
- **Who holds the owner key?** The server in the demo (R1). Production: device or multisig.
- **Why a blockchain?** Rules and audit log enforced and readable by both sides without trusting us.
- **Disputes?** Off for now; timeout refund proposed; arbiter exists but is off.
- **Real money?** No. Simulated bank, valueless tokens.
- **Next?** Device keys, several validators, code signing, external audit.

## Before you record

- [ ] Slide 6 screenshot added
- [ ] Slide 8 wording matches the PR status that day
- [ ] Live app and chain checked, if shown
- [ ] One timed run; aim for 9:30
