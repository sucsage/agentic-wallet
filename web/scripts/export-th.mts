// Writes the website's Thai strings for the desktop app (desktop/src/ui/th-web.json). Run after changing lib/i18n.tsx:
//   npx tsx scripts/export-th.mts
import { writeFileSync } from "node:fs";

import { thaiDictionary } from "../src/lib/i18n";

const dict = thaiDictionary();
writeFileSync(new URL("../../desktop/src/ui/th-web.json", import.meta.url), JSON.stringify(dict, null, 0) + "\n");
console.log(`${Object.keys(dict).length} strings`);
