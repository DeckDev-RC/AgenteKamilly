import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { planOrchestratorTurn, registerHarnessTools } from "../../src/agent/orchestrator.js";
import { createToolRegistry } from "../../src/core/tool-registry.js";
import type { AsaasMutationClient } from "../../src/modules/asaas/client.js";
import { createAsaasMutationTools } from "../../src/modules/asaas/tools.js";
import type {
  CancelChargeRequestsParams,
  ContaAzulMutationClient,
  CreateChargeRequestParams,
  CreateCustomerParams,
  CreateServiceSaleParams,
  DownloadBoletoPdfParams,
  GetFinancialEventSummaryParams,
  GetFinancialEventsByReferenceParams,
  SearchFinancialStatementParams,
  SendChargeNotificationParams,
  UpdateInstallmentDueDateParams
} from "../../src/modules/contaazul/client.js";
import { createContaAzulMutationTools } from "../../src/modules/contaazul/tools.js";

describe("dry-run e2e orchestration", () => {
  it("routes an Asaas due-date request to a planned receipt without live calls", async () => {
    const dir = await tempDir();
    const client = createFakeAsaasMutationClient();
    const registry = createToolRegistry();

    registerHarnessTools(registry, {
      asaasMutation: createAsaasMutationTools({
        client,
        ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
        artifactsDir: path.join(dir, "artifacts"),
        runtimeMode: "dry-run",
        allowLiveMutations: false,
        operationIdFactory: () => "op_asaas_due_date"
      })
    });

    const result = await planOrchestratorTurn({
      request: "alterar vencimento no Asaas",
      registry,
      params: { chargeId: "501", dueDateBr: "20/07/2026" }
    });

    expect(result).toMatchObject({
      status: "executed",
      toolName: "asaas.update_charge_due_date",
      receipt: { status: "planned", dryRun: true }
    });
    expect(client.calls).toEqual([]);
  });

  it("routes a Conta Azul service-sale request to a planned receipt without live calls", async () => {
    const dir = await tempDir();
    const client = createFakeContaAzulMutationClient();
    const registry = createToolRegistry();

    registerHarnessTools(registry, {
      contaAzulMutation: createContaAzulMutationTools({
        client,
        ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
        artifactsDir: path.join(dir, "artifacts"),
        runtimeMode: "dry-run",
        allowLiveMutations: false,
        config: {
          financialAccountId: "account_test",
          defaultReplyToEmail: "reply@example.test",
          defaultCompanyDisplayName: "Empresa Teste"
        },
        proSessionStore: new Map([["rel_001", "pro-token-test"]]),
        operationIdFactory: () => "op_contaazul_sale"
      })
    });

    const result = await planOrchestratorTurn({
      request: "criar venda de servico e emitir boleto no Conta Azul",
      registry,
      params: {
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
        notification: { email: "cliente@example.test", phone: "11999999999" }
      }
    });

    expect(result).toMatchObject({
      status: "executed",
      toolName: "contaazul.create_service_sale_and_issue_boleto",
      receipt: { status: "planned", dryRun: true }
    });
    expect(client.calls).toEqual([]);
  });

  it("routes a Conta Azul natural service-sale request through the workflow resolver", async () => {
    const dir = await tempDir();
    const client = createFakeContaAzulMutationClient();
    const registry = createToolRegistry();

    registerHarnessTools(registry, {
      contaAzulMutation: createContaAzulMutationTools({
        client,
        ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
        artifactsDir: path.join(dir, "artifacts"),
        runtimeMode: "dry-run",
        allowLiveMutations: false,
        config: {
          financialAccountId: "account_test",
          defaultReplyToEmail: "reply@example.test",
          defaultCompanyDisplayName: "Empresa Teste"
        },
        proSessionStore: new Map(),
        operationIdFactory: () => "op_contaazul_workflow"
      })
    });

    const result = await planOrchestratorTurn({
      request: "criar venda de servico e emitir boleto no Conta Azul",
      registry,
      params: {
        tenantId: 101,
        customerName: "Cliente Exemplo",
        categoryName: "Honorarios mensais",
        itemName: "Honorarios Contabeis",
        serviceDescription: "Honorarios mensais",
        unitValue: 250.75,
        dueDateIso: "2026-07-20",
        notification: { email: "cliente@example.test", phone: "11999999999" }
      }
    });

    expect(result).toMatchObject({
      status: "executed",
      toolName: "contaazul.create_service_sale_boleto_workflow",
      receipt: { status: "planned", dryRun: true }
    });
    expect(client.calls.map((call) => call.name)).toEqual([
      "searchSaleCustomers",
      "searchFinancialCategories",
      "searchServiceItems",
      "listOperationNatures",
      "getNextSaleNumber"
    ]);
  });

  it("blocks accidental provider fetches during tests", async () => {
    await expect(fetch("https://www.asaas.com/customerAccount/loadTableContent")).rejects.toThrow(
      "Live provider network blocked in tests"
    );
  });
});

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "harness-e2e-dry-run-"));
}

