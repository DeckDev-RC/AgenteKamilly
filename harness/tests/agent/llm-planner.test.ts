import { describe, expect, it } from "vitest";
import { z } from "zod";

import { planAgentTurn } from "../../src/agent/llm-planner.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "../../src/agent/model-provider.js";
import { createToolRegistry } from "../../src/core/tool-registry.js";

describe("LLM agent planner", () => {
  it("turns a valid model plan into a dry-run agent plan without executing tools", async () => {
    const registry = createToolRegistry();
    let executed = false;
    registry.register({
      name: "contaazul.create_service_sale_boleto_workflow",
      description: "Plan Conta Azul service sale and boleto workflow.",
      parameters: z.object({
        customerName: z.string()
      }).passthrough(),
      execute: async () => {
        executed = true;
        return {};
      }
    });

    const provider = createFakeModelProvider({
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
          email: "cliente@example.test"
        }
      },
      missingFields: [],
      questions: [],
      risk: "medium",
      confidence: 0.88,
      reason: "Pedido corresponde ao workflow de venda de servico com boleto."
    });

    const result = await planAgentTurn({
      request: "crie uma venda de servico com boleto no Conta Azul para AZUOS",
      registry,
      provider
    });

    expect(result).toMatchObject({
      status: "planned",
      provider: "gemini",
      model: "fake-model",
      plan: {
        toolName: "contaazul.create_service_sale_boleto_workflow",
        params: {
          customerName: "AZUOS ASSESSORIA CONTABIL LTDA",
          tenantId: 3047702
        },
        missingFields: [],
        risk: "medium"
      }
    });
    expect(executed).toBe(false);
    expect(provider.calls[0]?.responseSchema).toMatchObject({
      type: "object",
      properties: {
        toolName: { type: "string" },
        params: {
          type: "object",
          properties: {
            customerName: { type: "string" },
            valueBr: { type: "string" },
            dueDateBr: { type: "string" }
          }
        }
      },
      required: expect.arrayContaining(["intent", "toolName", "params"])
    });
  });

  it("asks only for missing fields reported by a valid model plan", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "asaas.create_boleto_charge_workflow",
      description: "Resolve an Asaas customer and plan boleto creation.",
      parameters: z.object({ customerName: z.string() }).passthrough(),
      execute: async () => ({})
    });

    const provider = createFakeModelProvider({
      intent: "create_boleto_charge_workflow",
      toolName: "asaas.create_boleto_charge_workflow",
      params: { customerName: "Cliente Exemplo", description: "Honorarios" },
      missingFields: ["valueBr", "dueDateBr"],
      questions: ["Qual valor do boleto?", "Qual vencimento?"],
      risk: "low",
      confidence: 0.76,
      reason: "Faltam valor e vencimento."
    });

    const result = await planAgentTurn({
      request: "gerar boleto no Asaas para Cliente Exemplo",
      registry,
      provider
    });

    expect(result).toMatchObject({
      status: "needs_input",
      toolName: "asaas.create_boleto_charge_workflow",
      missingFields: ["valueBr", "dueDateBr"],
      questions: ["Qual valor do boleto?", "Qual vencimento?"]
    });
  });

  it("sends only known field names to the model, not previously collected values", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "contaazul.create_service_sale_boleto_workflow",
      description: "Resolve Conta Azul workflow.",
      parameters: z.object({}).passthrough(),
      execute: async () => ({})
    });

    const provider = createFakeModelProvider({
      intent: "create_service_sale_boleto_workflow",
      toolName: "contaazul.create_service_sale_boleto_workflow",
      params: { dueDateBr: "30/06/2026" },
      missingFields: [],
      questions: [],
      risk: "medium",
      confidence: 0.9,
      reason: "Campos restantes recebidos."
    });

    await planAgentTurn({
      request: "usar vencimento 30/06/2026",
      registry,
      provider,
      knownParams: {
        customerName: "AZUOS ASSESSORIA CONTABIL LTDA",
        notification: {
          email: "cliente@example.test",
          phone: "62991514384",
          replyTo: "financeiro@example.test"
        }
      }
    });

    const prompt = provider.calls[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain("knownFields");
    expect(prompt).toContain("customerName");
    expect(prompt).toContain("notification.email");
    expect(prompt).toContain("notification.phone");
    expect(prompt).not.toContain("AZUOS ASSESSORIA");
    expect(prompt).not.toContain("cliente@example.test");
    expect(prompt).not.toContain("62991514384");
    expect(prompt).not.toContain("financeiro@example.test");
  });

  it("does not reuse redacted placeholders as workflow params", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "contaazul.create_service_sale_boleto_workflow",
      description: "Resolve Conta Azul workflow.",
      parameters: z.object({
        notification: z.object({
          phone: z.string()
        })
      }),
      execute: async () => ({})
    });

    const result = await planAgentTurn({
      request: "continuar",
      registry,
      provider: createFakeModelProvider({
        intent: "create_service_sale_boleto_workflow",
        toolName: "contaazul.create_service_sale_boleto_workflow",
        params: {
          tenantId: 3047702,
          customerName: "Cliente Exemplo",
          categoryName: "Honorario contabil mensal",
          itemName: "Honorario Contabil",
          serviceDescription: "Honorario mensal",
          unitValueBr: "10,00",
          dueDateBr: "30/06/2026",
          notification: {
            email: "cliente@example.test"
          }
        },
        missingFields: [],
        questions: [],
        risk: "medium",
        confidence: 0.9,
        reason: "Continuar com campos locais."
      }),
      knownParams: {
        notification: {
          phone: "[REDACTED_PHONE]"
        }
      }
    });

    expect(result).toMatchObject({
      status: "needs_input",
      toolName: "contaazul.create_service_sale_boleto_workflow",
      missingFields: ["notification.phone"]
    });
    expect(JSON.stringify((result as { params?: unknown }).params ?? {})).not.toContain("[REDACTED");
  });

  it("normalizes common missing-field aliases to registered tool field names", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "asaas.create_boleto_charge_workflow",
      description: "Resolve an Asaas customer and plan boleto creation.",
      parameters: z.object({ customerName: z.string() }).passthrough(),
      execute: async () => ({})
    });

    const result = await planAgentTurn({
      request: "gerar boleto no Asaas para Cliente Exemplo",
      registry,
      provider: createFakeModelProvider({
        intent: "create_boleto_charge_workflow",
        toolName: "asaas.create_boleto_charge_workflow",
        params: { customerName: "Cliente Exemplo" },
        missingFields: ["value", "dueDate", "description"],
        questions: ["Qual valor?", "Qual vencimento?", "Qual descricao?"],
        risk: "low",
        confidence: 0.8,
        reason: "Faltam dados financeiros."
      })
    });

    expect(result).toMatchObject({
      status: "needs_input",
      missingFields: ["valueBr", "dueDateBr", "description"]
    });
  });

  it("deduplicates Conta Azul value aliases in missing fields", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "contaazul.create_service_sale_boleto_workflow",
      description: "Resolve a Conta Azul service sale and boleto workflow.",
      parameters: z.object({ customerName: z.string() }).passthrough(),
      execute: async () => ({})
    });

    const result = await planAgentTurn({
      request: "criar venda de servico no Conta Azul",
      registry,
      provider: createFakeModelProvider({
        intent: "create_service_sale_boleto_workflow",
        toolName: "contaazul.create_service_sale_boleto_workflow",
        params: {
          tenantId: 3047702,
          customerName: "Cliente Exemplo",
          categoryName: "Honorario contabil mensal",
          itemName: "Honorario Contabil",
          serviceDescription: "Honorario mensal",
          notification: {
            email: "cliente@example.test"
          }
        },
        missingFields: ["valueBr", "unitValueBr", "dueDate"],
        questions: ["Qual o valor total?", "Qual o valor unitario?", "Qual vencimento?"],
        risk: "low",
        confidence: 0.8,
        reason: "Faltam dados financeiros."
      })
    });

    expect(result).toMatchObject({
      status: "needs_input",
      missingFields: ["unitValueBr", "dueDateBr"]
    });
  });

  it("adds known Conta Azul workflow required fields missing from the model plan", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "contaazul.create_service_sale_boleto_workflow",
      description: "Resolve a Conta Azul service sale and boleto workflow.",
      parameters: z.object({ customerName: z.string() }).passthrough(),
      execute: async () => ({})
    });

    const result = await planAgentTurn({
      request: "criar venda de servico no Conta Azul",
      registry,
      provider: createFakeModelProvider({
        intent: "create_service_sale_boleto_workflow",
        toolName: "contaazul.create_service_sale_boleto_workflow",
        params: {
          customerName: "Cliente Exemplo",
          itemName: "Honorario Contabil",
          unitValueBr: "10,00",
          dueDateBr: "30/06/2026"
        },
        missingFields: ["categoryName", "serviceDescription"],
        questions: ["Qual categoria?", "Qual descricao?"],
        risk: "low",
        confidence: 0.8,
        reason: "Faltam alguns dados."
      })
    });

    expect(result).toMatchObject({
      status: "needs_input",
      missingFields: [
        "categoryName",
        "serviceDescription",
        "tenantId",
        "notification.email"
      ]
    });
  });

  it("blocks invalid model JSON before any tool can be selected", async () => {
    const result = await planAgentTurn({
      request: "criar boleto",
      registry: createToolRegistry(),
      provider: createFakeTextProvider("isso nao e json")
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("valid JSON")
    });
  });

  it("blocks provider errors without throwing a CLI stack trace", async () => {
    const provider = createFakeThrowingProvider(new Error("Gemini API request failed: 400"));

    const result = await planAgentTurn({
      request: "criar boleto",
      registry: createToolRegistry(),
      provider
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("Model provider failed")
    });
  });

  it("normalizes Portuguese risk labels from model output", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "asaas.create_boleto_charge_workflow",
      description: "Resolve an Asaas customer and plan boleto creation.",
      parameters: z.object({ customerName: z.string() }).passthrough(),
      execute: async () => ({})
    });

    const result = await planAgentTurn({
      request: "gerar boleto no Asaas para Cliente Exemplo",
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
        risk: "medio",
        confidence: 0.8,
        reason: "Risco medio por envolver cobranca."
      })
    });

    expect(result).toMatchObject({
      status: "planned",
      plan: { risk: "medium" }
    });
  });

  it("guides the operator with available capabilities when the model picks an unregistered tool", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "asaas.create_boleto_charge_workflow",
      description: "Resolve an Asaas customer and plan boleto creation.",
      parameters: z.object({}).passthrough(),
      execute: async () => ({})
    });
    registry.register({
      name: "contaazul.create_customer_workflow",
      description: "Cadastrar cliente no Conta Azul.",
      parameters: z.object({}).passthrough(),
      execute: async () => ({})
    });

    const result = await planAgentTurn({
      request: "cancelar a cobranca",
      registry,
      provider: createFakeModelProvider({
        intent: "cancel",
        toolName: "contaazul.cancel_charge_workflow",
        params: {},
        missingFields: [],
        questions: [],
        risk: "high",
        confidence: 0.9,
        reason: "Tentativa de ferramenta nao registrada."
      })
    });

    expect(result.status).toBe("blocked");
    expect(result).toMatchObject({ toolName: "contaazul.cancel_charge_workflow" });
    const reason = (result as { reason: string }).reason;
    expect(reason).not.toContain("not registered");
    expect(reason).toContain("criar boleto no Asaas");
    expect(reason).toContain("cadastrar cliente no Conta Azul");
  });

  it("blocks requests for official provider integrations before asking the model", async () => {
    const provider = createFakeTextProvider("{}");

    const result = await planAgentTurn({
      request: "use webhook oficial do Conta Azul",
      registry: createToolRegistry(),
      provider
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("official provider")
    });
    expect(provider.calls).toHaveLength(0);
  });
});

function createFakeModelProvider(plan: unknown): ModelProvider & { calls: ModelRequest[] } {
  return createFakeTextProvider(JSON.stringify(plan));
}

function createFakeTextProvider(text: string): ModelProvider & { calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  return {
    name: "gemini",
    model: "fake-model",
    calls,
    async generateText(input: ModelRequest): Promise<ModelResponse> {
      calls.push(input);
      return { provider: "gemini", model: "fake-model", text };
    }
  };
}

function createFakeThrowingProvider(error: Error): ModelProvider & { calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  return {
    name: "gemini",
    model: "fake-model",
    calls,
    async generateText(input: ModelRequest): Promise<ModelResponse> {
      calls.push(input);
      throw error;
    }
  };
}
