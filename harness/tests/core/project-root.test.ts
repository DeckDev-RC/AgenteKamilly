import { describe, expect, it } from "vitest";

import { resolveProjectRoot } from "../../src/core/project-root.js";

describe("resolveProjectRoot", () => {
  it("resolves the repo root when cwd is harness/", () => {
    expect(resolveProjectRoot("C:/Kamilly/harness")).toBe("C:\\Kamilly");
  });

  it("resolves the repo root from nested harness build output", () => {
    expect(resolveProjectRoot("C:/Kamilly/harness/out/main")).toBe("C:\\Kamilly");
  });

  it("keeps cwd when already at repo root", () => {
    expect(resolveProjectRoot("C:/Kamilly")).toBe("C:\\Kamilly");
  });
});
