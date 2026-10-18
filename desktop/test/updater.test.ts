import { describe, expect, test } from "bun:test";

import { newer, platformKey } from "../src/updater";

describe("updater", () => {
  test("compares versions part by part", () => {
    expect(newer("0.2.0", "0.1.0")).toBe(true);
    expect(newer("0.10.0", "0.9.9")).toBe(true);
    expect(newer("1.0.0", "1.0.0")).toBe(false);
    expect(newer("0.1.9", "0.2.0")).toBe(false);
    expect(newer("0.2.1", "0.2")).toBe(true);
  });

  test("names this computer like latest.json does", () => {
    expect(platformKey()).toMatch(/^(macos|windows|linux)-(x64|arm64)$/);
  });
});
