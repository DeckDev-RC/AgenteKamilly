import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { bootstrapPackagedUserData } from "../../src/desktop/bootstrap-user-data.js";

describe("bootstrapPackagedUserData", () => {
  let tempDir = "";

  afterEach(() => {
    tempDir = "";
  });

  it("creates folders and seeds .env from the packaged template", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "confere-bootstrap-"));
    const resourcesDir = path.join(tempDir, "resources");
    const dataDir = path.join(tempDir, "userData");
    const templatePath = path.join(resourcesDir, "default.env");
    mkdirSync(resourcesDir, { recursive: true });
    writeFileSync(templatePath, "RUNTIME_MODE=dry-run\nALLOW_LIVE_MUTATIONS=false\n", "utf-8");

    bootstrapPackagedUserData(dataDir, resourcesDir);

    const env = readFileSync(path.join(dataDir, ".env"), "utf-8");
    expect(env).toContain("ALLOW_LIVE_MUTATIONS=false");
    expect(existsSync(path.join(dataDir, "artifacts", "ledger"))).toBe(true);
    expect(existsSync(path.join(dataDir, "contaazul"))).toBe(true);
  });

  it("does not overwrite an existing .env", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "confere-bootstrap-"));
    const dataDir = path.join(tempDir, "userData");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(dataDir, ".env"), "CUSTOM=value\n", "utf-8");

    bootstrapPackagedUserData(dataDir, path.join(tempDir, "resources"));

    expect(readFileSync(path.join(dataDir, ".env"), "utf-8")).toBe("CUSTOM=value\n");
  });
});
