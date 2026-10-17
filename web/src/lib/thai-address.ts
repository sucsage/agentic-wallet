import "server-only";

import TH from "@/data/th-address.json";

import { db } from "./db";

/**
 * Thai addresses: province → district → sub-district → postcode, from the thai-address-database
 * list (Sellsuki, ISC licence; 77 provinces, 927 districts, 7,470 sub-districts). The browser picks
 * from the same list (/api/address/th); here every saved address is checked against it, so a typo
 * never reaches a parcel.
 */

type Tree = [province: string, districts: [district: string, subdistricts: [name: string, postcode: string][]][]][];
export const THAI_ADDRESS = TH as Tree;

export class AddressError extends Error {}

export type SavedAddress = { recipient: string; phone: string; line: string; subdistrict: string; district: string; province: string; postcode: string };

/** "จ.เชียงใหม่", "จังหวัด เชียงใหม่", "อ. เมือง", "เขตบางรัก", "แขวง สีลม" → the bare name. */
const bare = (s: string) =>
  s
    .trim()
    .replace(/^(จังหวัด|จ\.|อำเภอ|อ\.|เขต|ตำบล|ต\.|แขวง)\s*/, "")
    .replace(/\s+/g, "");

const BANGKOK = "กรุงเทพมหานคร";

/** Checks the parts against the official list and fills the postcode (when the sub-district has one). */
export function checkAddress(input: SavedAddress): SavedAddress {
  const recipient = input.recipient.trim().slice(0, 120);
  const phone = input.phone.replace(/[^\d+]/g, "");
  const line = input.line.trim().slice(0, 200);
  if (recipient.length < 2) throw new AddressError("Enter the recipient's name");
  if (!/^(\+66|0)\d{8,9}$/.test(phone)) throw new AddressError("Enter a Thai phone number (e.g. 0812345678)");
  if (line.length < 3) throw new AddressError("Enter the house number and street (or village / building)");
  const pName = bare(input.province).replace(/^(กทม\.?|กรุงเทพฯ?)$/, BANGKOK);
  const p = THAI_ADDRESS.find(([name]) => name === pName);
  if (!p) throw new AddressError(`Unknown province "${input.province}"`);
  const dName = bare(input.district);
  const d = p[1].find(([name]) => name === dName || name === `เมือง${pName}` && dName === "เมือง");
  if (!d) throw new AddressError(`"${input.district}" is not a district of ${p[0]}`);
  const sName = bare(input.subdistrict);
  const matches = d[1].filter(([name]) => name === sName);
  if (!matches.length) throw new AddressError(`"${input.subdistrict}" is not a sub-district of ${d[0]}, ${p[0]}`);
  const postcode = input.postcode?.trim() || matches[0][1];
  if (!matches.some(([, code]) => code === postcode)) throw new AddressError(`The postcode of ${matches[0][0]}, ${d[0]} is ${matches.map(([, c]) => c).join(" or ")}`);
  return { recipient, phone, line, subdistrict: matches[0][0], district: d[0], province: p[0], postcode };
}

/** One line for a parcel label and the deal's ship-to (Bangkok uses แขวง / เขต). */
export function formatAddress(a: SavedAddress): string {
  const bkk = a.province === BANGKOK;
  return `${a.recipient}, ${a.phone}, ${a.line}, ${bkk ? "แขวง" : "ต."}${a.subdistrict} ${bkk ? "เขต" : "อ."}${a.district} ${bkk ? "" : "จ."}${a.province} ${a.postcode}`;
}

export async function savedAddress(userId: string): Promise<SavedAddress | null> {
  const row = await db.userAddress.findUnique({ where: { userId } });
  return row ? { recipient: row.recipient, phone: row.phone, line: row.line, subdistrict: row.subdistrict, district: row.district, province: row.province, postcode: row.postcode } : null;
}

export async function saveAddress(userId: string, input: SavedAddress): Promise<SavedAddress> {
  const a = checkAddress(input);
  await db.userAddress.upsert({ where: { userId }, update: a, create: { userId, ...a } });
  return a;
}
