// Flags a Mock Bank customer as an admin (reviewer) so they can open /admin/chain.
//   npx tsx --conditions=react-server --env-file=.env.local scripts/make-admin.mts thai judge1 [--revoke]
// The customer must exist (sign up in the app first). Admin access is only ever granted here.
const [bank, username, flag] = process.argv.slice(2);
if (!bank || !username || !["thai", "chinese"].includes(bank)) {
  console.error("Usage: make-admin.mts <thai|chinese> <username> [--revoke]");
  process.exit(1);
}
const { db } = await import("../src/lib/db");
const currency = bank === "thai" ? "THB" : "CNY";
const updated = await db.bankCustomer.updateMany({
  where: { currency, username: username.toLowerCase() },
  data: { isAdmin: flag !== "--revoke" },
});
console.log(updated.count === 1 ? `${bank}:${username} is ${flag === "--revoke" ? "no longer" : "now"} an admin` : "No such customer");
process.exit(0);
