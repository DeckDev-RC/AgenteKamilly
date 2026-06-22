import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { readLedgerEntries } from "../../../src/core/ledger.js";
import type {
  CancelChargeRequestsParams,
  CreateChargeRequestParams,
  CreateCustomerParams as CreateCustomerClientParams,
  CreateServiceSaleParams,
  ContaAzulReadClient,
  ContaAzulMutationClient,
  SearchFinancialStatementParams,
  SendChargeNotificationParams,
  UpdateInstallmentDueDateParams
} from "../../../src/modules/contaazul/client.js";
import { ContaAzulSessionExpiredError } from "../../../src/modules/contaazul/client.js";
import {
  createContaAzulMutationTools,
  createContaAzulReadTools
} from "../../../src/modules/contaazul/tools.js";

const fixturesDir = path.join(process.cwd(), "tests", "fixtures", "contaazul");

describe("Conta Azul read tools", () => {
  it("lists accountancy clients and writes a redacted ledger entry", async () => {
    const ledgerPath = await tempLedgerPath();
    const clientFixture = JSON.parse(
      readFileSync(path.join(fixturesDir, "accountancy-clients.json"), "utf-8")
    );
    const client = createFakeClient({ accountancyClients: clientFixture });
    const tools = createContaAzulReadTools({
      client,
      ledgerPath,
      operationIdFactory: () => "op_list_clients"
    });

    const receipt = await tools.listAccountancyClients();

    expect(receipt).toMatchObject({
      operationId: "op_list_clients",
      provider: "contaazul",
      toolName: "contaazul.list_accountancy_clients",
      status: "succeeded",
      data: [
        {
          relationId: "rel_001",
          tenantId: 101,
          name: "Cliente Exemplo Ltda"
        }
      ]
    });
    const entries = await readLedgerEntries(ledgerPath);
    expect(JSON.stringify(entries)).not.toContain("pro-token-test");
  });

  it("switches to Pro session without returning raw auth token", async () => {
    const ledgerPath = await tempLedgerPath();
    const client = createFakeClient({ proToken: "pro-token-test" });
    const tools = createContaAzulReadTools({
      client,
      ledgerPath,
      operationIdFactory: () => "op_switch"
    });

    const receipt = await tools.switchToProSession({ relationId: "rel_001" });

    expect(receipt.status).toBe("succeeded");
    expect(receipt.data).toEqual({
      relationId: "rel_001",
      proSessionId: "relation:rel_001",
      authToken: "[REDACTED_SECRET]"
    });
    const entries = await readLedgerEntries(ledgerPath);
    expect(JSON.stringify(entries)).not.toContain("pro-token-test");
  });

  it("searches financial statement after a Pro session switch", async () => {
    const ledgerPath = await tempLedgerPath();
    const statementFixture = JSON.parse(
      readFileSync(path.join(fixturesDir, "financial-statement-page.json"), "utf-8")
    );
    const client = createFakeClient({
      proToken: "pro-token-test",
      financialStatementItems: statementFixture.items
    });
    const tools = createContaAzulReadTools({
      client,
      ledgerPath,
      operationIdFactory: (toolName) => `op_${toolName.replace(/[^a-z]+/g, "_")}`
    });

    await tools.switchToProSession({ relationId: "rel_001" });
    const receipt = await tools.searchFinancialStatement({
      relationId: "rel_001",
      query: "honorarios"
    });

    expect(receipt.status).toBe("succeeded");
    expect(receipt.data).toEqual([
      {
        id: "inst_001",
        financialEventId: "event_001",
        description: "Honorarios mensais",
        value: 250.75,
        dueDateIso: "2026-07-20",
        customerName: "Cliente Exemplo Ltda",
        status: "OVERDUE",
        installmentId: "inst_001"
      }
    ]);
    expect(client.searchCalls).toEqual([
      { authToken: "pro-token-test", query: "honorarios", pageSize: 100 }
    ]);
  });

  it("searches sale customers, financial categories, and service items after a Pro session switch", async () => {
    const ledgerPath = await tempLedgerPath();
    const client = createFakeClient({ proToken: "pro-token-test" });
    const tools = createContaAzulReadTools({
      client,
      ledgerPath,
      operationIdFactory: (toolName) => `op_${toolName.replace(/[^a-z]+/g, "_")}`
    });

    await tools.switchToProSession({ relationId: "rel_001" });
    const customers = await tools.searchSaleCustomers({
      relationId: "rel_001",
      searchTerm: "AZUOS"
    });
    const categories = await tools.searchFinancialCategories({
      relationId: "rel_001",
      searchTerm: "Honorário"
    });
    const items = await tools.searchServiceItems({
      relationId: "rel_001",
      searchTerm: "Honorário Contábil"
    });

    expect(customers).toMatchObject({
      status: "succeeded",
      toolName: "contaazul.search_sale_customers",
      data: [{ id: "cust_1", name: "AZUOS ASSESSORIA CONTÁBIL LTDA" }]
    });
    expect(categories).toMatchObject({
      status: "succeeded",
      toolName: "contaazul.search_financial_categories",
      data: [{ uuid: "cat_1", dsNaturezaFinanceira: "Honorário contábil mensal" }]
    });
    expect(items).toMatchObject({
      status: "succeeded",
      toolName: "contaazul.search_service_items",
      data: [{ id: "item_1", name: "Honorário Contábil" }]
    });
    expect(client.lookupCalls).toEqual([
      {
        name: "searchSaleCustomers",
        payload: { authToken: "pro-token-test", searchTerm: "AZUOS" }
      },
      {
        name: "searchFinancialCategories",
        payload: { authToken: "pro-token-test", searchTerm: "Honorário" }
      },
      {
        name: "searchServiceItems",
        payload: { authToken: "pro-token-test", searchTerm: "Honorário Contábil" }
      }
    ]);
  });

  it("shares the Pro session across separate tool instances via a shared proSessionStore", async () => {
    const ledgerPath = await tempLedgerPath();
    const client = createFakeClient({ proToken: "pro-token-test" });
    const proSessionStore = new Map<string, string>();

    // Turn A registry build: switch the session.
    const turnA = createContaAzulReadTools({
      client,
      ledgerPath,
      proSessionStore,
      operationIdFactory: () => "op_turn_a"
    });
    await turnA.switchToProSession({ relationId: "rel_001" });

    // Turn B registry build (fresh tool instance) sharing the same store.
    const turnB = createContaAzulReadTools({
      client,
      ledgerPath,
      proSessionStore,
      operationIdFactory: () => "op_turn_b"
    });
    const receipt = await turnB.searchSaleCustomers({
      relationId: "rel_001",
      searchTerm: "AZUOS"
    });

    expect(receipt.status).toBe("succeeded");
    expect(receipt.data).toEqual([{ id: "cust_1", name: "AZUOS ASSESSORIA CONTÁBIL LTDA" }]);
  });

  it("blocks Conta Azul lookup tools when Pro session was not switched", async () => {
    const ledgerPath = await tempLedgerPath();
    const client = createFakeClient({});
    const tools = createContaAzulReadTools({
      client,
      ledgerPath,
      operationIdFactory: () => "op_missing_lookup_session"
    });

    const receipt = await tools.searchSaleCustomers({
      relationId: "rel_001",
      searchTerm: "AZUOS"
    });

    expect(receipt.status).toBe("blocked");
    expect(receipt.warnings[0]).toContain("switchToProSession");
    expect(client.lookupCalls).toEqual([]);
  });

  it("blocks financial statement search when Pro session was not switched", async () => {
    const ledgerPath = await tempLedgerPath();
    const client = createFakeClient({});
    const tools = createContaAzulReadTools({
      client,
      ledgerPath,
      operationIdFactory: () => "op_missing_session"
    });

    const receipt = await tools.searchFinancialStatement({ relationId: "rel_001" });

    expect(receipt.status).toBe("blocked");
    expect(receipt.warnings[0]).toContain("switchToProSession");
  });

  it("blocks with recapture instructions when Conta Azul session expires", async () => {
    const ledgerPath = await tempLedgerPath();
    const client = createFakeClient({
      proToken: "pro-token-test",
      searchError: new ContaAzulSessionExpiredError("Conta Azul session expired.")
    });
    const tools = createContaAzulReadTools({
      client,
      ledgerPath,
      operationIdFactory: () => "op_expired"
    });

    await tools.switchToProSession({ relationId: "rel_001" });
    const receipt = await tools.searchFinancialStatement({ relationId: "rel_001" });

    expect(receipt.status).toBe("blocked");
    expect(receipt.warnings.join(" ")).toContain("node contaazul/capture.js");
  });
});

