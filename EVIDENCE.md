# Execution evidence

Kravii (formerly Agentic Wallet / MilestonePay). Updated 2026-10-19: the desktop releases below were
added; the chain transactions are unchanged.

Real transactions on the Kravii (Agentic Wallet) private chain (Hyperledger Besu, chain id 20261020), collected at block #37901 on 2026-10-15.
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
| [`0x668920bf…d7836628`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x668920bfc8dd65a5b1abd5dd2e61f8586456a34e9314140900ba857dd7836628) | #37789 | deal 4 · total 400 mTHB · buyer's offer |
| [`0xf1a1a13e…208ee364`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xf1a1a13e52c261cc0ed50cb53f8234c378bdaa4f1a34f6b7a7b992f1208ee364) | #37795 | deal 5 · total 400 mTHB · buyer's offer |

### Just-in-time funding (bank → mTHB)

The Mock Bank mints exactly the debited amount into the buyer's wallet right before the lock.

| Tx | Block | What |
|---|---|---|
| [`0x080251d1…53603a0e`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x080251d1c0a711d96abcdfd71eb4e6badaa8c36c631d50e47d0ff4c853603a0e) | #27471 | 800 mTHB |
| [`0xd63644f3…04472731`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xd63644f369840fc23b57f6d0124b43073c87722f3d94485bda930b4e04472731) | #30249 | 600 mTHB |
| [`0x7222a238…fa00dcb9`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x7222a23878f94c27ae5eecb4a91eb1bdb83d0dc3c8711a28a18d02a8fa00dcb9) | #30628 | 2500 mTHB |
| [`0xa1b0cbb9…f9ce2e3d`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xa1b0cbb91b8e30c5ad65fefdc76304d53ce91c8a03ca98e985b3ca8bf9ce2e3d) | #37787 | 400 mTHB |
| [`0xbe50a1f8…6e667faa`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xbe50a1f833aa2dde5ff59519c1fd44e5f1c94bfd103960ff92c878536e667faa) | #37793 | 400 mTHB |

### Settlement (mTHB → bank)

