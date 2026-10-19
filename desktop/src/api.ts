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

/**
 * How long a call to the website may take. A request that hangs (the network, a slow database
 * moment) must not hold the app: chain moves run one at a time, so one stuck call would leave every
 * button after it waiting. The website's own limit is 60 s per request.
 */
export const CALL_TIMEOUT = 75_000;
const UPLOAD_TIMEOUT = 180_000;
const cannotReach = (server: string, e: unknown) =>
  new ApiError(0, e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? `${new URL(server).host} did not answer in time: try again` : `Cannot reach ${new URL(server).host}: ${e instanceof Error ? e.message : e}`);

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
    signal: AbortSignal.timeout(CALL_TIMEOUT),
  }).catch((e) => {
    throw cannotReach(server, e);
  });
  return parse<T>(res).catch((e) => {
    throw e instanceof ApiError ? e : cannotReach(server, e);
  });
}

export async function plain<T>(server: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(new URL(path, server), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(CALL_TIMEOUT) }).catch((e) => {
    throw cannotReach(server, e);
  });
  return parse<T>(res).catch((e) => {
    throw e instanceof ApiError ? e : cannotReach(server, e);
  });
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
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT),
  }).catch((e) => {
    throw cannotReach(server, e);
  });
  return parse<T>(res).catch((e) => {
    throw e instanceof ApiError ? e : cannotReach(server, e);
  });
}

/**
 * A signed call to one of the website's own routes (lib/device-chain/bridge.ts on the server): any
 * method, the body's exact bytes, and the answer handed back as it came (JSON, a document, a file).
 */
export async function signedRaw(server: string, account: PrivateKeyAccount, method: string, path: string, body: Uint8Array | null, contentType: string | null, accept?: string): Promise<Response> {
  const bytes = body ?? new Uint8Array();
  const time = nextTime();
  const sig = await account.signMessage({ message: requestMessage(method, path, time, bytes) });
  const headers: Record<string, string> = { "x-aw-device": account.address, "x-aw-time": String(time), "x-aw-sig": sig };
  if (contentType) headers["content-type"] = contentType;
  if (accept) headers.accept = accept;
  // A stream (the AI chat) may run for minutes once it has started: the limit is on getting an answer
  // at all. Anything else gets the usual limit for the whole call.
  const stream = accept === "text/event-stream";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException("timeout", "TimeoutError")), stream ? CALL_TIMEOUT : body && body.length > 1_000_000 ? UPLOAD_TIMEOUT : CALL_TIMEOUT);
  try {
    const res = await fetch(new URL(path, server), { method, headers, body: method === "GET" || method === "HEAD" ? undefined : (bytes as Uint8Array<ArrayBuffer>), redirect: "manual", signal: ctl.signal });
    if (stream) clearTimeout(timer);
    else {
      // Read the whole answer inside the time limit, then hand it on.
      const buf = await res.arrayBuffer();
      clearTimeout(timer);
      // The body is already decoded: drop the headers that describe the encoded one.
      const h = new Headers(res.headers);
      h.delete("content-encoding");
      h.delete("content-length");
      return new Response(buf, { status: res.status, statusText: res.statusText, headers: h });
    }
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw cannotReach(server, e);
  }
}
