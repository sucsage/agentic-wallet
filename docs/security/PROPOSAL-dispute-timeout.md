# Proposal: a timeout for disputed milestones (draft)

Status: draft for discussion. Not implemented. A contract-level matrix of every exit from `Disputed` has been produced (below) and refines the details.

## Problem

A milestone in `Disputed` can leave that state only through the arbiter's `resolve(...)`. On `FileEscrow` the seller can also call `refund`, which returns the money to the buyer. If the arbiter key is lost, the server is down, or no human arbiter rules, the buyer's locked money and the seller's payout stay locked for ever. The architecture plan promised that money never stays stuck (`timeoutResolve`). Today `MilestoneEscrow` has no exit at all except the arbiter.

## Exit matrix (code-read at 156d6b7)

| Escrow | Ways out of `Disputed` | Stuck if the arbiter never rules? |
|---|---|---|
| `FileEscrow` | arbiter `resolve(true)`, arbiter `resolve(false)`, or the seller's `refund` | Yes, unless the seller chooses to refund |
| `MilestoneEscrow` | arbiter `resolve(true)` or `resolve(false)` only | Yes, permanently; neither party has a unilateral exit |

Related: a `Pending` milestone has no delivery deadline and the buyer cannot cancel after acceptance, so an inactive seller can keep it locked. That is outside this proposal but worth a decision. The seller's `refund` can also pre-empt the arbiter's ruling after a dispute. It only returns money to the buyer, so it is a seller concession, not a theft.

## Principle

Follows decision D001: funds stay locked until the counterparties confirm, and a neutral arbiter resolves disputes. A timeout is a last resort for a silent arbiter, not a shortcut around it.

## Proposed rule

1. When a buyer disputes, record `disputedAt` for that milestone.
2. After `disputedAt + ARBITER_WINDOW` anyone may call `timeoutResolve(dealId, index)`. Before that, only the arbiter can resolve.
3. The fallback outcome is fixed in the contract, not chosen by the caller.
4. Emit an event with the outcome and the caller.

## Decisions to make

| Question | Options | Recommendation |
|---|---|---|
| Fallback outcome | A: refund the buyer. B: pay the seller. C: split 50/50 (needs a new split function) | A. The money came from the buyer and nobody has confirmed the work. It lets a buyer dispute to get a refund, which the AI and human arbiter normally prevent, so the window should be long enough for them to act |
| Window length | A constant (for example 7 days), or a period fixed in the offer terms (the contract review suggested 30 days) | Either works. A constant avoids changing the offer signature the web app calls; a period in the terms is more flexible. The team picks |
| Where to store `disputedAt` | New field in the milestone struct | Needed. This changes the `getMilestone` return shape, so `contracts/scripts/export-abis.mjs` must be rerun and `web/src/lib/state.ts` (hand-mirrored types) updated |
| Both escrows | `FileEscrow` only, or `MilestoneEscrow` too | Both if `MilestoneEscrow` stays in use; otherwise document it as legacy |

## Impact

- Size: `FileEscrow` is 8.8 KB deployed, so there is plenty of headroom; `AgentWallet` is not touched.
- Tests the owner will write: cannot be called before the window; cannot be called by anyone once the arbiter resolved; outcome and balances exactly as the rule says; the arbiter can still resolve inside the window; total tokens in the escrow never change; replay on a settled milestone reverts.
- Web: the dispute screens should show the deadline. The settlement code already handles refunds, so it only needs to treat the new event like a refund.

## Who does what

The contract change belongs to the contract authors. @NawaratKhem will write the tests first, against the agreed rule, and review the pull request.
