import "server-only";

import { type DeviceRow, authDevice } from ".";
import { errorResponse, rateLimit } from "../guard";

/** A route the desktop app calls: the body is read once, the device signature checked over it. */
export function deviceRoute(handler: (device: DeviceRow, body: unknown, req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    try {
      rateLimit(req, "device", 600, 60 * 60 * 1000);
      const text = req.method === "GET" ? "" : await req.text();
      const device = await authDevice(req, text);
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
      }
      return Response.json(await handler(device, body, req));
    } catch (err) {
      return errorResponse(err);
    }
  };
}
