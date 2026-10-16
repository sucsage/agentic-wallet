import "server-only";

/**
 * Transactional email through Resend's HTTP API (no SDK). Without RESEND_API_KEY nothing is sent:
 * in development the message is printed to the server log instead, and in production the caller
 * gets an error, so the app never says "we emailed you" when it did not.
 */
export const emailEnabled = Boolean(process.env.RESEND_API_KEY);

export async function sendEmail({ to, subject, text, html }: { to: string; subject: string; text: string; html?: string }) {
  if (!emailEnabled) {
    if (process.env.NODE_ENV === "production") throw new Error("Email is not set up on this server");
    console.log(`[email, not sent: RESEND_API_KEY unset] to=${to} subject=${subject}\n${text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "MilestonePay <onboarding@resend.dev>", to, subject, text, html }),
  });
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}
