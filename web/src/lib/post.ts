import "server-only";

import { randomInt } from "node:crypto";

/**
 * Mock Post: a stand-in for a carrier's booking and tracking API (shaped like Thailand Post's
 * track API), so a physical-goods deal can be followed from counter to doorstep in a demo.
 *
 * Tracking numbers follow the UPU S10 standard Thailand Post uses (e.g. EF123456785TH): two
 * letters, eight digits, a check digit and the country code. A parcel moves one stage every
 * POST_STEP_SECONDS (60 s by default) after it is booked, so a demo shows it delivered in minutes.
 * Numbers from other carriers can be recorded too; they are not tracked here, and the buyer
 * confirms receipt themselves.
 */

export const CARRIERS = ["MOCK_POST", "THAILAND_POST", "KERRY", "FLASH", "OTHER"] as const;
export type Carrier = (typeof CARRIERS)[number];

export const CARRIER_LABEL: Record<Carrier, string> = {
  MOCK_POST: "Mock Post (Thailand Post sandbox)",
  THAILAND_POST: "Thailand Post",
  KERRY: "Kerry Express",
  FLASH: "Flash Express",
  OTHER: "Other carrier",
};

const WEIGHTS = [8, 6, 4, 2, 3, 5, 9, 7];

/** The S10 check digit of eight serial digits. */
function s10Check(serial: string): number {
  const sum = [...serial].reduce((t, d, i) => t + Number(d) * WEIGHTS[i], 0);
  const c = 11 - (sum % 11);
  return c === 10 ? 0 : c === 11 ? 5 : c;
}

export function isS10(tracking: string): boolean {
  const m = /^[A-Z]{2}(\d{8})(\d)[A-Z]{2}$/.exec(tracking);
  return m !== null && s10Check(m[1]) === Number(m[2]);
}

/** Books a parcel with Mock Post: a fresh, valid EMS-style tracking number. */
export function bookParcel(): string {
  const serial = String(randomInt(0, 100_000_000)).padStart(8, "0");
  return `EF${serial}${s10Check(serial)}TH`;
}

/** Normalises and checks a tracking number for a carrier; returns an error message or null. */
export function checkTracking(carrier: Carrier, tracking: string): string | null {
  if (!/^[A-Z0-9-]{8,30}$/.test(tracking)) return "A tracking number is 8-30 letters and digits";
  if ((carrier === "MOCK_POST" || carrier === "THAILAND_POST") && !isS10(tracking)) {
    return "Not a valid Thailand Post number (e.g. EF123456785TH; the check digit does not match)";
  }
  return null;
}

export type TrackingEvent = { code: number; status: string; location: string; at: string };

const STAGES: { code: number; status: string; location: string }[] = [
  { code: 103, status: "Accepted at the post office", location: "Hat Yai post office" },
  { code: 201, status: "In transit to the sorting centre", location: "Songkhla mail centre" },
  { code: 206, status: "Arrived at the destination post office", location: "Destination post office" },
  { code: 301, status: "Out for delivery", location: "Destination post office" },
  { code: 501, status: "Delivered · signed for by the recipient", location: "Recipient's address" },
];

const stepMs = () => Number(process.env.POST_STEP_SECONDS ?? 60) * 1000;

/** Demo / test: the shipping time that makes a Mock Post parcel show as delivered right now. */
export const deliveredShippedAt = (now = Date.now()) => new Date(now - STAGES.length * stepMs());

/**
 * Where a parcel is now. Only Mock Post parcels are tracked; for any other carrier the result
 * says so and `delivered` is null (unknown).
 */
export function trackParcel(carrier: Carrier, shippedAt: Date, now = Date.now()) {
  if (carrier !== "MOCK_POST") {
    return { tracked: false as const, delivered: null, events: [] as TrackingEvent[], status: "Not tracked here · the buyer confirms receipt" };
  }
  const reached = Math.min(STAGES.length, Math.floor((now - shippedAt.getTime()) / stepMs()) + 1);
  const events = STAGES.slice(0, Math.max(1, reached)).map((s, i) => ({
    ...s,
    at: new Date(shippedAt.getTime() + i * stepMs()).toISOString(),
  }));
  const last = events[events.length - 1];
  return { tracked: true as const, delivered: last.code === 501, events: events.reverse(), status: last.status };
}