describe("Conta Azul mutation tools", () => {
  it("plans due-date update and boleto reissue in dry-run without POST/PATCH calls", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const client = createFakeMutationClient({});
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "dry-run",
      allowLiveMutations: false,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]]),
      operationIdFactory: () => "op_reissue"
    });

    const receipt = await tools.updateDueDateReissueBoleto({
      relationId: "rel_001",
      financialEventId: "event_001",
      installmentId: "inst_001",
      dueDateIso: "2026-07-25",
      email: "cliente@example.test",
      value: 250.75,
      originalDescription: "Honorarios mensais",
      installmentVersion: 3,
      installmentIndex: 1,
      activeChargeRequests: [{ id: "charge_old", status: "ACTIVE" }]
    });

    expect(receipt.status).toBe("planned");
    expect(receipt.data?.approvalPreview).toMatchObject({
      operationId: "op_reissue",
      provider: "contaazul",
      toolName: "contaazul.update_due_date_reissue_boleto",
      action: "update",
      target: { installmentId: "inst_001" },
      changes: [{ field: "dueDate", to: "2026-07-25" }]
    });
    expect(receipt.data?.plannedRequests).toEqual([
      {
        method: "POST",
        url: "https://services.contaazul.com/finance-pro/v1/charge-requests/batch-cancel",
        payload: { chargeRequests: [{ id: "charge_old", status: "ACTIVE" }] }
      },
      {
        method: "PATCH",
        url: "https://services.contaazul.com/finance-pro/v1/installments/inst_001",
        payload: {
          dueDate: "2026-07-25",
          expectedPaymentDate: "2026-07-25",
          isCaPaymentType: true,
          version: 3
        }
      },
      {
        method: "POST",
        url: "https://services.contaazul.com/finance-pro/v2/charge-requests/batch-create",
        payload: {
          financialAccountId: "account_test",
          installmentGroups: [
            {
              originalDescription: "Honorarios mensais",
              description: "Honorarios mensais - 1/1",
              installmentIds: [{ id: "inst_001", version: 3 }],
              dueDate: "2026-07-25",
              value: 250.75,
              index: 1
            }
          ],
          type: "RECEBA_FACIL_BANK_SLIP",
          customAttributes: { charge: { type: "INVOICE" } },
          notification: {
            emails: ["cliente@example.test"],
            scheduled: true,
            instantSending: false,
            smsNumbers: [],
            whatsappNumbers: []
          }
        }
      }
    ]);
    expect(receipt.data?.pollingPlan).toMatchObject({
      url: "https://services.contaazul.com/contaazul-bff/finance/v1/financial-events/event_001/summary",
      maxAttempts: 10
    });
    expect(client.calls).toEqual([]);
  });

  it("blocks live reissue without exact approval", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const client = createFakeMutationClient({});
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]]),
      operationIdFactory: () => "op_reissue"
    });

    const receipt = await tools.updateDueDateReissueBoleto({
      relationId: "rel_001",
      financialEventId: "event_001",
      installmentId: "inst_001",
      dueDateIso: "2026-07-25",
      email: "cliente@example.test",
      value: 250.75,
      originalDescription: "Honorarios mensais",
      installmentVersion: 3,
      installmentIndex: 1
    });

    expect(receipt.status).toBe("blocked");
    expect(client.calls).toEqual([]);
  });

  it("executes live reissue only with exact approval", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const client = createFakeMutationClient({});
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]]),
      operationIdFactory: () => "op_reissue"
    });

    const receipt = await tools.updateDueDateReissueBoleto({
      relationId: "rel_001",
      financialEventId: "event_001",
      installmentId: "inst_001",
      dueDateIso: "2026-07-25",
      email: "cliente@example.test",
      value: 250.75,
      originalDescription: "Honorarios mensais",
      installmentVersion: 3,
      installmentIndex: 1,
      activeChargeRequests: [{ id: "charge_old", status: "ACTIVE" }],
      approvalText: "APROVAR op_reissue"
    });

    expect(receipt.status).toBe("succeeded");
    expect(client.calls.map((call: any) => call.name)).toEqual([
      "cancelChargeRequests",
      "updateInstallmentDueDate",
      "createChargeRequest"
    ]);
  });

  it("plans customer creation as a structured payload in dry-run", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const client = createFakeMutationClient({});
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "dry-run",
      allowLiveMutations: false,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]]),
      operationIdFactory: () => "op_customer"
    });

    const receipt = await tools.createCustomer({
      relationId: "rel_001",
      person: {
        personType: "Jurídica",
        legalDocument: "00000000000000",
        name: "Cliente Exemplo",
        companyName: "Cliente Exemplo Ltda",
        email: "cliente@example.test",
        billingEmail: "cobranca@example.test",
        billingPhone: "11999999999",
        address: {
          zipcode: "01001000",
          neighborhood: "CENTRO",
          numberAddress: "100",
          state: "SP",
          city: 123,
          address: "RUA TESTE",
          complement: "",
          country: "Brasil",
          idCity: 123
        }
      }
    });

    expect(receipt.status).toBe("planned");
    expect(receipt.data?.plannedRequests[0]).toMatchObject({
      method: "POST",
      url: "https://services.contaazul.com/contaazul-bff/person-registration/v1/persons",
      payload: {
        personType: "Jurídica",
        legalDocument: "00000000000000",
        name: "Cliente Exemplo",
        companyName: "Cliente Exemplo Ltda",
        profiles: [{ profileType: "Cliente" }],
        registrations: [{}],
        billingContact: { emails: ["cobranca@example.test"], phoneNumber: "11999999999" },
        origin: "CadastroUnico"
      }
    });
    expect(client.calls).toEqual([]);
  });

  it("plans service sale, boleto issue, notification, polling, and PDF artifact in dry-run", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const artifactsDir = path.join(dir, "artifacts");
    const client = createFakeMutationClient({});
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir,
      runtimeMode: "dry-run",
      allowLiveMutations: false,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]]),
      operationIdFactory: () => "op_sale"
    });

    const receipt = await tools.createServiceSaleAndIssueBoleto({
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
      notification: {
        email: "cliente@example.test",
        phone: "11999999999"
      }
    });

    expect(receipt.status).toBe("planned");
    expect(receipt.data?.plannedRequests.map((request) => request.url)).toEqual([
      "https://services.contaazul.com/app/v1/sales/",
      "https://services.contaazul.com/finance-pro/v2/charge-requests/batch-create",
      "https://services.contaazul.com/finance-pro/v1/charge-notifications"
    ]);
    expect(receipt.data?.plannedRequests[0].payload).toMatchObject({
      customerId: "person_uuid",
      number: 123,
      categoryId: "cat_uuid",
      paymentCondition: {
        paymentType: "BANKING_BILLET",
        financialAccountId: "account_test",
        paymentConditionOption: "1x",
        installments: [{ dueDate: "2026-07-20", value: 250.75 }]
      }
    });
    expect(receipt.data?.plannedRequests[2].payload).toMatchObject({
      emails: ["cliente@example.test"],
      replyTo: "reply@example.test",
      subject: "[Importante] Chegou sua fatura de Empresa Pro"
    });
    expect(receipt.artifacts[0]).toMatchObject({
      kind: "pdf",
      path: path.join(artifactsDir, "contaazul", "op_sale", "boleto_venda_123.pdf")
    });
    expect(client.calls.map((call: any) => call.name)).toEqual([
      "getPersonDetails",
      "getCompanyDetails"
    ]);
  });

  it("resolves service sale workflow by names before planning the boleto flow", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const artifactsDir = path.join(dir, "artifacts");
    const client = createFakeMutationClient({});
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir,
      runtimeMode: "dry-run",
      allowLiveMutations: false,
      config: mutationConfig(),
      proSessionStore: new Map(),
      operationIdFactory: () => "op_workflow_sale"
    });

    const receipt = await tools.createServiceSaleBoletoWorkflow({
      tenantId: 101,
      customerName: "Cliente Exemplo",
      categoryName: "Honorarios mensais",
      itemName: "Honorarios Contabeis",
      serviceDescription: "Honorarios mensais",
      unitValueBr: "250,75",
      dueDateBr: "20/07/2026",
      notification: {
        email: "cliente@example.test",
        phone: "11999999999"
      }
    });

    expect(receipt).toMatchObject({
      operationId: "op_workflow_sale",
      toolName: "contaazul.create_service_sale_boleto_workflow",
      status: "planned",
      dryRun: true
    });
    expect(receipt.data?.resolved).toMatchObject({
      relationId: "rel_001",
      customerId: "person_uuid",
      categoryId: "cat_uuid",
      serviceItemId: "item_uuid",
      saleNumber: 123,
      dueDateIso: "2026-07-20",
      unitValue: 250.75
    });
    expect(receipt.data?.idempotencyKey).toMatch(/^contaazul-sale-boleto/);
    expect(receipt.artifacts[0]).toMatchObject({
      kind: "pdf",
      path: path.join(artifactsDir, "contaazul", "op_workflow_sale", "boleto_venda_123.pdf")
    });
    expect(client.calls.map((call: any) => call.name)).toEqual([
      "searchSaleCustomers",
      "searchFinancialCategories",
      "searchServiceItems",
      "listOperationNatures",
      "getNextSaleNumber",
      "getCompanyDetails",
      "getPersonDetails"
    ]);
  });

  it("executes live service sale with polling, notification, and PDF artifact after exact approval", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const artifactsDir = path.join(dir, "artifacts");
    const client = createFakeMutationClient({});
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir,
      runtimeMode: "live",
      allowLiveMutations: true,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]]),
      operationIdFactory: () => "op_sale"
    });

    const receipt = await tools.createServiceSaleAndIssueBoleto({
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
      notification: {
        email: "cliente@example.test",
        phone: "11999999999"
      },
      approvalText: "APROVAR op_sale"
    });

    expect(receipt.status).toBe("succeeded");
    expect(client.calls.map((call: any) => call.name)).toEqual([
      "getPersonDetails",
      "getCompanyDetails",
      "createServiceSale",
      "getFinancialEventsByReference",
      "createChargeRequest",
      "sendChargeNotification",
      "searchFinancialStatement",
      "downloadBoletoPdf"
    ]);
    expect(client.calls.find((call: any) => call.name === "createChargeRequest")?.payload).toMatchObject({
      payload: {
        installmentGroups: [
          {
            installmentIds: [{ id: "inst_sale", version: 7 }]
          }
        ]
      }
    });
    expect(client.calls.find((call: any) => call.name === "sendChargeNotification")?.payload).toMatchObject({
      payload: {
        chargeRequestIds: ["charge_new"]
      }
    });
    expect(client.calls.find((call: any) => call.name === "searchFinancialStatement")?.payload).toMatchObject({
      query: "Venda 123",
      pageSize: 100
    });
    expect(client.calls.find((call: any) => call.name === "downloadBoletoPdf")?.payload).toMatchObject({
      chargeRequestId: "charge_new",
      chargeUrl: "https://extrato.example.test/fatura"
    });
    expect(receipt.data?.result).toMatchObject({
      saleId: "sale_uuid",
      financialEventId: "event_sale",
      installmentId: "inst_sale",
      chargeRequestId: "charge_new",
      chargeUrl: "https://extrato.example.test/fatura",
      chargeUrlSource: "financial_statement"
    });
    expect(receipt.artifacts[0]).toMatchObject({
      kind: "pdf",
      path: path.join(artifactsDir, "contaazul", "op_sale", "boleto_venda_123.pdf")
    });
  });

  it("uses the legacy financial account id when config is empty", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const client = createFakeMutationClient({});
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "dry-run",
      allowLiveMutations: false,
      config: { financialAccountId: "", defaultReplyToEmail: "reply@example.test", defaultCompanyDisplayName: "Empresa Teste" },
      proSessionStore: new Map([["rel_001", "pro-token-test"]]),
      operationIdFactory: () => "op_no_account"
    });

    const receipt = await tools.createServiceSaleAndIssueBoleto({
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
    });

    expect(receipt.status).toBe("planned");
    expect(receipt.data?.plannedRequests[0].payload).toMatchObject({
      paymentCondition: {
        financialAccountId: "cf6eedce-10e8-4554-b707-9246826b12c6"
      }
    });
    expect(client.calls.map((call: any) => call.name)).toEqual([
      "getPersonDetails",
      "getCompanyDetails"
    ]);
  });

  it("blocks a repeated service sale when an idempotency match already succeeded", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const client = createFakeMutationClient({});
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]])
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
      notification: {
        email: "cliente@example.test",
        phone: "11999999999"
      }
    };

    const first = await tools.createServiceSaleAndIssueBoleto({
      ...params,
      operationId: "op_sale_first",
      approvalText: "APROVAR op_sale_first"
    });
    const callCountAfterFirst = client.calls.length;
    const repeated = await tools.createServiceSaleAndIssueBoleto({
      ...params,
      operationId: "op_sale_repeat",
      approvalText: "APROVAR op_sale_repeat"
    });

    expect(first.status).toBe("succeeded");
    expect(repeated.status).toBe("blocked");
    expect(repeated.warnings[0]).toContain("op_sale_first");
    expect(client.calls).toHaveLength(callCountAfterFirst);
  });

  it("blocks a live sale with recapture guidance when the Pro session is expired", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const base = createFakeMutationClient({});
    const client = {
      ...base,
      async verifyProSession() {
        throw new ContaAzulSessionExpiredError("Conta Azul session expired.");
      }
    };
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]]),
      operationIdFactory: () => "op_expired_sale"
    });

    const receipt = await tools.createServiceSaleAndIssueBoleto({
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
      notification: { email: "cliente@example.test", phone: "11999999999" },
      approvalText: "APROVAR op_expired_sale"
    });

    expect(receipt.status).toBe("blocked");
    expect(receipt.warnings.join(" ")).toContain("node contaazul/capture.js");
    expect(base.calls.map((call: any) => call.name)).toEqual([
      "getPersonDetails",
      "getCompanyDetails"
    ]);
  });

  it("captures the orphaned sale id when a post-sale step fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const base = createFakeMutationClient({});
    const client = {
      ...base,
      async getFinancialEventsByReference(params: unknown) {
        base.calls.push({ name: "getFinancialEventsByReference", payload: params });
        throw new Error("financial event lookup failed");
      }
    };
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]]),
      operationIdFactory: () => "op_partial"
    });

    const receipt = await tools.createServiceSaleAndIssueBoleto({
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
      notification: { email: "cliente@example.test", phone: "11999999999" },
      approvalText: "APROVAR op_partial"
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.warnings.join(" ")).toContain("sale_uuid");
    expect(receipt.data?.result).toMatchObject({ orphanedSaleId: "sale_uuid", failedStep: "poll_financial_event" });
    expect(base.calls.map((call: any) => call.name)).toEqual([
      "getPersonDetails",
      "getCompanyDetails",
      "createServiceSale",
      "getFinancialEventsByReference"
    ]);
  });

  it("blocks a repeated service sale after a partial failure created an orphaned sale", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const base = createFakeMutationClient({});
    const client = {
      ...base,
      async getFinancialEventsByReference(params: unknown) {
        base.calls.push({ name: "getFinancialEventsByReference", payload: params });
        throw new Error("financial event lookup failed");
      }
    };
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]])
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
      notification: { email: "cliente@example.test", phone: "11999999999" }
    };

    const first = await tools.createServiceSaleAndIssueBoleto({
      ...params,
      operationId: "op_partial_first",
      approvalText: "APROVAR op_partial_first"
    });
    const callCountAfterFirst = base.calls.length;
    const repeated = await tools.createServiceSaleAndIssueBoleto({
      ...params,
      operationId: "op_partial_repeat",
      approvalText: "APROVAR op_partial_repeat"
    });

    expect(first.status).toBe("failed");
    expect(first.data?.result).toMatchObject({ orphanedSaleId: "sale_uuid" });
    expect(repeated.status).toBe("blocked");
    expect(repeated.warnings.join(" ")).toContain("op_partial_first");
    expect(repeated.warnings.join(" ")).toContain("sale_uuid");
    expect(base.calls).toHaveLength(callCountAfterFirst);
  });

  it("allows retry after an orphaned sale cleanup is acknowledged", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const base = createFakeMutationClient({});
    const client = {
      ...base,
      async getFinancialEventsByReference(params: unknown) {
        base.calls.push({ name: "getFinancialEventsByReference", payload: params });
        throw new Error("financial event lookup failed");
      }
    };
    const ledgerPath = path.join(dir, "ledger", "operations.jsonl");
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath,
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]])
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
      notification: { email: "cliente@example.test", phone: "11999999999" }
    };

    await tools.createServiceSaleAndIssueBoleto({
      ...params,
      operationId: "op_partial_first",
      approvalText: "APROVAR op_partial_first"
    });
    await expect(
      tools.createServiceSaleAndIssueBoleto({
        ...params,
        operationId: "op_partial_blocked",
        approvalText: "APROVAR op_partial_blocked"
      })
    ).resolves.toMatchObject({ status: "blocked" });

    const ack = await tools.acknowledgeOrphanCleanup({
      operationId: "op_ack_cleanup",
      previousOperationId: "op_partial_first",
      orphanedSaleId: "sale_uuid",
      cleanupAction: "cancelled",
      approvalText: "APROVAR op_ack_cleanup"
    });
    const callCountAfterAck = base.calls.length;
    const repeated = await tools.createServiceSaleAndIssueBoleto({
      ...params,
      operationId: "op_partial_after_ack",
      approvalText: "APROVAR op_partial_after_ack"
    });

    expect(ack.status).toBe("succeeded");
    expect(ack.data?.result).toMatchObject({
      cleanupForOperationId: "op_partial_first",
      orphanedSaleId: "sale_uuid",
      cleanupAction: "cancelled"
    });
    expect(repeated.status).toBe("failed");
    expect(base.calls.slice(callCountAfterAck).map((call: any) => call.name)).toEqual([
      "getPersonDetails",
      "getCompanyDetails",
      "createServiceSale",
      "getFinancialEventsByReference"
    ]);

    const entries = await readLedgerEntries(ledgerPath);
    expect(entries.find((entry) => entry.operationId === "op_ack_cleanup")).toMatchObject({
      status: "succeeded",
      responseSummary: {
        cleanupForOperationId: "op_partial_first",
        orphanedSaleId: "sale_uuid",
        cleanupAction: "cancelled"
      }
    });
  });

  it("blocks orphan cleanup acknowledgement without a matching partial failure", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const client = createFakeMutationClient({});
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]]),
      operationIdFactory: () => "op_ack_missing"
    });

    const receipt = await tools.acknowledgeOrphanCleanup({
      previousOperationId: "op_missing",
      orphanedSaleId: "sale_uuid",
      cleanupAction: "cancelled",
      approvalText: "APROVAR op_ack_missing"
    });

    expect(receipt.status).toBe("blocked");
    expect(receipt.warnings.join(" ")).toContain("Nenhuma falha parcial");
    expect(client.calls).toEqual([]);
  });

  it("blocks orphan cleanup acknowledgement without exact approval and keeps retry blocked", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const base = createFakeMutationClient({});
    const client = {
      ...base,
      async getFinancialEventsByReference(params: unknown) {
        base.calls.push({ name: "getFinancialEventsByReference", payload: params });
        throw new Error("financial event lookup failed");
      }
    };
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]])
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
      notification: { email: "cliente@example.test", phone: "11999999999" }
    };

    await tools.createServiceSaleAndIssueBoleto({
      ...params,
      operationId: "op_partial_first",
      approvalText: "APROVAR op_partial_first"
    });
    const ack = await tools.acknowledgeOrphanCleanup({
      operationId: "op_ack_wrong",
      previousOperationId: "op_partial_first",
      orphanedSaleId: "sale_uuid",
      cleanupAction: "cancelled",
      approvalText: "APROVAR outro_id"
    });
    const callCountAfterAck = base.calls.length;
    const repeated = await tools.createServiceSaleAndIssueBoleto({
      ...params,
      operationId: "op_partial_still_blocked",
      approvalText: "APROVAR op_partial_still_blocked"
    });

    expect(ack.status).toBe("blocked");
    expect(ack.warnings.join(" ")).toContain("exact operation id");
    expect(repeated.status).toBe("blocked");
    expect(base.calls).toHaveLength(callCountAfterAck);
  });

  it("plans orphan cleanup acknowledgement in dry-run without releasing retry", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const base = createFakeMutationClient({});
    const client = {
      ...base,
      async getFinancialEventsByReference(params: unknown) {
        base.calls.push({ name: "getFinancialEventsByReference", payload: params });
        throw new Error("financial event lookup failed");
      }
    };
    const ledgerPath = path.join(dir, "ledger", "operations.jsonl");
    const liveTools = createContaAzulMutationTools({
      client,
      ledgerPath,
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]])
    });
    const dryRunTools = createContaAzulMutationTools({
      client,
      ledgerPath,
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "dry-run",
      allowLiveMutations: false,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]])
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
      notification: { email: "cliente@example.test", phone: "11999999999" }
    };

    await liveTools.createServiceSaleAndIssueBoleto({
      ...params,
      operationId: "op_partial_first",
      approvalText: "APROVAR op_partial_first"
    });
    const ack = await dryRunTools.acknowledgeOrphanCleanup({
      operationId: "op_ack_dry_run",
      previousOperationId: "op_partial_first",
      orphanedSaleId: "sale_uuid",
      cleanupAction: "cancelled"
    });
    const callCountAfterAck = base.calls.length;
    const repeated = await liveTools.createServiceSaleAndIssueBoleto({
      ...params,
      operationId: "op_partial_after_dry_run_ack",
      approvalText: "APROVAR op_partial_after_dry_run_ack"
    });

    expect(ack.status).toBe("planned");
    expect(ack.dryRun).toBe(true);
    expect(repeated.status).toBe("blocked");
    expect(base.calls).toHaveLength(callCountAfterAck);
  });

  it("records a failed preflight when Pro session verification returns a non-expiry failure", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const base = createFakeMutationClient({});
    const client = {
      ...base,
      async verifyProSession() {
        return false;
      }
    };
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]]),
      operationIdFactory: () => "op_health_check_failed"
    });

    const receipt = await tools.createServiceSaleAndIssueBoleto({
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
      notification: { email: "cliente@example.test", phone: "11999999999" },
      approvalText: "APROVAR op_health_check_failed"
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.warnings.join(" ")).toContain("health check failed");
    expect(receipt.warnings.join(" ")).not.toContain("capture");
    expect(base.calls.map((call: any) => call.name)).toEqual([
      "getPersonDetails",
      "getCompanyDetails"
    ]);
  });

  it("records a failed preflight when Pro session verification throws a technical error", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const base = createFakeMutationClient({});
    const client = {
      ...base,
      async verifyProSession() {
        throw new Error("Conta Azul Pro session health check failed with HTTP 500.");
      }
    };
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]]),
      operationIdFactory: () => "op_health_check_500"
    });

    const receipt = await tools.createServiceSaleAndIssueBoleto({
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
      notification: { email: "cliente@example.test", phone: "11999999999" },
      approvalText: "APROVAR op_health_check_500"
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.warnings.join(" ")).toContain("HTTP 500");
    expect(receipt.warnings.join(" ")).not.toContain("capture");
    expect(base.calls.map((call: any) => call.name)).toEqual([
      "getPersonDetails",
      "getCompanyDetails"
    ]);
  });

  it("captures AmbiguityError and populates candidates and fieldName on the failed receipt", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-ambiguity-"));
    const client = createFakeMutationClient({
      accountancyClients: {
        items: [
          { relationId: "rel_1", tenantId: 101, name: "Kamilly Aguiar" },
          { relationId: "rel_2", tenantId: 102, name: "Kamilly Santos" }
        ]
      }
    });

    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "dry-run",
      allowLiveMutations: false,
      config: mutationConfig(),
      proSessionStore: new Map(),
      operationIdFactory: () => "op_ambiguous"
    });

    const receipt = await tools.createServiceSaleBoletoWorkflow({
      tenantId: "Kamilly", // matches both Kamilly Aguiar and Kamilly Santos partially!
      customerName: "Cliente",
      categoryName: "Honorario",
      itemName: "Item",
      serviceDescription: "Desc",
      unitValueBr: "10,00",
      dueDateBr: "30/06/2026",
      notification: { email: "test@example.com" }
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.summary).toContain("Multiplos itens encontrados");
    expect(receipt.candidates).toEqual(["101 | Kamilly Aguiar", "102 | Kamilly Santos"]);
    expect(receipt.fieldName).toBe("Conta Azul Mais tenant");
  });
});

