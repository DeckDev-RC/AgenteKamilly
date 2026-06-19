import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { readLedgerEntries } from "../../../src/core/ledger.js";
import type {
  AsaasMutationClient,
  CreateBoletoChargeInput
} from "../../../src/modules/asaas/client.js";
import { createAsaasMutationTools, createAsaasReadTools } from "../../../src/modules/asaas/tools.js";

const fixturesDir = path.join(process.cwd(), "tests", "fixtures", "asaas");

describe("Asaas read tools", () => {
  it("searches customers, filters by query, and writes a ledger receipt", async () => {
    const ledgerPath = await tempLedgerPath();
    const customerFixture = JSON.parse(
      readFileSync(path.join(fixturesDir, "customer-table.json"), "utf-8")
    ) as { content: string };
    const client = createFakeClient({
      customerPages: [customerFixture.content, ""]
    });

    const tools = createAsaasReadTools({
      client,
      ledgerPath,
      operationIdFactory: () => "op_search_customers"
    });

    const receipt = await tools.searchCustomers({ query: "exemplo" });

    expect(receipt).toMatchObject({
      operationId: "op_search_customers",
      provider: "asaas",
      toolName: "asaas.search_customers",
      status: "succeeded",
      dryRun: true,
      data: [
        {
          id: "101",
          name: "Cliente Exemplo Ltda",
          email: "financeiro@example.test"
        }
      ]
    });
    expect(client.customerPageRequests).toEqual([{ offset: 0, max: 50 }]);

    const entries = await readLedgerEntries(ledgerPath);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      operationId: "op_search_customers",
      provider: "asaas",
      toolName: "asaas.search_customers",
      status: "succeeded"
    });
  });

  it("uses a fresh customer cache without calling the mapped endpoint", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-asaas-cache-"));
    const ledgerPath = path.join(dir, "ledger", "operations.jsonl");
    const customerCachePath = path.join(dir, "cache", "customers.json");
    await mkdir(path.dirname(customerCachePath), { recursive: true });
    await writeFile(
      customerCachePath,
      JSON.stringify({
        cachedAt: new Date().toISOString(),
        customers: [{ id: "cached_101", name: "Cliente Cache" }]
      }),
      "utf-8"
    );
    const client = createFakeClient({ customerPages: [] });

    const tools = createAsaasReadTools({
      client,
      ledgerPath,
      customerCachePath,
      operationIdFactory: () => "op_cached_search"
    });

    const receipt = await tools.searchCustomers({ query: "cache" });

    expect(receipt.data).toEqual([{ id: "cached_101", name: "Cliente Cache" }]);
    expect(client.customerPageRequests).toEqual([]);
  });

  it("refreshes and writes the customer cache with non-sensitive fields only", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-asaas-cache-"));
    const ledgerPath = path.join(dir, "ledger", "operations.jsonl");
    const customerCachePath = path.join(dir, "cache", "customers.json");
    const customerFixture = JSON.parse(
      readFileSync(path.join(fixturesDir, "customer-table.json"), "utf-8")
    ) as { content: string };
    const client = createFakeClient({
      customerPages: [customerFixture.content]
    });

    const tools = createAsaasReadTools({
      client,
      ledgerPath,
      customerCachePath,
      operationIdFactory: () => "op_refresh_cache"
    });

    await tools.searchCustomers({ query: "", refreshCache: true });

    const rawCache = await readFile(customerCachePath, "utf-8");
    expect(rawCache).toContain("Cliente Exemplo Ltda");
    expect(rawCache).not.toContain("financeiro@example.test");
    expect(rawCache).not.toContain("+55 11 90000-0000");
  });

  it("lists pending charges for a customer", async () => {
    const ledgerPath = await tempLedgerPath();
    const chargeFixture = JSON.parse(
      readFileSync(path.join(fixturesDir, "pending-charges.json"), "utf-8")
    ) as { content: string };
    const client = createFakeClient({
      chargePages: [chargeFixture.content]
    });

    const tools = createAsaasReadTools({
      client,
      ledgerPath,
      operationIdFactory: () => "op_pending_charges"
    });

    const receipt = await tools.listPendingCharges({ customerId: "101" });

    expect(receipt.status).toBe("succeeded");
    expect(receipt.data).toEqual([
      {
        id: "501",
        customerId: "101",
        customerName: "Cliente Exemplo Ltda",
        valueBr: "R$ 120,50",
        dueDateBr: "20/07/2026",
        status: "Aguardando pagamento",
        description: "HONORARIO MENSAL"
      }
    ]);
    expect(client.chargePageRequests).toEqual([{ customerId: "101", offset: 0, max: 100 }]);
  });

  it("extracts charge boleto links", async () => {
    const ledgerPath = await tempLedgerPath();
    const html = readFileSync(path.join(fixturesDir, "charge-show.html"), "utf-8");
    const client = createFakeClient({
      chargeHtmlById: { "501": html }
    });

    const tools = createAsaasReadTools({
      client,
      ledgerPath,
      operationIdFactory: () => "op_charge_links"
    });

    const receipt = await tools.getChargeLinks({ chargeId: "501" });

    expect(receipt).toMatchObject({
      status: "succeeded",
      data: {
        chargeId: "501",
        boletoUrl: "https://www.asaas.com/b/pdf/tok_test_123",
        invoiceUrl: "https://www.asaas.com/i/tok_test_123",
        externalToken: "tok_test_123"
      }
    });
  });

  it("plans a due date update in dry-run without calling the mapped POST", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-asaas-mutation-"));
    const ledgerPath = path.join(dir, "ledger", "operations.jsonl");
    const client = createFakeClient({});
    const tools = createAsaasMutationTools({
      client,
      ledgerPath,
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "dry-run",
      allowLiveMutations: false,
      operationIdFactory: () => "op_update_due_date"
    });

    const receipt = await tools.updateChargeDueDate({
      chargeId: "501",
      dueDateBr: "25/07/2026"
    });

    expect(receipt.status).toBe("planned");
    expect(receipt.data?.approvalPreview).toMatchObject({
      operationId: "op_update_due_date",
      provider: "asaas",
      toolName: "asaas.update_charge_due_date",
      action: "update",
      target: { chargeId: "501" },
      changes: [{ field: "dueDate", to: "25/07/2026" }]
    });
    expect(receipt.data?.plannedRequest).toMatchObject({
      method: "POST",
      url: "https://www.asaas.com/payment/update",
      payload: { id: "501", dueDate: "25/07/2026" }
    });
    expect(client.updateChargeDueDateCalls).toEqual([]);
  });

  it("blocks a live due date update without exact approval", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-asaas-mutation-"));
    const ledgerPath = path.join(dir, "ledger", "operations.jsonl");
    const client = createFakeClient({});
    const tools = createAsaasMutationTools({
      client,
      ledgerPath,
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      operationIdFactory: () => "op_update_due_date"
    });

    const receipt = await tools.updateChargeDueDate({
      chargeId: "501",
      dueDateBr: "25/07/2026"
    });

    expect(receipt.status).toBe("blocked");
    expect(receipt.warnings[0]).toContain("approval");
    expect(client.updateChargeDueDateCalls).toEqual([]);
  });

  it("executes a live due date update only with exact approval", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-asaas-mutation-"));
    const ledgerPath = path.join(dir, "ledger", "operations.jsonl");
    const client = createFakeClient({});
    const tools = createAsaasMutationTools({
      client,
      ledgerPath,
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      operationIdFactory: () => "op_update_due_date"
    });

    const receipt = await tools.updateChargeDueDate({
      chargeId: "501",
      dueDateBr: "25/07/2026",
      approvalText: "APROVAR op_update_due_date"
    });

    expect(receipt.status).toBe("succeeded");
    expect(client.updateChargeDueDateCalls).toEqual([
      { chargeId: "501", dueDateBr: "25/07/2026" }
    ]);
  });

  it("plans boleto creation in dry-run without calling the mapped POST", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-asaas-mutation-"));
    const ledgerPath = path.join(dir, "ledger", "operations.jsonl");
    const client = createFakeClient({});
    const tools = createAsaasMutationTools({
      client,
      ledgerPath,
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "dry-run",
      allowLiveMutations: false,
      operationIdFactory: () => "op_create_charge"
    });

    const receipt = await tools.createBoletoCharge({
      customerId: "101",
      valueBr: "120,50",
      dueDateBr: "20/07/2026",
      description: "Honorarios"
    });

    expect(receipt.status).toBe("planned");
    expect(receipt.data?.approvalPreview).toMatchObject({
      action: "create",
      target: { customerId: "101" },
      changes: [
        { field: "billingType", to: "BOLETO" },
        { field: "value", to: "120,50" },
        { field: "dueDate", to: "20/07/2026" }
      ]
    });
    expect(receipt.data?.plannedRequest.payload).toMatchObject({
      customerAccountId: "101",
      billingType: "BOLETO",
      value: "120,50",
      dueDate: "20/07/2026",
      "interest.value": "2,00",
      "fine.value": "1,00"
    });
    expect(receipt.data?.idempotencyKey).toMatch(/^asaas-boleto:/);
    expect(receipt.artifacts[0]).toMatchObject({
      kind: "json",
      label: "plano do boleto"
    });
    expect(client.createBoletoChargeCalls).toEqual([]);
  });

  it("resolves an Asaas boleto workflow by customer name", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-asaas-mutation-"));
    const ledgerPath = path.join(dir, "ledger", "operations.jsonl");
    const customerFixture = JSON.parse(
      readFileSync(path.join(fixturesDir, "customer-table.json"), "utf-8")
    ) as { content: string };
    const client = createFakeClient({ customerPages: [customerFixture.content] });
    const tools = createAsaasMutationTools({
      client,
      ledgerPath,
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "dry-run",
      allowLiveMutations: false,
      operationIdFactory: () => "op_asaas_workflow"
    });

    const receipt = await tools.createBoletoChargeWorkflow({
      customerName: "Cliente Exemplo Ltda",
      valueBr: "120,50",
      dueDateBr: "20/07/2026",
      description: "Honorarios"
    });

    expect(receipt).toMatchObject({
      operationId: "op_asaas_workflow",
      toolName: "asaas.create_boleto_charge_workflow",
      status: "planned",
      data: {
        resolved: {
          customerId: "101",
          customerName: "Cliente Exemplo Ltda"
        }
      }
    });
    expect(client.createBoletoChargeCalls).toEqual([]);
  });

  it("blocks repeated Asaas boleto creation with the same idempotency key", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-asaas-mutation-"));
    const ledgerPath = path.join(dir, "ledger", "operations.jsonl");
    const client = createFakeClient({});
    const tools = createAsaasMutationTools({
      client,
      ledgerPath,
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true
    });
    const params = {
      customerId: "101",
      valueBr: "120,50",
      dueDateBr: "20/07/2026",
      description: "Honorarios"
    };

    const first = await tools.createBoletoCharge({
      ...params,
      operationId: "op_asaas_first",
      approvalText: "APROVAR op_asaas_first"
    });
    const repeated = await tools.createBoletoCharge({
      ...params,
      operationId: "op_asaas_repeat",
      approvalText: "APROVAR op_asaas_repeat"
    });

    expect(first.status).toBe("succeeded");
    expect(repeated.status).toBe("blocked");
    expect(repeated.warnings[0]).toContain("op_asaas_first");
    expect(client.createBoletoChargeCalls).toHaveLength(1);
  });

  it("plans boleto PDF download in dry-run without calling the mapped GET", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-asaas-download-"));
    const ledgerPath = path.join(dir, "ledger", "operations.jsonl");
    const artifactsDir = path.join(dir, "artifacts");
    const client = createFakeClient({});
    const tools = createAsaasMutationTools({
      client,
      ledgerPath,
      artifactsDir,
      runtimeMode: "dry-run",
      allowLiveMutations: false,
      operationIdFactory: () => "op_download_pdf"
    });

    const receipt = await tools.downloadBoletoPdf({
      externalToken: "tok_test_123",
      fileName: "boleto_501.pdf"
    });

    expect(receipt.status).toBe("planned");
    expect(receipt.artifacts[0]).toMatchObject({
      kind: "pdf",
      path: path.join(artifactsDir, "asaas", "op_download_pdf", "boleto_501.pdf"),
      label: "boleto pdf planejado"
    });
    expect(client.downloadBoletoPdfCalls).toEqual([]);
  });

  it("downloads boleto PDF in live mode and stores it as an artifact", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-asaas-download-"));
    const ledgerPath = path.join(dir, "ledger", "operations.jsonl");
    const artifactsDir = path.join(dir, "artifacts");
    const client = createFakeClient({});
    const tools = createAsaasMutationTools({
      client,
      ledgerPath,
      artifactsDir,
      runtimeMode: "live",
      allowLiveMutations: false,
      operationIdFactory: () => "op_download_pdf"
    });

    const receipt = await tools.downloadBoletoPdf({
      externalToken: "tok_test_123",
      fileName: "boleto_501.pdf"
    });

    expect(receipt.status).toBe("succeeded");
    expect(client.downloadBoletoPdfCalls).toEqual(["tok_test_123"]);
    expect(receipt.artifacts[0]).toMatchObject({
      kind: "pdf",
      path: path.join(artifactsDir, "asaas", "op_download_pdf", "boleto_501.pdf"),
      label: "boleto pdf"
    });
    await expect(readFile(receipt.artifacts[0]!.path)).resolves.toEqual(Buffer.from("%PDF-test"));
  });
});

