/**
 * How to use the app, step by step, for the AI to explain (tool app_guide). Page and button names
 * are the ones on screen. Kept short per topic so the model reads only what the user asked about.
 */

export const GUIDE_TOPICS = [
  "start",
  "money",
  "buy",
  "sell",
  "outsider",
  "deposit",
  "deliver",
  "review",
  "dispute",
  "documents",
  "files",
  "templates",
  "deals_page",
  "contacts",
  "groups",
  "limits",
  "summary",
  "profile",
  "address",
  "ai_chat",
  "guarantors",
  "revisions",
  "expiry",
  "terms_review",
  "protection",
  "split_payment",
  "public_link",
  "desktop_app",
] as const;
export type GuideTopic = (typeof GUIDE_TOPICS)[number];

const GUIDE: Record<GuideTopic, string> = {
  start: `Getting started (test money only, nothing real moves):
1. Sign up on the login page (Create account) or Continue with Google, then pass the bank step: the app opens a demo bank account and an on-chain wallet for you (about 10 seconds).
2. The left menu: AI Chat (talk to the agent), Deals (everything you buy and sell), Summary (income, spending, tax estimate), Contacts (friends, allow transfer list, send money), Groups (pay together), Policy & Allow transfer list, Profile & Privacy. With a mouse, the menu opens when you point at it; its top button keeps it open.
3. Top up your balance with "+ Top up" (top bar of every page): PromptPay QR, card or counter service, all in test mode.
4. To make your first deal, open AI Chat and say what you want, e.g. "hire Seller One to design a logo, 5,000 baht, 2 milestones".`,
  money: `Money:
- Top up: "+ Top up" in the balance bar → choose PromptPay (scan the QR), card (Stripe test card 4242 4242 4242 4242) or counter service → the balance updates when the payment clears.
- Send money to a contact: Contacts → the person → "Send money" (100 to 25,000 baht per person; they must be on your allow transfer list).
- A deal locks its total from your balance only when you press Confirm on the AI's preview; the money waits in the escrow smart contract and is paid milestone by milestone after you approve each delivery.
- Withdraw: a seller paid through a private link chooses a bank account or PromptPay on that link's page (Payout); app users get paid straight into their wallet balance.
- "Locked in deals" in the balance bar is what your deals hold in escrow right now.`,
  buy: `Hiring or buying (you pay):
1. AI Chat: describe the deal: who, what is delivered, the price, how many milestones (งวด), what must be true for each milestone to be approved, and for files the formats you accept (e.g. PDF, DWG). For a parcel, your delivery address (the AI can use the one saved on Profile).
2. The AI asks for anything missing (sometimes as a short form), then shows a PREVIEW card. Nothing is created yet.
3. Check the card and press "Confirm": the total is taken from your balance and locked in escrow, and the offer goes to the seller. (Or press Discard.)
4. The seller accepts the offer (that is the signature), then delivers each milestone. You review on the deal's page (Deals → the deal).
The seller must be on your allow transfer list if they have an account (Contacts); someone without an account gets a private link instead (see "outsider").`,
  sell: `Selling your work, a file or an item:
1. AI Chat: "sell <what> to <buyer> for <price>", with milestones and what must be delivered. The buyer must be a contact, or someone without an account (they get a private payment link).
2. The AI shows a preview; press "Confirm" to send the offer. Nothing is locked yet.
3. The buyer accepts and pays (from their balance, or by card on the link): the money is then locked in escrow.
4. Deliver each milestone on the deal's page; you are paid when the buyer approves (or automatically after the review window if they stay silent).
You can attach files for the buyer (a spec, a catalogue, a sample, a quotation) on the deal's page under "Attached files".`,
  outsider: `Dealing with someone who has no account:
1. Tell the AI the person is outside the app ("คนนอก", "no account", "send them a link"). It drafts with their name.
2. Press "Confirm": a private link AND a 6-digit one-time code (OTP) are made, shown in the chat and on the deal's page ("🔐 Access code"). Send the link and, separately (another chat or a call), the code.
3. The first time, they open the link, enter the code and set their own password; after that the link asks only for their password. A forwarded link alone opens nothing.
4. If they lose the password: on the link they press "Forgot password?" and get a reset code; they send it to you; you enter it on the deal's page ("Reset their access") and get a new one-time code to send them.
5. On the link they can: accept the offer (a seller), or pay by card (a buyer), deliver, approve, ask for changes, set their own name, and choose where their money goes. No account needed.
6. If they already have an account and open the link while signed in, the deal links to their account: they accept the offer on the link first, then the app opens with the deal in their Deals list.`,
  deposit: `Deposits (มัดจำ) paid on signing:
1. Say it in AI Chat, e.g. "30% deposit on signing, the rest in 2 installments". The deposit is always the first milestone.
2. The preview shows "💰 deposit, paid on signing".
3. When the other side accepts the offer, the deposit moves to the seller at once, automatically: nobody delivers or approves it. The other milestones stay locked in escrow until each delivery is approved.
4. The contract (Deals → the deal → Export documents → Contract) states the deposit.`,
  deliver: `Delivering (seller):
- Due dates: each milestone shows its agreed due date and a countdown. Either side proposes a date on the deal page ("Propose a due date"); the other accepts it. Past the date with nothing delivered, the buyer can "Ask for this milestone's money back (late)": the seller sees it and refunds from the deal page.
- PDFs and images open in a preview in the page; before approval the buyer sees a watermarked preview of a delivered PDF's first pages.
1. Deals → the deal → the milestone → the delivery form.
2. Write the evidence: what you delivered and how it meets the acceptance criteria.
3. A file milestone: attach the file (max 4 MB). If the deal lists accepted formats (e.g. "PDF, DWG only"), only those can be uploaded. The file is encrypted; its fingerprint (sha256) goes on-chain; the buyer sees a watermarked preview and gets the file after approving.
4. A parcel: choose the carrier and enter the tracking number (Mock Post can book a pickup and give you one). The buyer follows the parcel on the deal's page.
5. A website: deliver one .html file; the buyer tries it in a live desktop / tablet / phone mockup before approving.`,
  review: `Reviewing a delivery (buyer):
1. Deals → the deal: the delivered milestone shows the evidence, a preview of the file (or the parcel tracking, or the website mockup).
2. "Approve" pays the seller from escrow and unlocks the file. "Request changes" asks the seller to deliver again, within the rounds agreed for the milestone. There are no disputes: if the work still does not fit, do not approve, and ask the seller to refund (only the seller can).
3. You have the review window agreed in the deal (usually 72 hours). If you do nothing, the seller can claim the milestone after it ends.`,
  dispute: `Disputes are turned off (since 19 Oct 2026): nobody can open a new dispute.
1. A buyer reviews each delivery: "Approve" pays the seller; "Request changes" asks for a fix, within the rounds agreed for the milestone.
2. If the work does not fit, do not approve, and ask the seller to refund the milestone (only the seller can refund). Mind the review window: when it ends, the seller can claim the payment.
3. A dispute opened before this change still runs to its ruling on the deal's page (mediation, then a panel of AI models, one appeal), executed by the escrow contract.
4. For a scam or a serious problem, export the "Complaint" document (Export documents → ⚖ Complaint): a draft complaint with the timeline and on-chain evidence, for a lawyer, the police (online fraud: 1441, thaipoliceonline.go.th) or the district court. You can also Report or Block the person in Contacts.`,
  documents: `Documents (Deals → the deal → Export documents; each opens a printable page: Print → Save as PDF):
- Contract (สัญญา): the terms both sides signed, milestones, deposit, witnesses, terms fingerprint.
- Payment request (ใบเบิกเงิน): what the seller asks to be paid: delivered milestones, or the next milestone owed.
- Receipt (ใบเสร็จ) and Tax invoice (ใบกำกับภาษี): after a milestone is paid (VAT 7% shown inside the price).
- Complaint (เอกสารฟ้องร้อง): a draft complaint with the evidence, once the deal is signed.
Witnesses (optional): each side can add one under "Witnesses"; they appear on the contract. All documents are demo documents (test money).`,
  files: `Files:
- Attach files to a deal you created: Deals → the deal → "Attached files" → "＋ Attach a file" (up to 5, 4 MB each). The other side (and an outsider on their link) can open them.
- Send a file to the AI: in AI Chat press ＋, paste an image, or drag a file onto the chat (images, PDFs, TXT / CSV / MD / JSON). The AI reads it, e.g. a quotation to turn into a deal.
`,
  templates: `Templates:
- Save: on a deal or a preview card press "Save as template" (or ask the AI "save this deal as a template"). A template keeps the title, scope and milestones, never the other party.
- Use: Deals → Templates, or tell the AI "use my <name> template for <person>". It drafts a new preview from it; change anything before you Confirm.`,
  deals_page: `The Deals page:
- Tabs: All, Buying, Selling, Dispute, Templates.
- Filters: search by deal number, title or person; status (previews and drafts, waiting to be accepted, in progress, in dispute, completed, cancelled); type (hire, buy, digital file, physical parcel); sort (newest, oldest, amount high / low). "Clear" resets them.
- Click a deal to open it. AI previews and drafts open in place: Confirm or Discard there.
- Deals you were hired for through someone's private link are listed too ("via link") and open on that link's page.`,
  contacts: `Contacts:
- Add a contact: Contacts → "Add a contact" → type part of their name or username, or their exact email → Send request → they accept.
- Your username: new accounts get an automatic one (w_…) that nobody can guess. Choose your own under "My code" (Contacts) or "My username" (Friends in the desktop app): 3-20 letters, digits or _. Friends can also find you by name or email.
- "Add to allow transfer list": lets your wallet pay them (needed before a deal with them or Send money).
- Nicknames: tell the AI "พี่เอ is Seller One" and it remembers.
- "Send money": 100 to 25,000 baht per person.
- "Report" sends a report to the admins; "Block" removes them from your contacts and stops their requests and payments (unblock under Blocked).`,
  groups: `Groups (pay together):
1. Groups → "Create group" → name it, invite contacts, choose how many yes votes a payment needs (at least 2).
2. The owner can open a shared group wallet (or act as a registered company).
3. A purchase is proposed by a member (from AI Chat: "put DR-… to <group>", or in the group's chat with "Ask AI"); signers vote on the group's page; the money is locked only when enough vote yes.
4. Salaries and payouts from the shared wallet: "Pay out to members" on the group's page (or ask the AI acting as the group); signers vote; then everyone is paid at once.`,
  limits: `The agent's limits:
- On AI Chat, the agent panel on the right → the limits button → "Edit": per transaction 10,000 to 100,000 baht, per day up to 1,000,000. Saved on-chain.
- Within the limits and to someone on your allow transfer list, the agent may pay alone (Tier 2). Anything larger, any new deal, and any release without evidence waits for your approval (Tier 1). In an emergency it can pause the wallet (Tier 3); only you unpause it.
- An unverified account can lock up to 2,000 baht per deal: verify on Profile (ThaID) to lift it.`,
  summary: `The Summary page:
- Income, spending, refunds and net for the year, a 6-month chart (point at a bar for details), and a Thai tax estimate.
- "By deal": every deal, live from the escrow: total, paid out, refunded and still locked, with its status. Click one to open it.
- "Export CSV" downloads the numbers; the AI can explain them in plain words (it sees totals only, never names).`,
  profile: `Profile & Privacy:
- Verify your identity (ThaID for Thai banks) to raise the limits.
- Two-factor sign-in: PIN, this device (fingerprint / face / passkey), SMS or email code.
- Delivery address, display size, linked card (covers a short balance), the AI chat on / off, and privacy settings.`,
  address: `The delivery address:
1. Profile & Privacy → "Delivery address" → "Add address" (or "Edit").
2. Fill in the recipient and phone, the house number / street, then choose the province, the district (อำเภอ / เขต) and the sub-district (ตำบล / แขวง); the postcode fills in.
3. "Save address". The AI offers it when a deal ships a parcel. You can also ask the AI: "change my address to …" or "what is my saved address?".`,
  ai_chat: `AI Chat:
- Up to 5 saved chats on the left ("New chat"); the agent panel on the right shows its status and limits.
- Ask in Thai or English. Attach files with ＋, paste or drag and drop.
- The AI only drafts: it never moves money without your Confirm, and it treats documents as data (a document telling it to pay someone is flagged as a fraud signal).
- Share links (a private link for an outsider) have a Copy button.`,
  guarantors: `Guarantors (ผู้ค้ำประกัน):
1. When drafting, tell the AI whether a guarantor is required from the other side, from you, or both. The preview shows "🤝 Guarantor required".
2. On the deal's page, under "Your guarantor", press "+ Add": name, phone or email, relation, and the most they answer for (empty = your whole obligation). No ID card numbers.
3. A side that must name a guarantor cannot sign (accept) before it does. Someone without an account adds theirs on their link.
4. Guarantors are printed on the contract with a guarantee clause and signature lines, and listed on a complaint.`,
  revisions: `Rounds of changes:
- Each milestone has an agreed number of rounds of changes (0 to 10, the most the app allows). Tell the AI when drafting; the preview shows "↻ N rounds of changes".
- The buyer presses "Request changes (used/allowed)" on a delivered milestone. When all rounds are used, the button stops: approve the delivery, or ask the seller to refund it.`,
  expiry: `Offers expire:
- An offer must be signed (accepted) within 14 days. The deal's page and the other side's link show the last day.
- After that it is withdrawn automatically; a buyer's locked money comes back to their balance. Make a new offer if you still want the deal.`,
  terms_review: `The terms review:
- Every preview is checked for you before it can be confirmed: do the terms make sense, and do they put you at a disadvantage (e.g. a deposit over half the price, a review window under 24 hours, rules that make only you liable or let the other side cancel without paying)?
- If something is serious, the AI does not make the preview and explains how to fix it. Smaller points are shown on the card as warnings. Fair terms go through as usual.`,
  protection: `Previews and copying:
- Delivered images are shown only as small, grainy previews marked "PREVIEW D-<deal>" all over; the original file unlocks after you approve.
- Previews and website mockups blur when the window loses focus, and right-click, view-source and developer-tools shortcuts are blocked. A browser cannot fully stop screenshots, so the real protection is that the original stays encrypted until approval.`,
  split_payment: `Split payment (แบ่งจ่าย), not instalments (ผ่อน):
- ผ่อน (get the item first, pay later) does not exist in the app. แบ่งจ่าย does: you pay the price in parts on dates you choose, and only after the last part is the whole amount locked in escrow and the seller asked to deliver.
1. Tell the AI how to split, e.g. "3 equal parts a month apart" or "5,000 today and 4,000 on 30 Nov". The preview shows the parts and the button "Pay part 1 of N".
2. Confirm pays part 1. The parts wait in a holding account (not your balance), so they cannot be spent twice.
3. Pay the next parts on Deals → the deal's card ("Pay part 2 now"…). Paying the last part locks the deal in escrow at once.
4. "Stop & get my money back" returns everything paid. A part more than 7 days late ends the plan the same way.
- A seller can offer split payment too: the buyer starts it on the offer's page. Not for a buyer paying through a private link (they pay in one go).
- Split payment and a deposit (มัดจำ) work together: the buyer pays the parts first; when the last part is paid, the whole amount is locked, the deal is signed and the deposit goes to the seller at once; the other milestones are paid as each delivery is approved.`,
  public_link: `Private and public links:
- A PRIVATE link is for one person you already chose (someone without an account): made on Confirm, with a one-time code.
- A PUBLIC link is an open call, when you do not know who yet. Ask the AI, e.g. "post a public call for a logo designer, 6,000 baht in 2 milestones, applicants send a portfolio link and 2 samples".
1. The AI makes the post and gives you the link: share it anywhere (Facebook, LINE groups…). Anyone can open it and apply with a proposal, a price, portfolio links and up to 3 files. No account needed.
2. Deals → "Public posts": every application, its portfolio PDF (required), links and files, and the contact (only you see it). Attach documents for applicants there too (rules, a brief): they read them on the post's page. A post can hire several people ("hire 2 designers"): choose one per place.
3. "✦ AI: who fits best?" ranks them with a short reason, mainly on their portfolio PDF (it reads the text; it does not open links).
4. "Choose <name>" drafts the deal with them (it opens on its own page). Confirm it: their private link and one-time code are made; send both to their contact (the code separately). The post then stops taking applications. "Close" stops it any time.`,
  desktop_app: `Desktop app (macOS, Windows, Linux; test mode demo):
- What it is: your deals as your own chain on your computer. Every deal event (offer, payment locked, delivery, approval, dispute, ruling) is signed by the server and added as a block; each block names the one before it and is signed by your computer's key, so an old block cannot be changed without breaking the chain. This website keeps only your latest block (countersigned) and puts one fingerprint of everyone's latest blocks on the blockchain every hour (a public timestamp).
- When the other side of a deal also uses the app, the same event sits in both chains: "My chain" shows "✓ other party".
1. Download the app (website → Download) and install it. It opens in its own window (black title bar on macOS; the normal dark title bar on Windows).
2. Create your account on the website first (sign up, verify with the digital ID, your wallet opens). Then on the website: Profile → Desktop app → "Make a link code", and in the app "Link with code". Name the computer and choose an app passphrase (it encrypts the computer's key; nobody can reset it). The app has no sign-in of its own.
3. Money: top up (PromptPay QR or card through Stripe test mode in your browser, your linked card, or a demo counter slip). Friends: search by name, username or email, choose your own username, accept requests, Make payee. Private links: copy, new one-time code, reset a lost password, new link. Groups: create, join, vote on group payments (each vote is a signed block).
4. Use the app for everyday work, each move a block you sign: AI chat (draft deals, then "Confirm and sign" under the chat), Deals (Deliver with a file, note or parcel; Approve, Ask for changes, Preview, Accept, Refund), Contacts (Make payee / Stop paying), Activity (money in and out). The website is still where people without an account open their private links.
5. Profile → "My desktop app signs deal moves": moves pressed on the website then wait for your signature in the app ("Sign" or "Reject").
6. Settings → "Save key backup" and keep the file: on a new computer, "Restore from backup" with that file and your passphrase brings the chain back (the chain itself is backed up to the server encrypted; the server cannot read it). Lost computer: Profile → Desktop app → Remove.
- AI allowance: the AI has a token budget per day and per week for each person (Profile → Preferences and the app's Settings → AI show how much is left and when it resets). A person's own AI key in the desktop app is not limited.
- Everything the website does is in the app too (menu): Waiting for you, Summary (with AI explanation and CSV), Templates, Open calls (applicants, AI ranking, choose), Policy & limits (agent caps, pause, payees), Profile & privacy (preferences, delivery address, data export, delete account), Friends (send money, block, report, nicknames), Groups (wallet, deals and previews, act as, members and rules, invite link, leave, register a company), and on each deal "Details" (documents, files, guarantor, witness, decline or ask for a revised offer, split-payment parts, parcel tracking, website preview). The bell lists what waits for you; the search box finds deals, friends and groups; TH/EN switches the language. Identity checks stay on the website.
- Install: website → Download (or Profile → Desktop app). The app opens in its own window. macOS: open the .dmg, drag Kravii to Applications and open it from there (first start unpacks about 10 s; first time right-click → Open). Windows: run the Setup .exe and follow the steps; Kravii is then in the Start menu (SmartScreen: More info → Run anyway). Linux: extract, run ./installer (needs WebKitGTK 4.1). Updates: Settings → App version and updates says when a new version is out; install it over the old one (data stays). Closing the window keeps the app in the menu bar / tray; Quit is there.
- AI chat in the app: the website's layout and the same saved chats as the website (up to 20, per wallet; a group you act as has its own); replies stream as they are written. Each reply shows its tokens, model calls and tools; the side panel shows today's and this week's token allowance, this chat's tokens, the tools used, and calls from outside agents (MCP). Deal previews appear inside the reply with "Confirm and sign".
- AI settings (app menu): your own instructions for the AI (also used on the website; they never override the rules) and, optionally, your own Anthropic or OpenRouter key and model (kept sealed on your computer).
- Web search in the app's AI chat: the AI can search the web and read public pages, on the computer (no key; it never puts the person's data in a search). The Tools button next to the message box turns web search on or off (or "ask me before each search"), turns MCP servers on and off, and adds recommended ones.
- Display size in the app: Settings → Display size (fits the screen by default), or Ctrl/⌘ + and −, Ctrl/⌘ 0. The window remembers its size and position.
- MCP (app menu), finding servers: recommended ones that work as they are (DeepWiki, Context7, Microsoft Learn, Memory, Sequential thinking, Files in Documents) and a search of the official MCP Registry; "Add" adds one with one click (a server that needs a key is added turned off: fill it in under Edit config, then turn it on).
- MCP (app menu), part 1, MCP servers for the app's AI: add one by a GitHub link, an npm package, a server URL, a JSON config in the usual "mcpServers" format, or by pasting the server's code; they run on the computer with the app's own runtime (no Node needed) and their tools appear to the AI chat. The app asks before each call (or "always allow" a server); they cannot sign or pay.
- MCP, part 2, this app as an MCP server for other AI apps: turn the server on or off; allow or block reading, asking the wallet's AI, and requests for your signature; the JSON to add to any MCP client; which clients called, a call log with tokens, and the tool list. Every payment an agent asks for waits under "Requests from AI agents" for your Sign.
- Deals in the app and on the website: the Files filter shows deals that ask for documents, ask for a PDF, wait for a file from you, or have a file delivered to you to review.
- "Verify now" checks every block, that your latest block matches the server's countersigned one, and that it is in the blockchain anchor.`,
};

export function appGuide(topic: string | undefined): string {
  const t = GUIDE_TOPICS.find((x) => x === topic);
  if (t) return GUIDE[t];
  return `Topics: ${GUIDE_TOPICS.join(", ")}.\n\n${GUIDE.start}`;
}