async function tempLedgerPath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-tools-"));
  return path.join(dir, "ledger", "operations.jsonl");
}

function createFakeClient(options: {
  accountancyClients?: unknown;
  proToken?: string;
  financialStatementItems?: unknown[];
  searchError?: Error;
}): ContaAzulReadClient & {
  searchCalls: Array<{ authToken: string; query?: string; pageSize: number }>;
  lookupCalls: Array<{ name: string; payload: unknown }>;
} {
  const client = {
    searchCalls: [] as Array<{ authToken: string; query?: string; pageSize: number }>,
    lookupCalls: [] as Array<{ name: string; payload: unknown }>,
    async listAccountancyClients() {
      return options.accountancyClients ?? { items: [] };
    },
    async switchToProSession(relationId: string) {
      return { relationId, authToken: options.proToken ?? "pro-token-test" };
    },
    async searchFinancialStatement(params: SearchFinancialStatementParams) {
      if (options.searchError) throw options.searchError;
      client.searchCalls.push({
        authToken: params.authToken,
        query: params.query,
        pageSize: params.pageSize ?? 100
      });
      return options.financialStatementItems ?? [];
    },
    async searchSaleCustomers(params: unknown) {
      client.lookupCalls.push({ name: "searchSaleCustomers", payload: params });
      return [{ id: "cust_1", name: "AZUOS ASSESSORIA CONTÁBIL LTDA" }];
    },
    async searchFinancialCategories(params: unknown) {
      client.lookupCalls.push({ name: "searchFinancialCategories", payload: params });
      return [{ uuid: "cat_1", dsNaturezaFinanceira: "Honorário contábil mensal" }];
    },
    async searchServiceItems(params: unknown) {
      client.lookupCalls.push({ name: "searchServiceItems", payload: params });
      return [{ id: "item_1", name: "Honorário Contábil" }];
    },
    async getPersonDetails(params: unknown) {
      client.lookupCalls.push({ name: "getPersonDetails", payload: params });
      return {
        email: "cliente@example.test",
        billingContact: {
          emails: ["cliente@example.test"],
          phoneNumber: "11999999999"
        }
      };
    }
  };

  return client;
}

