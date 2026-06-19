import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createToolRegistry } from "../../src/core/tool-registry.js";

describe("tool registry", () => {
  it("rejects provider-official integration names", () => {
    const registry = createToolRegistry();
    const parameters = z.object({});
    const execute = async () => ({ ok: true });

    expect(() =>
      registry.register({ name: "asaas_mcp", description: "blocked", parameters, execute })
    ).toThrow("official provider");
    expect(() =>
      registry.register({ name: "contaazul.oauth_login", description: "blocked", parameters, execute })
    ).toThrow("official provider");
    expect(() =>
      registry.register({ name: "asaas.webhook_create", description: "blocked", parameters, execute })
    ).toThrow("official provider");
    expect(() =>
      registry.register({ name: "official.asaas", description: "blocked", parameters, execute })
    ).toThrow("official provider");
  });

  it("registers mapped-session tool names", () => {
    const registry = createToolRegistry();

    registry.register({
      name: "asaas.search_customers",
      description: "Search customers through mapped session HTTP",
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ query })
    });

    expect(registry.list().map((tool) => tool.name)).toEqual(["asaas.search_customers"]);
  });
});
