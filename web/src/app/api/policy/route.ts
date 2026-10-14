import { getAddress } from "viem";

import { agentWalletAbi } from "@/lib/abis";
import { publicClient, roleAddresses } from "@/lib/chain";
import { config } from "@/lib/config";
import { errorResponse, requireBankWallet } from "@/lib/guard";
import { listFriends } from "@/lib/social";
import { readWallet } from "@/lib/state";

/** The wallet's rules as the contract enforces them: caps, pause, approvals, who can be paid. */
export async function GET() {
  try {
    const { user, wallet } = await requireBankWallet();
    const [state, friends] = await Promise.all([readWallet(wallet), listFriends(user.id)]);
    // Candidates the allowlist could hold: the demo contractor and friends' wallets; the chain decides.
    const candidates = [
      { address: roleAddresses().contractor, label: "Demo contractor", friendshipId: null as string | null },
      ...friends.filter((f) => f.wallet && f.status === "ACCEPTED").map((f) => ({ address: getAddress(f.wallet!), label: f.name, friendshipId: f.friendshipId })),
    ];
    const allowed = await Promise.all(
      candidates.map((c) =>
        publicClient().readContract({ address: wallet, abi: agentWalletAbi, functionName: "allowedRecipient", args: [c.address] }),
      ),
    );
    const fileEscrowAllowed = await publicClient().readContract({
      address: wallet,
      abi: agentWalletAbi,
      functionName: "allowedFileEscrow",
      args: [config.bankContracts.fileEscrow],
    });
    return Response.json({
      wallet,
      explorer: state.explorer,
      token: state.token,
      paused: state.paused,
      threshold: state.threshold,
      session: state.session,
      recipients: candidates.map((c, i) => ({ ...c, allowed: allowed[i] })).filter((c) => c.allowed || c.friendshipId),
      escrows: { milestone: state.allowlist.escrows.length > 0, file: fileEscrowAllowed },
      tiers: [
        { tier: 0, rule: "Read balances, deals and history" },
        { tier: 1, rule: "New deals, payees and anything above the caps need your click" },
        { tier: 2, rule: `The agent approves deliveries alone up to ${state.session.maxPerTx} per transaction and ${state.session.dailyLimit} per day, allowlisted payees only` },
        { tier: 3, rule: "Anyone can pause; only you can resume" },
      ],
    });
  } catch (err) {
    return errorResponse(err);
  }
}
