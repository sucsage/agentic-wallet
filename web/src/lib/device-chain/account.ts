import "server-only";

import { type Address, type Hex, getAddress, isAddress, isHex } from "viem";

import { auth } from "../auth";
import { createUserWallet } from "../bank/create-wallet";
import { db } from "../db";
import { CLIENT_ID, clientSecret, kycOf, pkceChallenge, randomToken, verifyIdToken } from "../kyc";
import { type KycInput, KycError, submitKyc } from "../onboarding";
import { securityOf } from "../two-factor";
import { primaryWalletAddress } from "../user-wallets";
import { type DeviceRow, DeviceError, serverSigner } from ".";
import { accountMessage, signerOf } from "./format";
import { selfOrigin } from "../origins";

/**
 * The desktop app as the way in: make an account or sign in, verify identity, get the wallet, all
 * from the app. The device proves it holds its key by signing the email with it, and is linked to
 * the account in the same step (no link code). A device of an account still being set up has an
 * empty walletAddress until the wallet exists.
 */

type AccountInput = { email: string; password: string; name?: string; address: string; deviceName: string; os: string; sig: string };

async function checkDeviceSig(kind: "signup" | "login", input: AccountInput): Promise<Address> {
  if (!isAddress(input.address) || !isHex(input.sig)) throw new DeviceError(400, "Invalid device");
  const address = getAddress(input.address);
  if ((await signerOf(accountMessage(kind, input.email, address), input.sig as Hex).catch(() => null)) !== address) throw new DeviceError(400, "The device signature does not match");
  if (await db.device.findUnique({ where: { address } })) throw new DeviceError(409, "This device key is already linked");
  return address;
}

async function linkTo(userId: string, address: Address, input: AccountInput) {
  const wallet = (await primaryWalletAddress(userId)) ?? "";
  await db.device.create({
    data: { address, userId, walletAddress: wallet, name: input.deviceName.trim().slice(0, 60) || "My computer", os: input.os.trim().slice(0, 30) || "unknown" },
  });
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  return { device: address, server: serverSigner(), user: user.name, wallet: wallet || null };
}

/** The app's sessions are its key: the browser-style session Better Auth makes on sign-in is dropped. */
const dropSession = (token: string | null | undefined) => (token ? db.session.deleteMany({ where: { token } }).catch(() => null) : null);

const authMessage = (e: unknown, fallback: string): string => {
  const m = e && typeof e === "object" && "body" in e ? (e as { body?: { message?: unknown } }).body?.message : undefined;
  return typeof m === "string" && m ? m : fallback;
};

export async function signupFromDevice(input: AccountInput & { name: string }) {
  const address = await checkDeviceSig("signup", input);
  const r = await auth.api.signUpEmail({ body: { name: input.name.trim().slice(0, 80), email: input.email.trim().toLowerCase(), password: input.password } }).catch((e) => {
    throw new DeviceError(400, authMessage(e, "Could not create the account (is the email already used?)"));
  });
  await dropSession(r.token);
  return linkTo(r.user.id, address, input);
}

export async function loginFromDevice(input: AccountInput) {
  const address = await checkDeviceSig("login", input);
  const r = await auth.api.signInEmail({ body: { email: input.email.trim().toLowerCase(), password: input.password } }).catch(() => {
    throw new DeviceError(401, "Wrong email or password");
  });
  await dropSession(r.token);
  // A second factor cannot be checked here: such accounts link with a code made on the website.
  if ((await securityOf(r.user.id)).enabled) throw new DeviceError(403, "Your account uses a second factor: link this computer with a code from the website (Profile → Desktop app)");
  return linkTo(r.user.id, address, input);
}

/** Where the account is in setting up, and the wallet once it exists (the device then records it). */
export async function setupStatus(device: DeviceRow) {
  const [kyc, application, customer] = await Promise.all([
    kycOf(device.userId),
    db.kycApplication.findUnique({ where: { userId: device.userId }, select: { status: true } }),
    db.bankCustomer.findUnique({ where: { userId: device.userId }, select: { currency: true } }),
  ]);
  let wallet = device.walletAddress || null;
  if (!wallet) {
    const w = await primaryWalletAddress(device.userId);
    if (w) {
      await db.device.update({ where: { address: device.address }, data: { walletAddress: w } });
      wallet = w;
    }
  }
  const flow = await db.deviceKycFlow.findFirst({ where: { deviceAddress: device.address }, orderBy: { createdAt: "desc" }, select: { result: true, doneAt: true } });
  return {
    identity: kyc ? "VERIFIED" : (application?.status ?? "NONE"),
    lastCheck: flow?.result ?? null,
    account: customer ? customer.currency : null,
    wallet,
  };
}