Tokens paid out of escrow are burned and the same amount moves from the bank's reserve to the seller's (or refunded buyer's) account.

| Tx | Block | What |
|---|---|---|
| [`0xc82c95d3…da97d1ce`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xc82c95d3759917bbcb3cd532623fed9f0ed7d966547e3e3ce1c4db85da97d1ce) | #27497 | 800 mTHB burned |
| [`0xbf9668a7…cb33efb8`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xbf9668a7c76606a06b1a6a71853c88e222c3b006b60449528b3b0a0dcb33efb8) | #30275 | 600 mTHB burned |
| [`0x12a6749e…5d002d94`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x12a6749ee1bf1b4fa61d8a4d39ef0dd89487b19607b6d7192e084a815d002d94) | #30703 | 2500 mTHB burned |
| [`0x6cf21d1e…8b439772`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x6cf21d1e1ad012296366f360ea242e66288f8b43bef7fdd6d27798638b439772) | #37817 | 400 mTHB burned |
| [`0x1abd8818…89a55b61`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x1abd881800670406a2266f39a73eb238fef29eeaa847860c3f4d48a989a55b61) | #37820 | 400 mTHB burned |

### OfferAccepted

The counterparty accepts; for a seller's offer the buyer pays in here.

| Tx | Block | What |
|---|---|---|
| [`0xb9d3d918…1cadbaf7`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xb9d3d9182b4421293d39454d5644d01dd448cdc87ecc75433f1194e51cadbaf7) | #27475 | deal 0 |
| [`0x9ecba553…1a684919`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x9ecba553127bad6456bdfcd8446c27a7b03219a29c629cec94efd4301a684919) | #30262 | deal 2 |
| [`0xa78cd6f2…733974bc`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xa78cd6f22334a42a00033e4892c3d41495e9108a51f0cdfe6cb18e65733974bc) | #30659 | deal 3 |
| [`0xa090c6a8…0fdf6087`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xa090c6a82c9eab47f4452ad4d7105ce83443f752f5b0d94c4b7ff7960fdf6087) | #37799 | deal 4 |

### Delivered

The seller anchors the sha256 of the delivered file (the work hash); the file stays encrypted off-chain.

| Tx | Block | What |
|---|---|---|
| [`0xc3298d40…5e4450bd`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xc3298d40ed001eb792cbbf7f4f4f426c769f8e33551927b74a79ce0c5e4450bd) | #27487 | deal 0 · milestone 1 |
| [`0xa594bde8…97e15f6b`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xa594bde8aeefcfca0ea4894e36b4760fd607d41bcdd2a7ad80dec75a97e15f6b) | #30265 | deal 2 · milestone 1 |
| [`0x528658e5…762b2742`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x528658e56ccdb25becb2bdb9721235cf6c28c00bae19883ae671c452762b2742) | #30677 | deal 3 · milestone 1 |
| [`0x83582431…b3629acd`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x8358243171911fadc22f71741536c38a4f2894b37377b8fade9b75ffb3629acd) | #37807 | deal 4 · milestone 1 |

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
| [`0x61270cd0…1c2197cc`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x61270cd0eab4974b6075530c5a04de4601f442cf2c901508b115860d1c2197cc) | #37818 | deal 5 · milestone 1 |

### OfferCancelled

An offer withdrawn before acceptance.

| Tx | Block | What |
|---|---|---|
| [`0x8b3c050b…c363b24d`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x8b3c050bb4dd63516cbf6c93ac403ef70ea7f4e42dcba7b02bdd4a8dc363b24d) | #27514 | deal 1 |

### Disputed

The buyer disputes a delivery; the neutral arbiter (AI, or a check for key disputes) rules on it.

| Tx | Block | What |
|---|---|---|
| [`0x1286b9e7…55eb58c2`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x1286b9e7df49834b892d3777853d666d8e23c4f4044f2de48eb5c11355eb58c2) | #37812 | deal 4 · milestone 1 |
| [`0xa8a2924a…54795e5a`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xa8a2924a2eaba9807a048ab3060a529f94229e2043251909c0789c4854795e5a) | #37815 | deal 5 · milestone 1 |

### Refunded

Money back to the buyer: a seller's refund, or the arbiter ruling for the buyer (`resolve` by the arbiter key).

| Tx | Block | What |
|---|---|---|
| [`0xcb7aea8d…999d1aee`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xcb7aea8db5b7d2e0c236756278d76f6fe37d69f5f4ed8ad9f8c29fe4999d1aee) | #37815 | deal 4 · milestone 1 |

### Attack refused on-chain

The agent's own key calls `agentTransfer(0xBAd…Bad, 5000)`, skipping the AI and the policy engine. The contract reverts it (`RecipientNotAllowed`).

| Tx | Block | What |
|---|---|---|
| [`0x7f47a0c1…011f3191`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x7f47a0c19501d7f7ae5f19863e99009eef2b3cb2c2365939d360e9c4011f3191) | #37040 | agentTransfer(0xBAd0000000000000000000000000000000000Bad, 500000) from the agent key · **reverted** |

## Added on 2026-10-17 (FileEscrow `0x4283A0CF5DB1b490c9F334A768BE30Cd7d3c7e86`)

### Deposit paid on signing (deal 51)

A buyer hired a seller with a 100 THB deposit (milestone 1, `deposit: true` in the hashed terms) and a 200 THB web page. The moment the seller accepted, the server delivered and released the deposit in the next two blocks, with no delivery by the seller. The page (an HTML file) was then delivered and shown to the buyer in a sandboxed device mockup; the test ended with the seller refunding that milestone.

| Tx | Block | What |
|---|---|---|
| [`0x7399ed3b…36a7d70a`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x7399ed3b0238220a638ec9b4ad986827ab0b53814dbd1d97f3f189d536a7d70a) | #118938 | OfferCreated · deal 51 (buyer locks 300 THB) |
| [`0xea13cd45…aab0912a`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xea13cd453e393913d25682d43ef609d8a4f6cab909d300cc2695a9c4aab0912a) | #118943 | OfferAccepted · the contract is signed |
| [`0x24c29f63…73d9a194`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x24c29f635e8a1eb8fce923c5a3b5426e697c45d7c2d7afe068d47db173d9a194) | #118944 | Delivered · milestone 1 (deposit, recorded automatically) |
| [`0x913bc90b…2e6f20e2`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x913bc90bac869dec11e876fc714b2d3f0d573f2ec235f97595b5fc4a2e6f20e2) | #118945 | Released · deposit paid to the seller |
| [`0x292fdc1e…112895fd`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x292fdc1e8b54b6bd189419fe941a3f19efb5e9cf13cf2955215cb6c1112895fd) | #118958 | Delivered · milestone 2 (landing.html, previewed in the mockup) |
| [`0x1b7c2d47…5375e63f`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x1b7c2d47ad3ef474b9a4241839fc0944faadc1cae5c2ffb46c45b4665375e63f) | #119033 | Refunded · milestone 2 (end of test) |

### An unaccepted offer amended, not duplicated (deal 34 → deal 50)

The seller asked the AI to change D-34's price to 250 THB. The AI made an amendment preview (`amend_deal`); on Confirm the old offer was withdrawn and the new one made in the next block, to the same invited buyer and the same private link.

| Tx | Block | What |
|---|---|---|
| [`0xc3ba9f16…295d9c5d`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xc3ba9f168eeb8edc3a44273832dbf2b154c8bee6e6163830010d919c295d9c5d) | #118869 | OfferCancelled · deal 34 (200 THB) withdrawn by the amendment |
| [`0xa7da58c2…8d4a595a`](https://agentic-wallet-inky.vercel.app/explorer/tx/0xa7da58c26b1a433890f9694bd0f2a110bd2cbd3f9baf73b0707e7b158d4a595a) | #118870 | OfferCreated · deal 50 (250 THB) replaces it |
| [`0x611119fd…fd57bfcc`](https://agentic-wallet-inky.vercel.app/explorer/tx/0x611119fde31f21b07611e65dad32240cc88e5538b7959e44364e5fe0fd57bfcc) | #119034 | OfferCancelled · deal 50 (end of test) |

## Desktop app releases (added 2026-10-19)

Every build is made by the repository's release workflow (`.github/workflows/desktop-release.yml`) from
a tag `desktop-v<version>`, and published on GitHub Releases with `SHA256SUMS.txt` and `latest.json`.
The app's in-app updater and the website's `/download` page read `latest.json`. Check a download with:

```bash
shasum -a 256 Kravii-0.6.3-window-macos-arm64.dmg
curl -sL https://github.com/sucsage/agentic-wallet/releases/download/desktop-v0.6.3/latest.json
```

### Kravii 0.6.3 (latest, 2026-10-19)

| Platform | File | Size | SHA-256 |
|---|---|---|---|
| macOS (Apple silicon) | `Kravii-0.6.3-window-macos-arm64.dmg` | 19.3 MB | `a89bf6313f58dc155589301f74fb61d60a3b06a68ba7003cfc1441bc71729b6a` |
| macOS (Intel) | `Kravii-0.6.3-window-macos-x64.dmg` | 21.4 MB | `e831d765be85708b0367895dc76b4a56507040765b387e0624dc189131721dca` |
| Windows 10/11 (64-bit) | `Kravii-0.6.3-window-windows-x64-Setup.exe` | 29.7 MB | `d02022b5080cbdef1025c74652ad9efe0379923860eb5eaf7d3da0ac35103f1a` |
| Linux x64 | `Kravii-0.6.3-window-linux-x64-Setup.tar.gz` | 31.6 MB | `7efd145bfd2e46a80aec13a5f3b30f34fcff1432ae7b4ebaef9abbbbd62d2580` |
| Linux ARM64 | `Kravii-0.6.3-window-linux-arm64-Setup.tar.gz` | 30.7 MB | `e1af5997646853d34f140d191519579bd95f578148c661df28bcaf1ab8a0ecfc` |

### Release history

| Version | Date (UTC) | What changed |
|---|---|---|
| 0.6.3 | 2026-10-19 | macOS update swap clears quarantine; first version installed through an in-app update |
| 0.6.2 | 2026-10-19 | updates from inside the app (macOS, Windows) |
| 0.6.1 | 2026-10-19 | time limits on website calls; background sync never queues ahead of the user |
| 0.6.0 | 2026-10-19 | renamed Kravii, new logo |
| 0.5.2 | 2026-10-19 | Windows: one Setup.exe, no terminal window, dark title bar, app icon, DPI aware (0.5.1 shipped without Windows) |
| 0.5.0 | 2026-10-18 | windowed app only; black title bar on macOS; web search and MCP finder in the AI chat |
| 0.4.0 | 2026-10-18 | the app in its own window (Electrobun) |
| 0.2.0-0.3.0 | 2026-10-18 | installers, the download page, the browser build's updater; the app reaches the whole website |

### In-app update test (2026-10-19, macOS Intel)

0.6.2 was installed from its release `.dmg` into a test folder with separate test data, then updated
through the app's own update route: it found 0.6.3, downloaded `Kravii-0.6.3-window-macos-x64.dmg`,
checked its SHA-256, quit, had the bundle swapped, and reopened answering `/ping` with version 0.6.3
(about 8 s plus the restart). The Windows path (silent Setup.exe) is built but was not run on a
Windows machine.
