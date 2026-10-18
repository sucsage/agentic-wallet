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
