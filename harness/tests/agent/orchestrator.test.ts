import { describe, expect, it } from "vitest";

import { createToolRegistry } from "../../src/core/tool-registry.js";
import type { ToolReceipt } from "../../src/core/tool-types.js";
import {
  planOrchestratorTurn,
  registerHarnessTools
} from "../../src/agent/orchestrator.js";

describe("agent orchestrator", () => {
  it("blocks requests that ask for official provider integrations", async () => {
    const result = await planOrchestratorTurn({
      request: "Use o webhook oficial do Asaas para receber eventos",
      registry: createToolRegistry()
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("official provider")
    });
  });

  it("asks for missing fields before routing Asaas due-date updates", async () => {
    const result = await planOrchestratorTurn({
      request: "alterar vencimento de cobranca no Asaas",
      registry: createToolRegistry()
    });

    expect(result).toMatchObject({
      status: "needs_input",
      provider: "asaas",
      toolName: "asaas.update_charge_due_date",
      missingFields: ["chargeId", "dueDateBr"]
    });
  });

  it("registers mapped-session tools and executes a routed tool with structured params", async () => {
    const registry = createToolRegistry();
    const calls: unknown[] = [];

    registerHarnessTools(registry, {
      asaasMutation: {
        updateChargeDueDate: async (params) => {
          calls.push(params);
          return receipt("asaas.update_charge_due_date", {
            plannedRequest: { method: "POST", url: "https://www.asaas.com/payment/update" }
          });
        }
      }
    });

    expect(registry.list().map((tool) => tool.name)).toEqual([
      "asaas.update_charge_due_date"
    ]);

    const result = await planOrchestratorTurn({
      request: "alterar vencimento no Asaas",
      registry,
      params: { chargeId: "501", dueDateBr: "20/07/2026" }
    });

    expect(result).toMatchObject({
      status: "executed",
      provider: "asaas",
      toolName: "asaas.update_charge_due_date"
    });
    expect(calls).toEqual([{ chargeId: "501", dueDateBr: "20/07/2026" }]);
  });

  it("maps Conta Azul service-sale requests to workflow fields when only natural input is available", async () => {
    const result = await planOrchestratorTurn({
      request: "criar venda de servico e emitir boleto no Conta Azul",
      registry: createToolRegistry(),
      params: { relationId: "rel_001" }
    });

    expect(result).toMatchObject({
      status: "needs_input",
      provider: "contaazul",
      toolName: "contaazul.create_service_sale_boleto_workflow"
    });
    expect(result.status === "needs_input" ? result.missingFields : []).toEqual([
      "tenantId",
      "customerName",
      "categoryName",
      "itemName",
      "serviceDescription",
      "unitValueOrBr",
      "dueDateIsoOrBr",
      "notification"
    ]);
  });

  it("keeps exact Conta Azul service-sale params on the low-level tool route", async () => {
    const registry = createToolRegistry();
    const calls: unknown[] = [];

    registerHarnessTools(registry, {
      contaAzulMutation: {
        createServiceSaleAndIssueBoleto: async (params) => {
          calls.push(params);
          return receipt("contaazul.create_service_sale_and_issue_boleto", {
            approvalPreview: {
              operationId: "op_test",
              provider: "contaazul",
              toolName: "contaazul.create_service_sale_and_issue_boleto",
              action: "create",
              target: { customerId: "person_uuid", customerName: "Cliente Exemplo" },
              changes: [],
              irreversible: false,
              rollbackNote: "test"
            },
            plannedRequests: []
          });
        }
      }
    });

    const params = {
      relationId: "rel_001",
      customerId: "person_uuid",
      customerName: "Cliente Exemplo",
      categoryId: "cat_uuid",
      serviceItemId: "item_uuid",
      serviceDescription: "Honorarios mensais",
      unitValue: 250.75,
      dueDateIso: "2026-07-20",
      saleDateIso: "2026-06-19",
      saleNumber: 123,
      operationNatureId: "nature_uuid",
      notification: { email: "cliente@example.test" }
    };

    const result = await planOrchestratorTurn({
      request: "criar venda de servico e emitir boleto no Conta Azul",
      registry,
      params
    });

    expect(result).toMatchObject({
      status: "executed",
      toolName: "contaazul.create_service_sale_and_issue_boleto"
    });
    expect(calls).toEqual([params]);
  });
});

function receipt<T>(toolName: string, data: T): ToolReceipt<T> {
  return {
    operationId: "op_test",
    provider: toolName.startsWith("asaas.") ? "asaas" : "contaazul",
    toolName,
    status: "planned",
    dryRun: true,
    summary: "planned",
    data,
    artifacts: [],
    warnings: []
  };
}