function mutationConfig() {
  return {
    financialAccountId: "account_test",
    defaultReplyToEmail: "reply@example.test",
    defaultCompanyDisplayName: "Empresa Teste"
  };
}

function createFakeMutationClient(options: {
  accountancyClients?: unknown;
} = {}): any {
  const client = {
    calls: [] as Array<{ name: string; payload: unknown }>,
    async listAccountancyClients() {
      return options.accountancyClients ?? {
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
    async searchFinancialStatement(params: SearchFinancialStatementParams) {
      client.calls.push({ name: "searchFinancialStatement", payload: params });
      return [
        {
          description: "Venda 123",
          value: 10,
          chargeRequest: {
            id: "charge_new",
            url: "https://extrato.example.test/fatura"
          }
        }
      ];
    },
    async cancelChargeRequests(params: CancelChargeRequestsParams) {
      client.calls.push({ name: "cancelChargeRequests", payload: params });
      return { ok: true, status: 204 };
    },
    async updateInstallmentDueDate(params: UpdateInstallmentDueDateParams) {
      client.calls.push({ name: "updateInstallmentDueDate", payload: params });
      return { id: params.installmentId, version: params.version + 1 };
    },
    async createChargeRequest(params: CreateChargeRequestParams) {
      client.calls.push({ name: "createChargeRequest", payload: params });
      return { items: [{ id: "charge_new" }] };
    },
    async createCustomer(params: CreateCustomerClientParams) {
      client.calls.push({ name: "createCustomer", payload: params });
      return { uuid: "person_uuid", name: "Cliente Exemplo" };
    },
    async createServiceSale(params: CreateServiceSaleParams) {
      client.calls.push({ name: "createServiceSale", payload: params });
      return { id: "sale_uuid", number: 123 };
    },
    async sendChargeNotification(params: SendChargeNotificationParams) {
      client.calls.push({ name: "sendChargeNotification", payload: params });
      return { ok: true };
    },
    async getFinancialEventsByReference(params: unknown) {
      client.calls.push({ name: "getFinancialEventsByReference", payload: params });
      return [
        {
          id: "event_sale",
          paymentCondition: {
            installments: [{ id: "inst_sale", version: 7 }]
          }
        }
      ];
    },
    async getFinancialEventSummary(params: unknown) {
      client.calls.push({ name: "getFinancialEventSummary", payload: params });
      return {
        paymentCondition: {
          installments: [
            {
              id: "inst_sale",
              chargeRequests: [
                {
                  id: "charge_new",
                  url: "https://boleto.example.test/fatura"
                }
              ]
            }
          ]
        }
      };
    },
    async downloadBoletoPdf(params: unknown) {
      client.calls.push({ name: "downloadBoletoPdf", payload: params });
      return Buffer.from("%PDF-1.4 test");
    },
    async getCompanyDetails(params: unknown) {
      client.calls.push({ name: "getCompanyDetails", payload: params });
      return { fantasyName: "Empresa Pro", name: "Empresa Pro LTDA" };
    },
    async getPersonDetails(params: unknown) {
      client.calls.push({ name: "getPersonDetails", payload: params });
      return {
        email: "cliente@example.test",
        billingContact: {
          emails: ["cliente@example.test"],
          phoneNumber: "11999999999"
        }
      };
    }
  };

  return client;
}