/** Starts identity verification for the app: the browser opens the national digital ID's page. */
export async function startDeviceKyc(device: DeviceRow, origin: string, country: "TH" | "CN") {
  if (await kycOf(device.userId)) throw new DeviceError(409, "Your identity is already verified");
  const customer = await db.bankCustomer.findUnique({ where: { userId: device.userId } });
  const c = customer ? (customer.currency === "CNY" ? "CN" : "TH") : country;
  const provider = c === "TH" ? "THAID" : "CN_NETID";
  const flow = { state: randomToken(), nonce: randomToken(), verifier: randomToken(32) };
  await db.deviceKycFlow.create({ data: { ...flow, deviceAddress: device.address, userId: device.userId, provider, expiresAt: new Date(Date.now() + 10 * 60_000) } });
  const user = await db.user.findUniqueOrThrow({ where: { id: device.userId }, select: { name: true } });
  const q = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: `${origin}/api/device/kyc/callback`,
    scope: provider === "THAID" ? "openid pid name birthdate" : "openid wh name_match",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: pkceChallenge(flow.verifier),
    code_challenge_method: "S256",
    login_hint: customer?.displayName ?? user.name,
  });
  return { url: `${origin}/mock-id/${provider === "THAID" ? "thaid" : "netid"}/authorize?${q}` };
}

/** The ID provider sends the browser back: exchange the code (server to server) and record the identity. */
export async function finishDeviceKyc(origin: string, state: string, code: string | null, error: string | null): Promise<string> {
  const flow = await db.deviceKycFlow.findUnique({ where: { state } });
  if (!flow || flow.doneAt || flow.expiresAt < new Date()) return "This verification expired. Start again in the app.";
  const done = (result: string) => db.deviceKycFlow.update({ where: { state }, data: { result, doneAt: new Date() } }).then(() => result);
  if (error) return done(error);
  if (!code) return done("No authorization code");
  const slug = flow.provider === "THAID" ? "thaid" : "netid";
  const res = await fetch(new URL(`/api/mock-id/${slug}/token`, selfOrigin()), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${origin}/api/device/kyc/callback`, client_id: CLIENT_ID, client_secret: clientSecret(), code_verifier: flow.verifier }),
  });
  const token = (await res.json()) as { id_token?: string; error_description?: string };
  if (!res.ok || !token.id_token) return done(token.error_description ?? "The ID provider refused the code");
  const claims = await verifyIdToken(flow.provider as "THAID" | "CN_NETID", token.id_token, flow.nonce);
  const user = await db.user.findUniqueOrThrow({ where: { id: flow.userId } });
  let input: KycInput;
  if (flow.provider === "THAID") {
    const name = `${claims.given_name ?? ""} ${claims.family_name ?? ""}`.trim();
    input = { method: "THAID", legalName: name || String(claims.name_th ?? user.name), pid: String(claims.pid ?? ""), birthDate: claims.birthdate ? String(claims.birthdate) : undefined };
  } else {
    if (claims.name_match !== true) return done("The National Network Identity holder is not the person who signed up (check the name)");
    input = { method: "CN_NETID", legalName: user.name, wh: String(claims.wh ?? "") };
  }
  const r = await submitKyc(flow.userId, input).catch((e) => {
    if (e instanceof KycError) return e.message;
    throw e;
  });
  if (typeof r === "string") return done(r);
  return done(r.customer ? "ok" : "pending");
}

/** After the identity check: the wallet (deployed once), recorded on the device. */
export async function finishDeviceSetup(device: DeviceRow) {
  const w = await createUserWallet(device.userId);
  await db.device.update({ where: { address: device.address }, data: { walletAddress: w.address } });
  return { wallet: w.address };
}
