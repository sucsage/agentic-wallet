# Agentic Wallet Desktop

Your deals as your own chain on your computer. One executable per OS (macOS, Windows, Linux); it
opens its screen in your browser at `127.0.0.1`. Test mode demo: Mock Bank money only.

- Every deal event is signed by the server and appended as a block; every block is signed by this
  computer's key (made here, encrypted with your passphrase, never sent anywhere).
- The website keeps only your latest block, countersigned, plus an encrypted backup it cannot read.
- When the other side of a deal also uses the app, the same event is in both chains: they link.
- Everything day to day happens here, each move a block you sign: new deals with the AI chat and
  Confirm, delivering (the block signs the file's SHA-256), approve, dispute, accept, cancel, claim,
  refund, and payees. Activity shows money in and out. The website is for sign-up and identity,
  top-ups, friends and groups. The money itself stays locked in the escrow contract on the chain.
- Every hour the server puts one Merkle root of all heads on the private chain (ChainAnchor);
  "Verify now" checks your proof and the transaction receipt.

Design and checks: `TECHNICAL.md` §3.20, `SECURITY.md` §4c. The block format is shared with the
server: `web/src/lib/device-chain/format.ts`.

## Use

1. Website: Profile → Desktop app → **Make a link code**.
2. Run the app for your computer. First time only: Windows "More info → Run anyway"; macOS
   right-click → Open (or `xattr -d com.apple.quarantine <file>`); Linux `chmod +x <file>`.
3. Type the code, name the computer, choose a passphrase.
4. Settings → **Save key backup** and keep the file. A new computer: **Restore from backup**.

Options: `--no-open` (print the URL instead of opening the browser). `AGENTIC_WALLET_DATA=<dir>`
moves the data folder (default: `~/Library/Application Support/AgenticWallet`,
`%APPDATA%\AgenticWallet`, `~/.local/share/agentic-wallet`).

## Build

```bash
bun install
bun run dev          # run from source
bun run build        # dist/: windows-x64.exe, macos-arm64, macos-x64, linux-x64, linux-arm64
bun run build mac-x64
```