function createFakeAsaasMutationClient(): AsaasMutationClient & { calls: string[] } {
  return {
    calls: [],
    async listCustomersPage() {
      return "";
    },
    async listChargesPage() {
      return "";
    },
    async getChargeDetailHtml() {
      return "";
    },
    async updateChargeDueDate() {
      this.calls.push("updateChargeDueDate");
      return { ok: true, status: 200 };
    },
    async createBoletoCharge() {
      this.calls.push("createBoletoCharge");
      return { raw: {} };
    },
    async downloadBoletoPdf() {
      this.calls.push("downloadBoletoPdf");
      return Buffer.from("%PDF-test");
    }
  };
}

function createFakeContaAzulMutationClient(): ContaAzulMutationClient & {
  calls: Array<{ name: string; payload: unknown }>;
} {
  const client = {
    calls: [] as Array<{ name: string; payload: unknown }>,
    async listAccountancyClients() {
      return {
        items: [
          {
            relationId: "rel_001",
            tenantId: 101,
            name: "Empresa Teste",
            active: true
          }
        ]
      };
    },
    async switchToProSession(relationId: string) {
      return { relationId, authToken: "pro-token-test" };
    },
    async searchSaleCustomers(params: unknown) {
      client.calls.push({ name: "searchSaleCustomers", payload: params });
      return [{ id: "person_uuid", name: "Cliente Exemplo" }];
    },
    async searchFinancialCategories(params: unknown) {
      client.calls.push({ name: "searchFinancialCategories", payload: params });
      return [{ uuid: "cat_uuid", dsNaturezaFinanceira: "Honorarios mensais" }];
    },
    async searchServiceItems(params: unknown) {
      client.calls.push({ name: "searchServiceItems", payload: params });
      return [{ id: "item_uuid", name: "Honorarios Contabeis" }];
    },
    async listOperationNatures(params: unknown) {
      client.calls.push({ name: "listOperationNatures", payload: params });
      return [{ uuid: "nature_uuid", operationTemplate: "PRESTACAO_SERVICO" }];
    },
    async getNextSaleNumber(params: unknown) {
      client.calls.push({ name: "getNextSaleNumber", payload: params });
      return 123;
    },
    async searchFinancialStatement(_params: SearchFinancialStatementParams) {
      return [];
    },
    async cancelChargeRequests(params: CancelChargeRequestsParams) {
      client.calls.push({ name: "cancelChargeRequests", payload: params });
      return { ok: true, status: 204 };
    },
    async updateInstallmentDueDate(params: UpdateInstallmentDueDateParams) {
      client.calls.push({ name: "updateInstallmentDueDate", payload: params });
      return {};
    },
    async createChargeRequest(params: CreateChargeRequestParams) {
      client.calls.push({ name: "createChargeRequest", payload: params });
      return {};
    },
    async createCustomer(params: CreateCustomerParams) {
      client.calls.push({ name: "createCustomer", payload: params });
      return {};
    },
    async createServiceSale(params: CreateServiceSaleParams) {
      client.calls.push({ name: "createServiceSale", payload: params });
      return {};
    },
    async sendChargeNotification(params: SendChargeNotificationParams) {
      client.calls.push({ name: "sendChargeNotification", payload: params });
      return {};
    },
    async getFinancialEventsByReference(params: GetFinancialEventsByReferenceParams) {
      client.calls.push({ name: "getFinancialEventsByReference", payload: params });
      return [];
    },
    async getFinancialEventSummary(params: GetFinancialEventSummaryParams) {
      client.calls.push({ name: "getFinancialEventSummary", payload: params });
      return {};
    },
    async downloadBoletoPdf(params: DownloadBoletoPdfParams) {
      client.calls.push({ name: "downloadBoletoPdf", payload: params });
      return Buffer.from("%PDF-test");
    }
  };

  return client;
}
