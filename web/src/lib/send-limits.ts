/** Sending to contacts from your own wallet: per person, in major units (baht / yuan). Shared by the dialog and the server. */
export const SEND_LIMITS = { min: 100, max: 25_000 } as const;

/** The agent's caps the owner can set (Tier 2): per transaction 10,000 to 100,000 baht (the Mock Bank
 *  mints up to 100,000 per deal), per day up to 1,000,000. Yuan at about 1 : 5. */
export const AGENT_LIMIT_RANGE = {
  THB: { perTxMin: 10_000, perTx: 100_000, perDay: 1_000_000 },
  CNY: { perTxMin: 2_000, perTx: 20_000, perDay: 200_000 },
} as const;
