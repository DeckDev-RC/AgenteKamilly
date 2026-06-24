import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readEnvKey, resolveEnvFilePath, upsertEnvKey } from "../../src/core/env-settings.js";

describe("env-settings", () => {
  let tempDir = "";

  afterEach(() => {
    tempDir = "";
  });

  it("creates and updates keys in the env file", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "confere-env-"));
    const envPath = resolveEnvFilePath(tempDir);

    upsertEnvKey(envPath, "ALLOW_LIVE_MUTATIONS", "true");
    upsertEnvKey(envPath, "GEMINI_API_KEY", "secret-key");

    const content = readFileSync(envPath, "utf-8");
    expect(content).toContain('ALLOW_LIVE_MUTATIONS="true"');
    expect(content).toContain('GEMINI_API_KEY="secret-key"');

    upsertEnvKey(envPath, "ALLOW_LIVE_MUTATIONS", "false");
    expect(readEnvKey(envPath, "ALLOW_LIVE_MUTATIONS")).toBe("false");
    expect(readEnvKey(envPath, "GEMINI_API_KEY")).toBe("secret-key");
  });
});
