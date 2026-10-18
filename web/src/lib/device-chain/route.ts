import "server-only";

import { type DeviceRow, authDevice } from ".";
import { errorResponse, rateLimit } from "../guard";

export type RawBody = { bytes: Uint8Array; form: () => Promise<FormData> };

/**
 * A route the desktop app calls: the body's bytes are read once and the device signature checked
 * over them. JSON bodies arrive parsed; a multipart body (a delivered file) is parsed on demand.
 */
export function deviceRoute(handler: (device: DeviceRow, body: unknown, req: Request, raw: RawBody) => Promise<unknown>) {
  return async (req: Request) => {
    try {
      rateLimit(req, "device", 600, 60 * 60 * 1000);
      const bytes = req.method === "GET" ? new Uint8Array() : new Uint8Array(await req.arrayBuffer());
      const device = await authDevice(req, req.method === "GET" ? "" : bytes);
      let body: unknown = null;
      if (bytes.length && (req.headers.get("content-type") ?? "").includes("application/json")) {
        try {
          body = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
      }
      const type = req.headers.get("content-type") ?? "";
      const form = () => new Request(req.url, { method: "POST", headers: { "content-type": type }, body: bytes }).formData();
      const out = await handler(device, body, req, { bytes, form });
      return new Response(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), { headers: { "content-type": "application/json" } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
