import { describe, expect, it } from "vitest";

import { formatDateBrInput, formatMoneyBrInput, formatPhoneBrInput } from "../../src/ui/lib/input-masks.js";

describe("input-masks", () => {
  it("formats date as DD/MM/AAAA while typing", () => {
    expect(formatDateBrInput("3")).toBe("3");
    expect(formatDateBrInput("3006")).toBe("30/06");
    expect(formatDateBrInput("30062026")).toBe("30/06/2026");
  });

  it("formats money as Brazilian decimal", () => {
    expect(formatMoneyBrInput("1")).toBe("0,01");
    expect(formatMoneyBrInput("1000")).toBe("10,00");
  });

  it("formats phone with DDD and hyphen", () => {
    expect(formatPhoneBrInput("62991514384")).toBe("(62) 99151-4384");
  });
});
