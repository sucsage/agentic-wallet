# Kravii Wallet (desktop)

Your deals as your own chain on your computer. One executable per OS (macOS, Windows, Linux); it
opens its screen in your browser at `127.0.0.1`. Test mode demo: Mock Bank money only.

- Every deal event is signed by the server and appended as a block; every block is signed by this
  computer's key (made here, encrypted with your passphrase, never sent anywhere).
- The website keeps only your latest block, countersigned, plus an encrypted backup it cannot read.
- When the other side of a deal also uses the app, the same event is in both chains: they link.
- Everything day to day happens here, each move a block you sign: new deals with the AI chat and
  Confirm, delivering (the block signs the file's SHA-256), approve, dispute, accept, cancel, claim,
  refund, payees and group votes. Sign up or sign in, verify your identity, top up, add friends,
  manage the private links you sent, and run groups here too. The website stays for the pages
  people without an account open. The money itself stays locked in the escrow contract on the chain.
- Every hour the server puts one Merkle root of all heads on the private chain (ChainAnchor);
  "Verify now" checks your proof and the transaction receipt.

Design and checks: `TECHNICAL.md` §3.20, `SECURITY.md` §4c. The block format is shared with the
server: `web/src/lib/device-chain/format.ts`.

## Use

1. Run the app for your computer. First time only: Windows "More info → Run anyway"; macOS
   right-click → Open (or `xattr -d com.apple.quarantine <file>`); Linux `chmod +x <file>`.
2. **Sign in** with your Kravii email and password, name the computer and choose an app
   passphrase. New here? **Create account** opens the website's sign-up (identity check and wallet
   happen there), then sign in. Accounts with a second factor use **Link with code** (website:
   Profile → Desktop app → Make a link code).
   Several accounts can live on one computer: the unlock screen lists them, and
   **+ Add another account** adds one. Each has its own folder (`profiles/<device address>/`).
3. Settings → **Save key backup** and keep the file. A new computer: **Restore from backup**.

## AI

- Replies in the AI chat render as Markdown (sanitized).
- Settings → AI: your own instructions (tone, language, defaults; never above the rules) and,
  optionally, your own Anthropic or OpenRouter key and model (sealed on this computer, sent only
  with your chat messages, never stored by the server).
- Settings → Connect other AI agents: an MCP server for Claude Desktop, Cursor and others. Add to
  the client's config (the app shows the exact path):

  ```json
  { "mcpServers": { "agentic-wallet": { "command": "/path/to/AgenticWallet", "args": ["--mcp"] } } }
  ```

  Agents can read your wallet, deals and money, ask the wallet's AI to draft, and ask you to sign.
  Every move waits under "Requests from AI agents" until you press Sign.

## Tests

`bun test` (unit) and `AGENTIC_WALLET_DATA=<dir> AW_PASS=<passphrase> bun run security` (live,
against a running app and server). Results: `SECURITY.md` §4c.

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
