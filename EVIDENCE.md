# Execution evidence

Real transactions on the Agentic Wallet private chain (Hyperledger Besu, chain id 20261020), collected at block #37065 on 2026-10-15.
Every hash opens in the public explorer at https://agentic-wallet-inky.vercel.app/explorer (no sign-in), and can be checked independently over read-only JSON-RPC at `https://agentic-wallet-inky.vercel.app/api/rpc`:

```bash
cast receipt <tx hash> --rpc-url https://agentic-wallet-inky.vercel.app/api/rpc
curl -s https://agentic-wallet-inky.vercel.app/api/rpc -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["<tx hash>"]}'
```

## Contracts

| Contract | Address |
|---|---|
| AgentWalletFactory | [`0xA94536942AdCea3ED96C30875DD9C96b6FF458dB`](https://agentic-wallet-inky.vercel.app/explorer/address/0xA94536942AdCea3ED96C30875DD9C96b6FF458dB) |
| FileEscrow | [`0x4B1b39DBE7A84Ee2e6dE3Eeea94C415cdfb6e684`](https://agentic-wallet-inky.vercel.app/explorer/address/0x4B1b39DBE7A84Ee2e6dE3Eeea94C415cdfb6e684) |
| MockTHB (mTHB) | [`0x15490400815877aDEB91bc7610bAFb669992c525`](https://agentic-wallet-inky.vercel.app/explorer/address/0x15490400815877aDEB91bc7610bAFb669992c525) |
| MilestoneEscrow | [`0x1c2D427CF402320077E504d1e29F313fabfc6b00`](https://agentic-wallet-inky.vercel.app/explorer/address/0x1c2D427CF402320077E504d1e29F313fabfc6b00) |
| Arbiter (neutral) | [`0x2b4a015514fc1b732AA60784243e51d9cd4Ec1D7`](https://agentic-wallet-inky.vercel.app/explorer/address/0x2b4a015514fc1b732AA60784243e51d9cd4Ec1D7) |

## Transactions

### Agent wallets created

One transaction deploys a configured AgentWallet (owner, agent session key, caps, empty allowlist).

| Tx | Block | What |
|---|---|---|
| [`0x8e007f3a…e4ece85a`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x8e007f3a4da0f59238c3d1f5b56ed2dcb377848ae1cae6f2b068422fe4ece85a) | #27421 | wallet 0xaA3590D320d35c3213Fbd28b53d274AAC4116605 |
| [`0x6204ff32…dd636912`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x6204ff321a7ad020aa7bbb0993be1f21d30fafb7b99bdd8ed77d68fddd636912) | #27426 | wallet 0x35bA0aA13e4b9b4AD7f4c3d38F4A0949C0580891 |
| [`0x7bb6e7c5…e8b0e0a2`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x7bb6e7c5bff0e162d234d2dc07cbd16f19ca6085e851fcfdee043fbce8b0e0a2) | #30216 | wallet 0x36f8C99a0eE73a6a738489AD589E192BE3effBBC |
| [`0x28b9c7d6…4baba4bd`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x28b9c7d668a735c99c12bcd9fd553da5c290afdb632a42a8cef227ff4baba4bd) | #30287 | wallet 0x118EF6f81672e38621f99dfc67560DFD2199BB06 |

### Deals offered and money locked

A buyer's offer locks the payment in FileEscrow in the same transaction; a seller's offer locks nothing until the buyer accepts and pays.

| Tx | Block | What |
|---|---|---|
| [`0x94777c35…6f0d4ca4`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x94777c3594a244449a32505fc9b9cd4326ebf7b1a8d4e7f1815201fd6f0d4ca4) | #27457 | deal 0 · total 800 mTHB · seller's offer |
| [`0xfed2400a…e928fce9`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xfed2400aa20503b947eaba4982784dc2424d099420047570c263e6e7e928fce9) | #27510 | deal 1 · total 300 mTHB · seller's offer |
| [`0xa378f095…895d0b34`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xa378f0951c0c0c7140ae40b7336144611e17784c72b7f72fff10ed36895d0b34) | #30251 | deal 2 · total 600 mTHB · buyer's offer |
| [`0xc2671576…ccd5a6c3`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xc2671576c53c4cce67faf9f9bef28bfdabab76d8f01a943db6c744ffccd5a6c3) | #30630 | deal 3 · total 2500 mTHB · buyer's offer |

### Just-in-time funding (bank → mTHB)

The Mock Bank mints exactly the debited amount into the buyer's wallet right before the lock.

| Tx | Block | What |
|---|---|---|
| [`0x080251d1…53603a0e`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x080251d1c0a711d96abcdfd71eb4e6badaa8c36c631d50e47d0ff4c853603a0e) | #27471 | 800 mTHB |
| [`0xd63644f3…04472731`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xd63644f369840fc23b57f6d0124b43073c87722f3d94485bda930b4e04472731) | #30249 | 600 mTHB |
| [`0x7222a238…fa00dcb9`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x7222a23878f94c27ae5eecb4a91eb1bdb83d0dc3c8711a28a18d02a8fa00dcb9) | #30628 | 2500 mTHB |

### Settlement (mTHB → bank)

Tokens paid out of escrow are burned and the same amount moves from the bank's reserve to the seller's (or refunded buyer's) account.

| Tx | Block | What |
|---|---|---|
| [`0xc82c95d3…da97d1ce`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xc82c95d3759917bbcb3cd532623fed9f0ed7d966547e3e3ce1c4db85da97d1ce) | #27497 | 800 mTHB burned |
| [`0xbf9668a7…cb33efb8`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xbf9668a7c76606a06b1a6a71853c88e222c3b006b60449528b3b0a0dcb33efb8) | #30275 | 600 mTHB burned |
| [`0x12a6749e…5d002d94`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x12a6749ee1bf1b4fa61d8a4d39ef0dd89487b19607b6d7192e084a815d002d94) | #30703 | 2500 mTHB burned |

### OfferAccepted

The counterparty accepts; for a seller's offer the buyer pays in here.

| Tx | Block | What |
|---|---|---|
| [`0xb9d3d918…1cadbaf7`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xb9d3d9182b4421293d39454d5644d01dd448cdc87ecc75433f1194e51cadbaf7) | #27475 | deal 0 |
| [`0x9ecba553…1a684919`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x9ecba553127bad6456bdfcd8446c27a7b03219a29c629cec94efd4301a684919) | #30262 | deal 2 |
| [`0xa78cd6f2…733974bc`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xa78cd6f22334a42a00033e4892c3d41495e9108a51f0cdfe6cb18e65733974bc) | #30659 | deal 3 |

### Delivered

The seller anchors the sha256 of the delivered file (the work hash); the file stays encrypted off-chain.

| Tx | Block | What |
|---|---|---|
| [`0xc3298d40…5e4450bd`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xc3298d40ed001eb792cbbf7f4f4f426c769f8e33551927b74a79ce0c5e4450bd) | #27487 | deal 0 · milestone 1 |
| [`0xa594bde8…97e15f6b`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xa594bde8aeefcfca0ea4894e36b4760fd607d41bcdd2a7ad80dec75a97e15f6b) | #30265 | deal 2 · milestone 1 |
| [`0x528658e5…762b2742`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x528658e56ccdb25becb2bdb9721235cf6c28c00bae19883ae671c452762b2742) | #30677 | deal 3 · milestone 1 |

### Approved

The buyer approves the work. Within the caps this is the agent's own Tier 2 action.

| Tx | Block | What |
|---|---|---|
| [`0x34e835d0…9bfd964d`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x34e835d0ee4d503f8e046bb611802bf5e5e3caaa1d45e990dab852cc9bfd964d) | #27491 | deal 0 · milestone 1 |
| [`0x718bae10…8ccd7da7`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x718bae101cbb0b80979266bc2d042988c24c7e645b2a87c5e3b8a1a98ccd7da7) | #30269 | deal 2 · milestone 1 |
| [`0x0510f822…7904be1b`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x0510f82269414922e956bf59cf2662eae31eebe0bf588f7f96615c1e7904be1b) | #30696 | deal 3 · milestone 1 |

### KeyReleased

The seller's side publishes the key commitment; the buyer can now download the file.

| Tx | Block | What |
|---|---|---|
| [`0x843ed78e…90709520`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x843ed78ec47f0ff7e46b30ee3e8b49af2ef0de1079ae6b9a6b90ba4c90709520) | #27493 | deal 0 · milestone 1 |
| [`0xe2334fe2…d11f2b92`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xe2334fe2d067ab1dbb24512455a9876ea678fab117bd716f80503553d11f2b92) | #30271 | deal 2 · milestone 1 |
| [`0x80b28d1a…ec3cafce`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x80b28d1aac7e03cf10c3b01ff625e9413454c1a9926c7e65263d2cedec3cafce) | #30699 | deal 3 · milestone 1 |

### Released

The seller is paid from escrow.

| Tx | Block | What |
|---|---|---|
| [`0x226f9412…a9ab3415`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x226f941270b161d679a3aff87f12f58a4e2fff573c08a8a07484db21a9ab3415) | #27495 | deal 0 · milestone 1 |
| [`0x6d7ecdcb…74a16f7d`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x6d7ecdcbc1999e753cc9a98f7092eb287553eed1dd2b5ca518b33c5374a16f7d) | #30273 | deal 2 · milestone 1 |
| [`0xf44b8fa6…1788ca78`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xf44b8fa6bd5559d4345ca3f814b8dfd81e86cf093a5fb64d114477161788ca78) | #30701 | deal 3 · milestone 1 |

### OfferCancelled

An offer withdrawn before acceptance.

| Tx | Block | What |
|---|---|---|
| [`0x8b3c050b…c363b24d`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x8b3c050bb4dd63516cbf6c93ac403ef70ea7f4e42dcba7b02bdd4a8dc363b24d) | #27514 | deal 1 |

### Attack refused on-chain

The agent's own key calls `agentTransfer(0xBAd…Bad, 5000)`, skipping the AI and the policy engine. The contract reverts it (`RecipientNotAllowed`).

| Tx | Block | What |
|---|---|---|
| [`0x7f47a0c1…011f3191`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x7f47a0c19501d7f7ae5f19863e99009eef2b3cb2c2365939d360e9c4011f3191) | #37040 | agentTransfer(0xBAd0000000000000000000000000000000000Bad, 500000) from the agent key · **reverted** |

