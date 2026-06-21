import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { runAgentTurn } from "../../src/agent/agent-runner.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "../../src/agent/model-provider.js";
import { loadAgentSession } from "../../src/agent/agent-session-store.js";
import { createToolRegistry } from "../../src/core/tool-registry.js";
import type { ToolReceipt } from "../../src/core/tool-types.js";

describe("agent runner", () => {
  it("executes a complete model plan through a registered workflow tool in dry-run", async () => {
    const registry = createToolRegistry();
    const calls: unknown[] = [];
    registry.register({
      name: "asaas.create_boleto_charge_workflow",
      description: "Resolve customer and plan boleto creation.",
      parameters: z.object({
        customerName: z.string(),
        valueBr: z.string(),
        dueDateBr: z.string(),
        description: z.string()
      }),
      execute: async (params) => {
        calls.push(params);
        return receipt("asaas.create_boleto_charge_workflow");
      }
    });

    const result = await runAgentTurn({
      request: "criar boleto no Asaas para Cliente Exemplo",
      registry,
      provider: createFakeModelProvider({
        intent: "create_boleto_charge_workflow",
        toolName: "asaas.create_boleto_charge_workflow",
        params: {
          customerName: "Cliente Exemplo",
          valueBr: "120,00",
          dueDateBr: "30/06/2026",
          description: "Honorarios"
        },
        missingFields: [],
        questions: [],
        risk: "low",
        confidence: 0.9,
        reason: "Dados completos."
      }),
      runtimeMode: "dry-run"
    });

    expect(result).toMatchObject({
      status: "executed",
      receipt: {
        status: "planned",
        dryRun: true,
        toolName: "asaas.create_boleto_charge_workflow"
      }
    });
    expect(calls).toEqual([
      {
        customerName: "Cliente Exemplo",
        valueBr: "120,00",
        dueDateBr: "30/06/2026",
        description: "Honorarios"
      }
    ]);
  });

  it("blocks agent live mode before asking the model", async () => {
    const provider = createFakeModelProvider({});

    const result = await runAgentTurn({
      request: "criar boleto",
      registry: createToolRegistry(),
      provider,
      runtimeMode: "live"
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("dry-run")
    });
    expect(provider.calls).toHaveLength(0);
  });

  it("blocks low-level tools even when they are registered in the full harness registry", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "asaas.create_boleto_charge",
      description: "Low-level mutation.",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("should not execute");
      }
    });

    const result = await runAgentTurn({
      request: "criar boleto",
      registry,
      provider: createFakeModelProvider({
        intent: "bad",
        toolName: "asaas.create_boleto_charge",
        params: {},
        missingFields: [],
        questions: [],
        risk: "high",
        confidence: 1,
        reason: "Tentativa baixa."
      }),
      runtimeMode: "dry-run"
    });

    expect(result).toMatchObject({
      status: "blocked",
      toolName: "asaas.create_boleto_charge"
    });
  });

  it("requires operator confirmation before executing high-risk or low-confidence plans", async () => {
    const registry = createToolRegistry();
    let executed = false;
    registry.register({
      name: "asaas.create_boleto_charge_workflow",
      description: "Resolve customer and plan boleto creation.",
      parameters: z.object({ customerName: z.string() }).passthrough(),
      execute: async () => {
        executed = true;
        return receipt("asaas.create_boleto_charge_workflow");
      }
    });

    const result = await runAgentTurn({
      request: "criar boleto no Asaas",
      registry,
      provider: createFakeModelProvider({
        intent: "create_boleto_charge_workflow",
        toolName: "asaas.create_boleto_charge_workflow",
        params: { customerName: "Cliente Exemplo" },
        missingFields: [],
        questions: [],
        risk: "high",
        confidence: 0.6,
        reason: "Plano incerto."
      }),
      runtimeMode: "dry-run"
    });

    expect(result).toMatchObject({
      status: "needs_input",
      missingFields: ["operatorConfirmation"],
      questions: [expect.stringContaining("confirmar")]
    });
    expect(executed).toBe(false);
  });

  it("persists collected slots and reuses them on the next session turn", async () => {
    const sessionsDir = await mkdtemp(path.join(os.tmpdir(), "harness-agent-runner-"));
    const registry = createToolRegistry();
    const calls: unknown[] = [];
    registry.register({
      name: "asaas.create_boleto_charge_workflow",
      description: "Resolve customer and plan boleto creation.",
      parameters: z.object({
        customerName: z.string(),
        valueBr: z.string(),
        dueDateBr: z.string(),
        description: z.string()
      }),
      execute: async (params) => {
        calls.push(params);
        return receipt("asaas.create_boleto_charge_workflow");
      }
    });

    await runAgentTurn({
      request: "criar boleto no Asaas para Cliente Exemplo",
      registry,
      provider: createFakeModelProvider({
        intent: "create_boleto_charge_workflow",
        toolName: "asaas.create_boleto_charge_workflow",
        params: { customerName: "Cliente Exemplo" },
        missingFields: ["valueBr", "dueDateBr", "description"],
        questions: ["Valor?", "Vencimento?", "Descricao?"],
        risk: "low",
        confidence: 0.8,
        reason: "Faltam campos."
      }),
      runtimeMode: "dry-run",
      sessionId: "sess_boleto",
      sessionsDir
    });

    const result = await runAgentTurn({
      request: "valor 120,00 vencimento 30/06/2026 honorarios",
      registry,
      provider: createFakeModelProvider({
        intent: "create_boleto_charge_workflow",
        toolName: "asaas.create_boleto_charge_workflow",
        params: {
          valueBr: "120,00",
          dueDateBr: "30/06/2026",
          description: "Honorarios"
        },
        missingFields: [],
        questions: [],
        risk: "low",
        confidence: 0.9,
        reason: "Campos restantes recebidos."
      }),
      runtimeMode: "dry-run",
      sessionId: "sess_boleto",
      sessionsDir
    });

    expect(result.status).toBe("executed");
    expect(calls[0]).toEqual({
      customerName: "Cliente Exemplo",
      valueBr: "120,00",
      dueDateBr: "30/06/2026",
      description: "Honorarios"
    });

    const session = await loadAgentSession({ sessionsDir, sessionId: "sess_boleto" });
    expect(session.slots).toMatchObject({
      customerName: "Cliente Exemplo",
      valueBr: "120,00",
      dueDateBr: "30/06/2026",
      description: "Honorarios"
    });
  });

  it("plans the Conta Azul service-sale workflow conversationally when all slots are available", async () => {
    const registry = createToolRegistry();
    const calls: unknown[] = [];
    registry.register({
      name: "contaazul.create_service_sale_boleto_workflow",
      description: "Conta Azul service sale boleto workflow.",
      parameters: z.object({
        tenantId: z.number(),
        customerName: z.string(),
        categoryName: z.string(),
        itemName: z.string(),
        serviceDescription: z.string(),
        unitValueBr: z.string(),
        dueDateBr: z.string(),
        notification: z.object({
          phone: z.string(),
          email: z.string(),
          replyTo: z.string()
        }).passthrough()
      }).passthrough(),
      execute: async (params) => {
        calls.push(params);
        return receipt("contaazul.create_service_sale_boleto_workflow");
      }
    });

    const result = await runAgentTurn({
      request: "criar venda de servico e boleto no Conta Azul",
      registry,
      provider: createFakeModelProvider({
        intent: "create_service_sale_boleto_workflow",
        toolName: "contaazul.create_service_sale_boleto_workflow",
        params: {
          tenantId: 3047702,
          customerName: "AZUOS ASSESSORIA CONTABIL LTDA",
          categoryName: "Honorario contabil mensal",
          itemName: "Honorario Contabil",
          serviceDescription: "Honorario mensal",
          unitValueBr: "10,00",
          dueDateBr: "30/06/2026",
          notification: {
            phone: "62991514384",
            email: "kamilly.agregarnegocios@gmail.com",
            replyTo: "sccontabilidadefinanceiro@gmail.com"
          }
        },
        missingFields: [],
        questions: [],
        risk: "medium",
        confidence: 0.9,
        reason: "Dados completos para planejamento."
      }),
      runtimeMode: "dry-run"
    });

    expect(result).toMatchObject({
      status: "executed",
      receipt: {
        toolName: "contaazul.create_service_sale_boleto_workflow",
        status: "planned"
      }
    });
    expect(calls).toHaveLength(1);
  });
});

function createFakeModelProvider(plan: unknown): ModelProvider & { calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  return {
    name: "gemini",
    model: "fake-model",
    calls,
    async generateText(input: ModelRequest): Promise<ModelResponse> {
      calls.push(input);
      return { provider: "gemini", model: "fake-model", text: JSON.stringify(plan) };
    }
  };
}

function receipt(toolName: string): ToolReceipt {
  return {
    operationId: "op_agent_test",
    provider: toolName.startsWith("asaas.") ? "asaas" : "contaazul",
    toolName,
    status: "planned",
    dryRun: true,
    summary: "planned by test",
    artifacts: [],
    warnings: []
  };
}
