import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { saveJsonArtifact, saveTextArtifact } from "../../src/core/artifacts.js";

describe("artifacts", () => {
  it("saves artifacts under provider and operation directories", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-artifacts-"));

    const artifact = await saveTextArtifact({
      artifactsDir: dir,
      provider: "asaas",
      operationId: "op_test",
      label: "redacted request",
      fileName: "request.txt",
      contents: "hello"
    });

    expect(artifact.kind).toBe("txt");
    expect(artifact.path).toBe(path.join(dir, "asaas", "op_test", "request.txt"));
    expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(readFile(artifact.path, "utf8")).resolves.toBe("hello");
  });

  it("saves JSON artifacts with stable formatting", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-artifacts-"));

    const artifact = await saveJsonArtifact({
      artifactsDir: dir,
      provider: "contaazul",
      operationId: "op_json",
      label: "plan",
      fileName: "plan.json",
      contents: { ok: true }
    });

    expect(artifact.kind).toBe("json");
    expect(artifact.path).toBe(path.join(dir, "contaazul", "op_json", "plan.json"));
    await expect(readFile(artifact.path, "utf8")).resolves.toBe("{\n  \"ok\": true\n}\n");
  });
});