async function tempLedgerPath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "harness-asaas-tools-"));
  return path.join(dir, "ledger", "operations.jsonl");
}

function createFakeClient(options: {
  customerPages?: string[];
  chargePages?: string[];
  chargeHtmlById?: Record<string, string>;
}): AsaasMutationClient & {
  customerPageRequests: Array<{ offset: number; max: number }>;
  chargePageRequests: Array<{ customerId: string; offset: number; max: number }>;
  updateChargeDueDateCalls: Array<{ chargeId: string; dueDateBr: string }>;
  createBoletoChargeCalls: Array<{
    customerId: string;
    valueBr: string;
    dueDateBr: string;
    description: string;
  }>;
  downloadBoletoPdfCalls: string[];
} {
  const customerPages = [...(options.customerPages ?? [])];
  const chargePages = [...(options.chargePages ?? [])];
  const client = {
    customerPageRequests: [] as Array<{ offset: number; max: number }>,
    chargePageRequests: [] as Array<{ customerId: string; offset: number; max: number }>,
    updateChargeDueDateCalls: [] as Array<{ chargeId: string; dueDateBr: string }>,
    createBoletoChargeCalls: [] as Array<{
      customerId: string;
      valueBr: string;
      dueDateBr: string;
      description: string;
    }>,
    downloadBoletoPdfCalls: [] as string[],
    async listCustomersPage(offset = 0, max = 50) {
      client.customerPageRequests.push({ offset, max });
      return customerPages.shift() ?? "";
    },
    async listChargesPage(customerId: string, offset = 0, max = 100) {
      client.chargePageRequests.push({ customerId, offset, max });
      return chargePages.shift() ?? "";
    },
    async getChargeDetailHtml(chargeId: string) {
      return options.chargeHtmlById?.[chargeId] ?? "";
    },
    async updateChargeDueDate(chargeId: string, dueDateBr: string) {
      client.updateChargeDueDateCalls.push({ chargeId, dueDateBr });
      return { ok: true, status: 200 };
    },
    async createBoletoCharge(params: CreateBoletoChargeInput) {
      client.createBoletoChargeCalls.push(params);
      return { paymentId: "pay_test_001", externalToken: "tok_test_123", raw: {} };
    },
    async downloadBoletoPdf(externalToken: string) {
      client.downloadBoletoPdfCalls.push(externalToken);
      return Buffer.from("%PDF-test");
    }
  };

  return client;
}
