import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createSafeWorkflowRegistry } from "../../src/agent/safe-workflow-registry.js";
import { createToolRegistry } from "../../src/core/tool-registry.js";

describe("safe workflow registry", () => {
  it("exposes only workflow-level tools to the agent", () => {
    const registry = createToolRegistry();
    registry.register({
      name: "asaas.create_boleto_charge_workflow",
      description: "Safe Asaas workflow.",
      parameters: z.object({}),
      execute: async () => ({})
    });
    registry.register({
      name: "asaas.create_boleto_charge",
      description: "Low-level mutation.",
      parameters: z.object({}),
      execute: async () => ({})
    });
    registry.register({
      name: "contaazul.create_service_sale_boleto_workflow",
      description: "Safe Conta Azul workflow.",
      parameters: z.object({}),
      execute: async () => ({})
    });
    registry.register({
      name: "contaazul.create_customer_workflow",
      description: "Safe Conta Azul customer workflow.",
      parameters: z.object({}),
      execute: async () => ({})
    });

    const safe = createSafeWorkflowRegistry(registry);

    expect(safe.list().map((tool) => tool.name)).toEqual([
      "asaas.create_boleto_charge_workflow",
      "contaazul.create_service_sale_boleto_workflow",
      "contaazul.create_customer_workflow"
    ]);
  });
});
