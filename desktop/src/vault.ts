import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

import { type Hex, keccak256, concat, toHex } from "viem";

import { vaultPath } from "./paths";

/**
 * The device key, encrypted with the user's passphrase (scrypt + AES-256-GCM), with what the app
 * knows about its link. The private key only exists unencrypted in memory while the app is unlocked.
 */
export type VaultFile = {
  v: 1;
  address: string;
  server: string;
  serverSigner: string;
  wallet: string;
  user: string;
  deviceName: string;
  linkedAt: number;
  kdf: { salt: string; N: number; r: number; p: number };
  iv: string;
  tag: string;
  key: string;
};

const N = 1 << 15;

function kdf(passphrase: string, salt: Buffer, n = N) {
  return scryptSync(passphrase.normalize("NFKC"), salt, 32, { N: n, r: 8, p: 1, maxmem: 128 * n * 8 * 2 });
}

export function sealKey(privateKey: Hex, passphrase: string, meta: Omit<VaultFile, "v" | "kdf" | "iv" | "tag" | "key">): VaultFile {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", kdf(passphrase, salt), iv);
  const key = Buffer.concat([c.update(Buffer.from(privateKey.slice(2), "hex")), c.final()]);
  return { v: 1, ...meta, kdf: { salt: salt.toString("base64"), N, r: 8, p: 1 }, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), key: key.toString("base64") };
}

export class WrongPassphrase extends Error {}

export function openKey(file: VaultFile, passphrase: string): Hex {
  try {
    const d = createDecipheriv("aes-256-gcm", kdf(passphrase, Buffer.from(file.kdf.salt, "base64"), file.kdf.N), Buffer.from(file.iv, "base64"));
    d.setAuthTag(Buffer.from(file.tag, "base64"));
    return `0x${Buffer.concat([d.update(Buffer.from(file.key, "base64")), d.final()]).toString("hex")}`;
  } catch {
    throw new WrongPassphrase("Wrong passphrase");
  }
}

export const hasVault = () => existsSync(vaultPath());
export const readVault = (): VaultFile => JSON.parse(readFileSync(vaultPath(), "utf8"));
export function writeVault(file: VaultFile) {
  writeFileSync(vaultPath(), JSON.stringify(file, null, 2), { mode: 0o600 });
  try {
    chmodSync(vaultPath(), 0o600);
  } catch {
    // Windows: the per-user AppData folder is private already.
  }
}

/** The chain backup's key: derived from the device key, so only this key can read the backup. */
const backupKey = (privateKey: Hex) => Buffer.from(keccak256(concat([privateKey, toHex("agentic-wallet chain backup v1")])).slice(2), "hex");

export function sealBackup(privateKey: Hex, data: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", backupKey(privateKey), iv);
  const ct = Buffer.concat([c.update(Buffer.from(data, "utf8")), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function openBackup(privateKey: Hex, sealed: string): string {
  const b = Buffer.from(sealed, "base64");
  const d = createDecipheriv("aes-256-gcm", backupKey(privateKey), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
