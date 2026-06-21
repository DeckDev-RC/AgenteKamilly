import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadHarnessConfig } from "../../src/core/config.js";
import {
  createDefaultMappedToolRegistry,
  resolveConfigCwd
} from "../../src/core/harness-runtime.js";

describe("harness runtime", () => {
  it("resolves config cwd from the harness directory", () => {
    const root = path.join(os.tmpdir(), "confere-project");
    const cwd = path.join(root, "harness");

    expect(resolveConfigCwd(cwd)).toBe(path.resolve(root).replace(/\\/g, "/"));
  });

  it("returns an empty registry plus warnings when provider session files are absent", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "confere-runtime-empty-"));
    const config = loadHarnessConfig({}, cwd);

    const { registry, warnings } = await createDefaultMappedToolRegistry(config);

    expect(registry.list()).toEqual([]);
    expect(warnings).toEqual([
      `Asaas session env not found: ${config.asaasEnvPath}`,
      `Conta Azul state not found: ${config.contaAzulStatePath}`
    ]);
  });

  it("registers the Asaas boleto workflow when the Asaas env exists", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "confere-runtime-asaas-"));
    const config = loadHarnessConfig({}, cwd);
    await writeFile(config.asaasEnvPath, "COOKIE_STRING=session=test\n", "utf-8");

    const { registry, warnings } = await createDefaultMappedToolRegistry(config);

    expect(registry.list().map((tool) => tool.name)).toContain(
      "asaas.create_boleto_charge_workflow"
    );
    expect(warnings).toEqual([`Conta Azul state not found: ${config.contaAzulStatePath}`]);
  });
});
