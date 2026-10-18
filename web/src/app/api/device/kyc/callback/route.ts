import { finishDeviceKyc } from "@/lib/device-chain/account";

const page = (ok: boolean, text: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Identity check</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#0f1216;color:#e8ebef;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
.c{max-width:420px;background:#171b21;border:1px solid #272d36;border-radius:14px;padding:22px}h1{font-size:18px;margin:0 0 8px}.s{color:#98a1ad;font-size:13px}</style></head>
<body><div class="c"><h1>${ok ? "Identity verified" : "Not verified"}</h1><p>${text.replace(/[&<>"']/g, "")}</p><p class="s">Go back to the Agentic Wallet app; you can close this tab. (Demo · mock digital ID)</p></div></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } },
  );

/** The digital ID sends the browser back here after a check started in the desktop app. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  try {
    const result = await finishDeviceKyc(url.origin, state, url.searchParams.get("code"), url.searchParams.get("error_description") ?? url.searchParams.get("error"));
    if (result === "ok") return page(true, "Your wallet account is open. The app finishes setting up your wallet.");
    if (result === "pending") return page(true, "A reviewer checks your identity; the app shows when it is approved.");
    return page(false, result);
  } catch (e) {
    console.error("device kyc callback", e);
    return page(false, "Verification failed. Start again in the app.");
  }
}
