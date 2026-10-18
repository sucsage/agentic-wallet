// The device key at rest: passphrase-sealed; the chain backup and local secrets are sealed with keys
// derived from the device key, each for its own purpose.
import { describe, expect, test } from "bun:test";
import { generatePrivateKey } from "viem/accounts";

import { WrongPassphrase, openBackup, openKey, openLocal, sealBackup, sealKey, sealLocal } from "../src/vault";

const meta = { address: "0x0", server: "http://x", serverSigner: "0x0", wallet: "", user: "t", deviceName: "t", linkedAt: 0 };

describe("vault", () => {
  const key = generatePrivateKey();
  const v = sealKey(key, "correct horse battery", meta);
  test("the right passphrase opens it; the file holds no plain key", () => {
    expect(openKey(v, "correct horse battery")).toBe(key);
    expect(JSON.stringify(v)).not.toContain(key.slice(2));
  });
  test("a wrong passphrase is refused", () => {
    expect(() => openKey(v, "wrong horse battery")).toThrow(WrongPassphrase);
  });
  test("a tampered vault is refused (AES-GCM tag)", () => {
    const bad = { ...v, key: Buffer.from(Buffer.from(v.key, "base64").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64") };
    expect(() => openKey(bad, "correct horse battery")).toThrow();
  });
  test("a backup opens only with the same device key, and not with the local-secret key", () => {
    const sealed = sealBackup(key, "chain");
    expect(openBackup(key, sealed)).toBe("chain");
    expect(() => openBackup(generatePrivateKey(), sealed)).toThrow();
    expect(() => openLocal(key, sealed)).toThrow();
  });
  test("the user's own AI key is sealed and opens only on this device", () => {
    const s = sealLocal(key, '{"apiKey":"sk-test-not-real"}');
    expect(s).not.toContain("sk-test");
    expect(openLocal(key, s)).toContain("sk-test-not-real");
    expect(() => openLocal(generatePrivateKey(), s)).toThrow();
  });
});
