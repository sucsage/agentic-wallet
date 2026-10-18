/**
 * Is a delivery address complete enough to ship a parcel to? Free text (Thai or Chinese style), so
 * the check looks for the parts a courier needs rather than parsing it: the recipient's name, a
 * phone number, a house number / street, the district and province (city), and the postcode.
 */
export function addressGaps(text: string): string[] {
  const t = text.trim();
  if (t.length < 10) return ["the full delivery address (recipient's name, phone, house number and street, sub-district, district, province, postcode)"];
  const gaps: string[] = [];
  const digits = t.replace(/[\s-]/g, "");
  const thPostcode = /(^|\D)\d{5}(\D|$)/.test(t);
  const cnPostcode = /(^|\D)\d{6}(\D|$)/.test(t.replace(/1\d{10}/g, ""));
  const phone = /(^|\D)0\d{8,9}(\D|$)/.test(digits) || /(^|\D)\+?66\d{8,9}(\D|$)/.test(digits) || /(^|\D)1\d{10}(\D|$)/.test(digits);
  if (!phone) gaps.push("the recipient's phone number");
  if (!thPostcode && !cnPostcode) gaps.push("the postcode");
  // A house / room number before the postcode, e.g. "99/12", "No. 8", "8号".
  if (!/\d+\s*\/\s*\d+|(^|\s)(no\.?|เลขที่|บ้านเลขที่)\s*\d|\d+\s*(号|室|หมู่|ม\.)|^\s*\d+/i.test(t) && !/\d+[^\d]{2,}.*\d{5,6}/.test(t)) gaps.push("the house number and street");
  const provinceWords = /(จังหวัด|จ\.|province|กรุงเทพ|bangkok|เขต|อำเภอ|อ\.|district|省|市|区|县|city)/i;
  if (!provinceWords.test(t) && t.split(/[,\n]/).filter((p) => p.trim()).length < 3) gaps.push("the district and province (or city)");
  // The recipient's name: some letters before the first digit.
  if (!/[A-Za-z฀-๿一-鿿]{2,}/.test(t.split(/\d/)[0] ?? "")) gaps.push("the recipient's name");
  return gaps;
}
