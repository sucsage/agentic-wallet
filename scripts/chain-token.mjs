// Issues the bearer token that lets the web app (and deploys) call the private chain's RPC.
// Besu checks it itself (--rpc-http-authentication-*), so no proxy is needed in front of it.
//   node scripts/chain-token.mjs [days=90]
// First run creates an RSA key pair: the private key stays in .secrets/chain-jwt-private.pem,
// the public key goes to chain/jwt-public.pem (copy it with chain/ to the chain server).
// The token is written to .secrets/chain-token.txt; put it in Vercel as CHAIN_TOKEN.
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const days = Number(process.argv[2] ?? 90);
const privPath = ".secrets/chain-jwt-private.pem";
if (!existsSync(privPath)) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  writeFileSync("chain/jwt-public.pem", publicKey.export({ type: "spki", format: "pem" }));
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const body = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ permissions: ["*:*"], iat: now, exp: now + days * 86400 })}`;
const sig = sign("RSA-SHA256", Buffer.from(body), createPrivateKey(readFileSync(privPath))).toString("base64url");
writeFileSync(".secrets/chain-token.txt", `${body}.${sig}\n`, { mode: 0o600 });
console.log(`Token valid for ${days} days written to .secrets/chain-token.txt (public key: chain/jwt-public.pem)`);
