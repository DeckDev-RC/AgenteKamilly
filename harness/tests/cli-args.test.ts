import { describe, expect, it } from "vitest";

import { parseCliArgs } from "../src/cli-args.js";

describe("CLI args", () => {
  it("parses agent mode without changing the default dry-run runtime", () => {
    const args = parseCliArgs([
      "--agent",
      "--operator",
      "criar",
      "boleto",
      "no",
      "Conta",
      "Azul"
    ]);

    expect(args).toEqual({
      request: "criar boleto no Conta Azul",
      runtimeModeOverride: "dry-run",
      outputMode: "operator",
      agentMode: true,
      modelSmoke: false,
      verbose: false
    });
  });

  it("parses model smoke checks as a separate command", () => {
    const args = parseCliArgs(["--model-smoke", "--json"]);

    expect(args).toMatchObject({
      request: "",
      modelSmoke: true,
      outputMode: "json"
    });
  });

  it("parses agent session ids", () => {
    const args = parseCliArgs(["--agent", "--session", "sess_001", "continuar"]);

    expect(args).toMatchObject({
      agentMode: true,
      agentSessionId: "sess_001",
      request: "continuar"
    });
  });
});
