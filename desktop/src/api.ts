import type { PrivateKeyAccount } from "viem/accounts";

import { requestMessage } from "../../web/src/lib/device-chain/format";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let lastTime = 0;
/** Request times only go up (the server refuses a time it has already seen). */
const nextTime = () => (lastTime = Math.max(Date.now(), lastTime + 1));

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `The server answered ${res.status}`);
  return json as T;
}

/** A request signed by the device key (method, path, time and body). */
export async function signed<T>(server: string, account: PrivateKeyAccount, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const time = nextTime();
  const sig = await account.signMessage({ message: requestMessage(method, path, time, text) });
  const res = await fetch(new URL(path, server), {
    method,
    headers: { "content-type": "application/json", "x-aw-device": account.address, "x-aw-time": String(time), "x-aw-sig": sig },
    body: method === "GET" ? undefined : text,
  }).catch((e) => {
    throw new ApiError(0, `Cannot reach ${new URL(server).host}: ${e instanceof Error ? e.message : e}`);
  });
  return parse<T>(res);
}

export async function plain<T>(server: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(new URL(path, server), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch((e) => {
    throw new ApiError(0, `Cannot reach ${new URL(server).host}: ${e instanceof Error ? e.message : e}`);
  });
  return parse<T>(res);
}

/** A signed multipart request (a delivered file): the signature covers the exact bytes sent. */
export async function signedForm<T>(server: string, account: PrivateKeyAccount, path: string, form: FormData): Promise<T> {
  const packed = new Request("http://local/", { method: "POST", body: form });
  // Read the boundary before the body: Bun fills this header lazily and drops it once the body is consumed.
  const type = packed.headers.get("content-type");
  if (!type?.startsWith("multipart/form-data")) throw new ApiError(0, "Could not pack the file");
  const bytes = new Uint8Array(await packed.arrayBuffer());
  const time = nextTime();
  const sig = await account.signMessage({ message: requestMessage("POST", path, time, bytes) });
  const res = await fetch(new URL(path, server), {
    method: "POST",
    headers: { "content-type": type, "x-aw-device": account.address, "x-aw-time": String(time), "x-aw-sig": sig },
    body: bytes,
  }).catch((e) => {
    throw new ApiError(0, `Cannot reach ${new URL(server).host}: ${e instanceof Error ? e.message : e}`);
  });
  return parse<T>(res);
}

/**
 * A signed call to one of the website's own routes (lib/device-chain/bridge.ts on the server): any
 * method, the body's exact bytes, and the answer handed back as it came (JSON, a document, a file).
 */
export async function signedRaw(server: string, account: PrivateKeyAccount, method: string, path: string, body: Uint8Array | null, contentType: string | null): Promise<Response> {
  const bytes = body ?? new Uint8Array();
  const time = nextTime();
  const sig = await account.signMessage({ message: requestMessage(method, path, time, bytes) });
  const headers: Record<string, string> = { "x-aw-device": account.address, "x-aw-time": String(time), "x-aw-sig": sig };
  if (contentType) headers["content-type"] = contentType;
  return fetch(new URL(path, server), { method, headers, body: method === "GET" || method === "HEAD" ? undefined : (bytes as Uint8Array<ArrayBuffer>), redirect: "manual" }).catch((e) => {
    throw new ApiError(0, `Cannot reach ${new URL(server).host}: ${e instanceof Error ? e.message : e}`);
  });
}
