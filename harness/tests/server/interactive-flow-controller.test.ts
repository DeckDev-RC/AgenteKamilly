import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createInteractiveFlowStore,
  runInteractiveFlowTurn
} from "../../src/server/interactive-flow-controller.js";
import { createToolRegistry } from "../../src/core/tool-registry.js";
import { createInMemoryPreferencesStore } from "../../src/core/preferences-store.js";
import type { ToolReceipt } from "../../src/core/tool-types.js";

describe("interactive flow controller", () => {
  it("asks for the billing provider when the user makes a generic boleto request", async () => {
    const result = await runInteractiveFlowTurn({
      request: "Quero gerar um boleto",
      registry: createToolRegistry(),
      sessionId: "sess_generic",
      store: createInteractiveFlowStore()
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result).toMatchObject({
      status: "needs_input",
      toolName: "confere.interactive_boleto_provider",
      missingFields: ["provider"],
      questions: ["Selecione onde o boleto deve ser emitido."]
    });
    expect(result.result.choices).toEqual([
      {
        id: "provider:contaazul",
        label: "Conta Azul",
        description: "Venda de serviço + boleto",
        params: {
          __interactive: { flow: "provider_choice", action: "select_contaazul_service_sale" }
        }
      },
      {
        id: "provider:asaas",
        label: "Asaas",
        description: "Cobrança avulsa",
        params: {
          __interactive: { flow: "provider_choice", action: "select_asaas_boleto" }
        }
      }
    ]);
  });

  it("shows provider operations when the user cites Conta Azul without a concrete task", async () => {
    const result = await runInteractiveFlowTurn({
      request: "Quero fazer outra operação no conta azul",
      registry: createToolRegistry(),
      sessionId: "sess_provider_menu",
      store: createInteractiveFlowStore()
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result).toMatchObject({
      status: "needs_input",
      provider: "contaazul",
      toolName: "confere.interactive_provider_menu",
      missingFields: ["operation"],
      summary: "Qual operação você quer fazer no Conta Azul?"
    });
    expect(result.result.choices?.map((choice) => choice.label)).toEqual([
      "Emitir boleto",
      "Criar cliente",
      "Mudar vencimento"
    ]);
  });

  it("continues Conta Azul provider menu when the user types an operation label", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    registerTenantTools(registry);

    await runInteractiveFlowTurn({
      request: "Quero fazer outra operação no conta azul",
      registry,
      sessionId: "sess_provider_menu_type",
      store
    });

    const result = await runInteractiveFlowTurn({
      request: "Emitir boleto",
      registry,
      sessionId: "sess_provider_menu_type",
      store
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result).toMatchObject({
      status: "needs_input",
      toolName: "contaazul.interactive_service_sale_boleto",
      missingFields: ["tenantId"]
    });
    expect(result.result.toolName).not.toBe("confere.interactive_boleto_provider");
  });

  it("shows provider operations when the user cites Asaas without a concrete task", async () => {
    const result = await runInteractiveFlowTurn({
      request: "preciso de algo no asaas",
      registry: createToolRegistry(),
      sessionId: "sess_provider_menu_asaas",
      store: createInteractiveFlowStore()
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result).toMatchObject({
      status: "needs_input",
      provider: "asaas",
      toolName: "confere.interactive_provider_menu",
      missingFields: ["operation"]
    });
    expect(result.result.choices?.map((choice) => choice.label)).toEqual([
      "Emitir boleto",
      "Baixar boleto",
      "Mudar vencimento"
    ]);
  });

  it("starts the Conta Azul tenant selection after the generic provider choice", async () => {
    const registry = createToolRegistry();
    registerTenantTools(registry);

    const result = await runInteractiveFlowTurn({
      request: "Conta Azul",
      registry,
      sessionId: "sess_generic",
      store: createInteractiveFlowStore(),
      params: {
        __interactive: { flow: "provider_choice", action: "select_contaazul_service_sale" }
      }
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result).toMatchObject({
      status: "needs_input",
      toolName: "contaazul.interactive_service_sale_boleto",
      missingFields: ["tenantId"]
    });
  });

  it("runs the Asaas boleto wizard from provider choice through dry-run planning", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    const calls: unknown[] = [];
    registry.register({
      name: "asaas.search_customers",
      description: "Search Asaas customers",
      parameters: z.object({ query: z.string() }),
      execute: async () =>
        receipt("asaas.search_customers", [
          { id: "asaas_cust_1", name: "AZUOS ASSESSORIA CONTÁBIL LTDA" },
          { id: "asaas_cust_2", name: "AZUOS SERVICOS LTDA" }
        ])
    });
    registry.register({
      name: "asaas.create_boleto_charge_workflow",
      description: "Asaas workflow",
      parameters: z.object({}).passthrough(),
      execute: async (params) => {
        calls.push(params);
        return {
          ...receipt("asaas.create_boleto_charge_workflow", {
            approvalPreview: { operationId: "op_asaas_interactive" }
          }),
          status: "planned"
        } satisfies ToolReceipt;
      }
    });

    const start = await runInteractiveFlowTurn({
      request: "Asaas",
      registry,
      sessionId: "sess_asaas",
      store,
      params: {
        __interactive: { flow: "provider_choice", action: "select_asaas_boleto" }
      }
    });
    expect(start.handled).toBe(true);
    if (!start.handled) throw new Error("expected handled result");
    expect(start.result).toMatchObject({
      status: "needs_input",
      toolName: "asaas.interactive_boleto_charge",
      formId: "asaas_boleto_details",
      missingFields: ["customerId", "valueBr", "dueDateBr", "description"]
    });
    expect(start.result.formChoices?.customerId?.[0]).toMatchObject({
      id: "asaas-customer:asaas_cust_1",
      label: "AZUOS ASSESSORIA CONTÁBIL LTDA"
    });

    const planned = await runInteractiveFlowTurn({
      request: "Preparar boleto",
      registry,
      sessionId: "sess_asaas",
      store,
      params: {
        __interactive: { flow: "asaas_boleto_charge", action: "submit_asaas_boleto_details" },
        customerId: "asaas_cust_1",
        valueBr: "10,00",
        dueDateBr: "30/06/2026",
        description: "Honorário mensal"
      }
    });

    expect(planned.handled).toBe(true);
    if (!planned.handled) throw new Error("expected handled result");
    expect(planned.draftOperationId).toBe("op_asaas_interactive");
    expect(planned.result).toMatchObject({
      status: "executed",
      toolName: "asaas.create_boleto_charge_workflow",
      operationId: "op_asaas_interactive",
      receiptStatus: "planned",
      approvalAvailable: true
    });
    expect(calls).toEqual([
      {
        customerName: "AZUOS ASSESSORIA CONTÁBIL LTDA",
        valueBr: "10,00",
        dueDateBr: "30/06/2026",
        description: "Honorário mensal"
      }
    ]);
  });

  it("starts the Conta Azul service boleto flow by listing tenant choices", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "contaazul.list_accountancy_clients",
      description: "List tenants",
      parameters: z.object({}),
      execute: async () =>
        receipt("contaazul.list_accountancy_clients", [
          { tenantId: 3047702, relationId: "rel_mais", name: "MAIS NEGOCIOS", active: true },
          { tenantId: 999, relationId: "rel_demo", name: "DEMO", active: true }
        ])
    });

    const result = await runInteractiveFlowTurn({
      request: "Emitir Novo Boleto de Serviço",
      registry,
      sessionId: "sess_contaazul",
      store: createInteractiveFlowStore()
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result).toMatchObject({
      status: "needs_input",
      toolName: "contaazul.interactive_service_sale_boleto",
      missingFields: ["tenantId"]
    });
    expect(result.result.choices).toEqual([
      {
        id: "tenant:3047702",
        label: "MAIS NEGOCIOS",
        description: "Tenant 3047702",
        params: {
          __interactive: { flow: "contaazul_service_sale_boleto", action: "select_tenant" },
          tenantId: 3047702,
          relationId: "rel_mais",
          tenantName: "MAIS NEGOCIOS"
        }
      },
      {
        id: "tenant:999",
        label: "DEMO",
        description: "Tenant 999",
        params: {
          __interactive: { flow: "contaazul_service_sale_boleto", action: "select_tenant" },
          tenantId: 999,
          relationId: "rel_demo",
          tenantName: "DEMO"
        }
      }
    ]);
  });

  it("preloads customers after the tenant selection", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    registerTenantTools(registry);
    registerSearchTools(registry);

    await runInteractiveFlowTurn({
      request: "Emitir Novo Boleto de Serviço",
      registry,
      sessionId: "sess_contaazul",
      store
    });

    const result = await runInteractiveFlowTurn({
      request: "MAIS NEGOCIOS",
      registry,
      sessionId: "sess_contaazul",
      store,
      params: {
        __interactive: { flow: "contaazul_service_sale_boleto", action: "select_tenant" },
        tenantId: 3047702,
        relationId: "rel_mais",
        tenantName: "MAIS NEGOCIOS"
      }
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result).toMatchObject({
      status: "needs_input",
      missingFields: ["customerId"],
      questions: ["Selecione o cliente para esta venda."]
    });
    expect(result.result.choices?.[0]).toMatchObject({
      id: "customer:cust_1",
      label: "AZUOS ASSESSORIA CONTÁBIL LTDA"
    });
  });

  it("switches to the selected Conta Azul Pro session before customer search", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    const calls: unknown[] = [];
    registry.register({
      name: "contaazul.list_accountancy_clients",
      description: "List tenants",
      parameters: z.object({}),
      execute: async () =>
        receipt("contaazul.list_accountancy_clients", [
          { tenantId: 3047702, relationId: "rel_mais", name: "MAIS NEGOCIOS", active: true }
        ])
    });
    registry.register({
      name: "contaazul.switch_to_pro_session",
      description: "Switch tenant",
      parameters: z.object({ relationId: z.string() }),
      execute: async (params) => {
        calls.push(params);
        return receipt("contaazul.switch_to_pro_session", {
          relationId: "rel_mais",
          proSessionId: "relation:rel_mais",
          authToken: "[REDACTED_SECRET]"
        });
      }
    });
    registerSearchTools(registry);

    await runInteractiveFlowTurn({
      request: "Emitir Novo Boleto de Serviço",
      registry,
      sessionId: "sess_contaazul",
      store
    });
    const result = await runInteractiveFlowTurn({
      request: "MAIS NEGOCIOS",
      registry,
      sessionId: "sess_contaazul",
      store,
      params: {
        __interactive: { flow: "contaazul_service_sale_boleto", action: "select_tenant" },
        tenantId: 3047702,
        relationId: "rel_mais",
        tenantName: "MAIS NEGOCIOS"
      }
    });

    expect(result.handled).toBe(true);
    expect(calls).toEqual([{ relationId: "rel_mais" }]);
  });

  it("preloads customer choices immediately after tenant selection", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    registerTenantTools(registry);
    registerSearchTools(registry);

    await startAndSelectTenant(store, registry);

    const result = await runInteractiveFlowTurn({
      request: "",
      registry,
      sessionId: "sess_contaazul",
      store
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result).toMatchObject({
      status: "needs_input",
      missingFields: ["customerId"],
      questions: ["Selecione o cliente para esta venda."]
    });
    expect(result.result.choices).toEqual([
      {
        id: "customer:cust_1",
        label: "AZUOS ASSESSORIA CONTÁBIL LTDA",
        description: "Cliente Conta Azul",
        params: {
          __interactive: { flow: "contaazul_service_sale_boleto", action: "select_customer" },
          customerId: "cust_1",
          customerName: "AZUOS ASSESSORIA CONTÁBIL LTDA"
        }
      }
    ]);
  });

  it("opens the sale form with category and item choices after customer selection", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    registerTenantTools(registry);
    registerSearchTools(registry);

    await startAndSelectTenant(store, registry);

    const afterCustomer = await runInteractiveFlowTurn({
      request: "AZUOS ASSESSORIA CONTÁBIL LTDA",
      registry,
      sessionId: "sess_contaazul",
      store,
      params: {
        __interactive: { flow: "contaazul_service_sale_boleto", action: "select_customer" },
        customerId: "cust_1",
        customerName: "AZUOS ASSESSORIA CONTÁBIL LTDA"
      }
    });
    expect(afterCustomer.handled).toBe(true);
    if (!afterCustomer.handled) throw new Error("expected handled result");
    expect(afterCustomer.result).toMatchObject({
      formId: "contaazul_service_sale_details",
      missingFields: [
        "categoryId",
        "itemId",
        "serviceDescription",
        "unitValueBr",
        "dueDateBr",
        "notification.phone",
        "notification.email",
        "notification.replyTo"
      ]
    });
    expect(afterCustomer.result.formChoices?.categoryId?.[0]).toMatchObject({
      id: "category:cat_1",
      label: "Honorário contábil mensal"
    });
    expect(afterCustomer.result.formChoices?.itemId?.[0]).toMatchObject({
      id: "item:item_1",
      label: "Honorário Contábil"
    });
  });

  it("collects sale fields via inline form and then plans the workflow dry-run", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    const calls: unknown[] = [];
    registerTenantTools(registry);
    registerSearchTools(registry);
    registry.register({
      name: "contaazul.create_service_sale_boleto_workflow",
      description: "Workflow",
      parameters: z.object({}).passthrough(),
      execute: async (params) => {
        calls.push(params);
        return {
          ...receipt("contaazul.create_service_sale_boleto_workflow", {
            approvalPreview: { operationId: "op_interactive_plan" }
          }),
          status: "planned"
        } satisfies ToolReceipt;
      }
    });

    await reachSaleForm(store, registry);

    const planned = await runInteractiveFlowTurn({
      request: "Preparar cobrança",
      registry,
      sessionId: "sess_contaazul",
      store,
      params: {
        __interactive: { flow: "contaazul_service_sale_boleto", action: "submit_sale_details" },
        categoryId: "cat_1",
        itemId: "item_1",
        serviceDescription: "Honorário mensal",
        unitValueBr: "10,00",
        dueDateBr: "30/06/2026",
        "notification.phone": "62991514384",
        "notification.email": "kamilly.agregarnegocios@gmail.com",
        "notification.replyTo": "sccontabilidadefinanceiro@gmail.com"
      }
    });
    expect(planned.handled).toBe(true);
    if (!planned.handled) throw new Error("expected handled result");
    expect(planned.draftOperationId).toBe("op_interactive_plan");
    expect(planned.result).toMatchObject({
      status: "executed",
      toolName: "contaazul.create_service_sale_boleto_workflow",
      operationId: "op_interactive_plan",
      receiptStatus: "planned",
      approvalAvailable: true
    });
    expect(calls).toEqual([
      {
        tenantId: 3047702,
        customerName: "AZUOS ASSESSORIA CONTÁBIL LTDA",
        categoryName: "Honorário contábil mensal",
        itemName: "Honorário Contábil",
        serviceDescription: "Honorário mensal",
        unitValueBr: "10,00",
        dueDateBr: "30/06/2026",
        notification: {
          phone: "62991514384",
          email: "kamilly.agregarnegocios@gmail.com",
          replyTo: "sccontabilidadefinanceiro@gmail.com"
        }
      }
    ]);
  });

  it("keeps the sale form open when the due date is invalid", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    registerTenantTools(registry);
    registerSearchTools(registry);
    await reachSaleForm(store, registry);

    const result = await runInteractiveFlowTurn({
      request: "Preparar cobrança",
      registry,
      sessionId: "sess_contaazul",
      store,
      params: {
        __interactive: { flow: "contaazul_service_sale_boleto", action: "submit_sale_details" },
        categoryId: "cat_1",
        itemId: "item_1",
        serviceDescription: "Honorário mensal",
        unitValueBr: "10,00",
        dueDateBr: "2026-06-30",
        "notification.phone": "62991514384",
        "notification.email": "kamilly.agregarnegocios@gmail.com"
      }
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result).toMatchObject({
      formId: "contaazul_service_sale_details",
      summary: expect.stringContaining("vencimento")
    });
  });

  it("returns an empty customer list when no Conta Azul customers exist", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    registerTenantTools(registry);
    registry.register({
      name: "contaazul.search_sale_customers",
      description: "Search customers",
      parameters: z.object({ relationId: z.string(), listAll: z.boolean().optional() }),
      execute: async () => receipt("contaazul.search_sale_customers", [])
    });

    await startAndSelectTenant(store, registry);

    const result = await runInteractiveFlowTurn({
      request: "",
      registry,
      sessionId: "sess_contaazul",
      store
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result).toMatchObject({
      status: "needs_input",
      missingFields: ["customerId"],
      questions: ["Nenhum cliente cadastrado. Use a opção para criar um novo."]
    });
    expect(result.result.choices ?? []).toEqual([]);
  });

  it("starts the Conta Azul service-sale flow from the anchor marker", async () => {
    const registry = createToolRegistry();
    registerTenantTools(registry);
    const result = await runInteractiveFlowTurn({
      request: "começar agora",
      registry,
      sessionId: "sess_anchor",
      store: createInteractiveFlowStore(),
      params: { __interactive: { flow: "anchor", action: "start_contaazul_service_sale" } }
    });
    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result).toMatchObject({ missingFields: ["tenantId"] });
  });

  it("runs the Asaas update-due-date flow from anchor through dry-run", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    const calls: unknown[] = [];
    registry.register({
      name: "asaas.search_customers",
      description: "Search Asaas customers",
      parameters: z.object({ query: z.string() }),
      execute: async () => receipt("asaas.search_customers", [{ id: "ac_1", name: "JOÃO LTDA" }])
    });
    registry.register({
      name: "asaas.list_pending_charges",
      description: "List pending charges",
      parameters: z.object({ customerId: z.string() }),
      execute: async () =>
        receipt("asaas.list_pending_charges", [
          { id: "ch_1", customerId: "ac_1", valueBr: "150,00", dueDateBr: "10/06/2026", status: "PENDING", description: "Mensalidade" }
        ])
    });
    registry.register({
      name: "asaas.update_charge_due_date",
      description: "Update charge due date",
      parameters: z.object({}).passthrough(),
      execute: async (params) => {
        calls.push(params);
        return {
          ...receipt("asaas.update_charge_due_date", { approvalPreview: { operationId: "op_asaas_update" } }),
          status: "planned"
        } satisfies ToolReceipt;
      }
    });

    const start = await runInteractiveFlowTurn({
      request: "começar",
      registry, sessionId: "sess_au", store,
      params: { __interactive: { flow: "anchor", action: "start_asaas_update_due_date" } }
    });
    expect(start.handled).toBe(true);
    if (!start.handled) throw new Error("expected handled result");
    expect(start.result).toMatchObject({
      formId: "asaas_update_due_date",
      missingFields: ["customerId", "chargeIds", "dueDateBr"]
    });

    const withCharges = await runInteractiveFlowTurn({
      request: "",
      registry,
      sessionId: "sess_au",
      store,
      params: {
        __interactive: { flow: "asaas_update_charge_due_date", action: "load_asaas_charges" },
        customerId: "ac_1",
        customerName: "JOÃO LTDA"
      }
    });
    expect(withCharges.handled).toBe(true);
    if (!withCharges.handled) throw new Error("expected handled result");
    expect(withCharges.result.formChoices?.chargeId?.[0]).toMatchObject({
      id: "asaas-charge:ch_1",
      label: "Mensalidade"
    });

    const planned = await runInteractiveFlowTurn({
      request: "Preparar alteração",
      registry,
      sessionId: "sess_au",
      store,
      params: {
        __interactive: { flow: "asaas_update_charge_due_date", action: "submit_asaas_update_details" },
        customerId: "ac_1",
        chargeIds: ["ch_1"],
        dueDateBr: "20/07/2026"
      }
    });
    expect(planned.handled).toBe(true);
    if (!planned.handled) throw new Error("expected handled result");
    expect(planned.draftOperationId).toBe("op_asaas_update");
    expect(planned.draft).toMatchObject({
      operationId: "op_asaas_update",
      toolName: "asaas.update_charge_due_date",
      params: { chargeId: "ch_1", dueDateBr: "20/07/2026" }
    });
    expect(planned.result).toMatchObject({ status: "executed", receiptStatus: "planned", approvalAvailable: true });
    expect(calls).toEqual([{ chargeId: "ch_1", dueDateBr: "20/07/2026" }]);

    calls.length = 0;
    const multiPlanned = await runInteractiveFlowTurn({
      request: "Preparar alteração",
      registry,
      sessionId: "sess_au_multi",
      store: createInteractiveFlowStore(),
      params: {
        __interactive: { flow: "asaas_update_charge_due_date", action: "submit_asaas_update_details" },
        customerId: "ac_1",
        chargeIds: ["ch_1", "ch_2"],
        dueDateBr: "20/07/2026"
      }
    });
    expect(multiPlanned.handled).toBe(true);
    if (!multiPlanned.handled) throw new Error("expected handled result");
    expect(multiPlanned.result.summary).toContain("2 alterações preparadas");
    expect(calls).toEqual([
      { chargeId: "ch_1", dueDateBr: "20/07/2026" },
      { chargeId: "ch_2", dueDateBr: "20/07/2026" }
    ]);
    expect(multiPlanned.drafts).toHaveLength(2);
    expect(multiPlanned.drafts?.[0]?.params).toMatchObject({ chargeId: "ch_1", dueDateBr: "20/07/2026" });
    expect(multiPlanned.drafts?.[1]?.params).toMatchObject({ chargeId: "ch_2", dueDateBr: "20/07/2026" });
  });

  it("runs the Asaas download-boleto flow from anchor through PDF download", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    registry.register({
      name: "asaas.search_customers",
      description: "Search Asaas customers",
      parameters: z.object({ query: z.string() }),
      execute: async () => receipt("asaas.search_customers", [{ id: "ac_1", name: "JOÃO LTDA" }])
    });
    registry.register({
      name: "asaas.list_charges",
      description: "List all charges",
      parameters: z.object({}).passthrough(),
      execute: async () =>
        receipt("asaas.list_charges", [
          {
            id: "ch_1",
            customerId: "ac_1",
            valueBr: "150,00",
            dueDateBr: "10/06/2026",
            status: "Recebida",
            description: "Mensalidade"
          },
          {
            id: "ch_2",
            customerId: "ac_1",
            valueBr: "80,00",
            dueDateBr: "20/07/2026",
            status: "Aguardando pagamento",
            description: "Taxa extra"
          }
        ])
    });
    registry.register({
      name: "asaas.get_charge_links",
      description: "Get charge links",
      parameters: z.object({ chargeId: z.string() }),
      execute: async () =>
        receipt("asaas.get_charge_links", {
          chargeId: "ch_1",
          externalToken: "tok_test_123",
          boletoUrl: "https://www.asaas.com/b/pdf/tok_test_123"
        })
    });
    registry.register({
      name: "asaas.download_boleto_pdf",
      description: "Download boleto pdf",
      parameters: z.object({}).passthrough(),
      execute: async () =>
        ({
          ...receipt("asaas.download_boleto_pdf", { plannedRequest: { method: "GET" } }),
          status: "succeeded",
          summary: "PDF do boleto baixado do Asaas.",
          artifacts: [
            {
              kind: "pdf",
              path: "C:/tmp/Mensalidade.pdf",
              label: "boleto pdf"
            }
          ]
        }) satisfies ToolReceipt
    });

    const start = await runInteractiveFlowTurn({
      request: "começar",
      registry,
      sessionId: "sess_dl",
      store,
      params: { __interactive: { flow: "anchor", action: "start_asaas_download_boleto" } }
    });
    expect(start.handled).toBe(true);
    if (!start.handled) throw new Error("expected handled result");
    expect(start.result).toMatchObject({
      formId: "asaas_download_boleto",
      missingFields: ["customerId", "chargeId"]
    });

    const withCharges = await runInteractiveFlowTurn({
      request: "",
      registry,
      sessionId: "sess_dl",
      store,
      params: {
        __interactive: { flow: "asaas_download_boleto", action: "load_asaas_charges" },
        customerId: "ac_1",
        customerName: "JOÃO LTDA"
      }
    });
    expect(withCharges.handled).toBe(true);
    if (!withCharges.handled) throw new Error("expected handled result");
    expect(withCharges.result.formChoices?.chargeId).toHaveLength(2);

    const downloaded = await runInteractiveFlowTurn({
      request: "Baixar PDF",
      registry,
      sessionId: "sess_dl",
      store,
      params: {
        __interactive: { flow: "asaas_download_boleto", action: "submit_asaas_download_boleto" },
        customerId: "ac_1",
        chargeId: "ch_1"
      }
    });
    expect(downloaded.handled).toBe(true);
    if (!downloaded.handled) throw new Error("expected handled result");
    expect(downloaded.result).toMatchObject({
      status: "executed",
      toolName: "asaas.download_boleto_pdf",
      receiptStatus: "succeeded",
      summary: "PDF do boleto baixado com sucesso."
    });
    expect((downloaded.result.receiptData as { artifacts?: unknown[] })?.artifacts).toHaveLength(1);
  });

  it("collects a Física customer and plans the create-customer workflow", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    const calls: unknown[] = [];
    registerTenantTools(registry);
    registry.register({
      name: "contaazul.create_customer_workflow",
      description: "Create customer workflow",
      parameters: z.object({}).passthrough(),
      execute: async (params) => {
        calls.push(params);
        return { ...receipt("contaazul.create_customer_workflow", { approvalPreview: { operationId: "op_cust" }, resolved: { customerId: "new_cust", customerName: "MARIA SILVA" } }), status: "planned" } satisfies ToolReceipt;
      }
    });

    await runInteractiveFlowTurn({ request: "começar", registry, sessionId: "sess_cc", store, params: { __interactive: { flow: "anchor", action: "start_contaazul_create_customer" } } });
    await runInteractiveFlowTurn({ request: "MAIS NEGOCIOS", registry, sessionId: "sess_cc", store, params: { __interactive: { flow: "contaazul_create_customer", action: "select_tenant" }, tenantId: 3047702, relationId: "rel_mais", tenantName: "MAIS NEGOCIOS" } });

    const docPrompt = await runInteractiveFlowTurn({ request: "Física", registry, sessionId: "sess_cc", store, params: { __interactive: { flow: "contaazul_create_customer", action: "select_person_type" }, personType: "Física" } });
    expect(docPrompt.handled).toBe(true);
    if (!docPrompt.handled) throw new Error("expected handled result");
    expect(docPrompt.result).toMatchObject({ missingFields: ["document"] });

    // CUSTOMER_FIELDS order for Física (companyName excluded):
    // document, name, email, cellPhone, commercialPhone, zipcode, street,
    // numberAddress, neighborhood, complement, billingEmail, billingPhone
    const seq = ["123.456.789-00", "MARIA SILVA", "maria@example.com", "62999990000", "pular", "74000000", "Rua A", "100", "Centro", "pular", "maria@example.com", "62999990000"];
    let last;
    for (const value of seq) {
      last = await runInteractiveFlowTurn({ request: value, registry, sessionId: "sess_cc", store });
    }
    expect(last!.handled).toBe(true);
    if (!last!.handled) throw new Error("expected handled result");
    expect(last!.draftOperationId).toBe("op_cust");
    expect(calls[0]).toMatchObject({ tenantId: 3047702, personType: "Física", document: "123.456.789-00", name: "MARIA SILVA", billingEmail: "maria@example.com", billingPhone: "62999990000" });
  });
  it("runs the Conta Azul update-due-date flow through dry-run", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    const calls: unknown[] = [];
    registerTenantTools(registry);
    registry.register({
      name: "contaazul.search_financial_statement",
      description: "Search statement",
      parameters: z.object({ relationId: z.string(), query: z.string().optional() }),
      execute: async () =>
        receipt("contaazul.search_financial_statement", [
          { id: "inst_1", financialEventId: "fe_1", installmentId: "inst_1", description: "Mensalidade junho", value: 150, dueDateIso: "2026-06-10", customerName: "JOÃO LTDA", status: "PENDING" }
        ])
    });
    registry.register({
      name: "contaazul.update_due_date_reissue_boleto_workflow",
      description: "Update due date workflow",
      parameters: z.object({}).passthrough(),
      execute: async (params) => {
        calls.push(params);
        return { ...receipt("contaazul.update_due_date_reissue_boleto_workflow", { approvalPreview: { operationId: "op_ca_update" } }), status: "planned" } satisfies ToolReceipt;
      }
    });

    await runInteractiveFlowTurn({
      request: "começar", registry, sessionId: "sess_cu", store,
      params: { __interactive: { flow: "anchor", action: "start_contaazul_update_due_date" } }
    });
    const choices = await runInteractiveFlowTurn({
      request: "MAIS NEGOCIOS", registry, sessionId: "sess_cu", store,
      params: { __interactive: { flow: "contaazul_update_due_date", action: "select_tenant" }, tenantId: 3047702, relationId: "rel_mais", tenantName: "MAIS NEGOCIOS" }
    });
    expect(choices.handled).toBe(true);
    if (!choices.handled) throw new Error("expected handled result");
    expect(choices.result.choices?.[0]).toMatchObject({
      id: "statement:inst_1",
      params: { __interactive: { flow: "contaazul_update_due_date", action: "select_statement" }, financialEventId: "fe_1", installmentId: "inst_1" }
    });
    const askDate = await runInteractiveFlowTurn({
      request: "Mensalidade junho", registry, sessionId: "sess_cu", store,
      params: { __interactive: { flow: "contaazul_update_due_date", action: "select_statement" }, financialEventId: "fe_1", installmentId: "inst_1" }
    });
    expect(askDate.handled).toBe(true);
    if (!askDate.handled) throw new Error("expected handled result");
    expect(askDate.result).toMatchObject({ missingFields: ["dueDateBr"] });
    const planned = await runInteractiveFlowTurn({ request: "20/07/2026", registry, sessionId: "sess_cu", store });
    expect(planned.handled).toBe(true);
    if (!planned.handled) throw new Error("expected handled result");
    expect(planned.draftOperationId).toBe("op_ca_update");
    expect(calls).toEqual([{ tenantId: 3047702, financialEventId: "fe_1", installmentId: "inst_1", dueDateIso: "2026-07-20" }]);
  });

  it("opens the boleto flow at the sale form when pre-seeded with a customer", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    registerTenantTools(registry);
    registerSearchTools(registry);
    const result = await runInteractiveFlowTurn({
      request: "Emitir boleto de serviço",
      registry, sessionId: "sess_seed", store,
      params: { __interactive: { flow: "contaazul_service_sale_boleto", action: "start_with_customer" }, tenantId: 3047702, relationId: "rel_mais", customerId: "new_cust", customerName: "MARIA SILVA" }
    });
    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result).toMatchObject({
      formId: "contaazul_service_sale_details",
      missingFields: expect.arrayContaining(["categoryId", "itemId"])
    });
  });

  it("roteia 'cadastrar cliente' por linguagem natural para o fluxo de cadastro", async () => {
    const registry = createToolRegistry();
    registerTenantTools(registry);

    const result = await runInteractiveFlowTurn({
      request: "quero cadastrar um novo cliente",
      registry,
      sessionId: "sess_nl_customer",
      store: createInteractiveFlowStore()
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result.missingFields).toContain("tenantId");
    expect(result.result.choices?.[0]?.params).toMatchObject({
      __interactive: { flow: "contaazul_create_customer", action: "select_tenant" }
    });
  });

  it("roteia consulta de boletos por linguagem natural para a lista de lançamentos", async () => {
    const registry = createToolRegistry();
    registerTenantTools(registry);

    const result = await runInteractiveFlowTurn({
      request: "me entregue todos os boletos do cliente AZUOS",
      registry,
      sessionId: "sess_nl_list",
      store: createInteractiveFlowStore()
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result.choices?.[0]?.params).toMatchObject({
      __interactive: { flow: "contaazul_list_charges", action: "select_tenant" }
    });
  });

  it("entrega os boletos filtrados por cliente/vencidos após escolher a empresa", async () => {
    const registry = createToolRegistry();
    registerTenantTools(registry);
    registry.register({
      name: "contaazul.search_financial_statement",
      description: "Statement",
      parameters: z.object({ relationId: z.string() }),
      execute: async () =>
        receipt("contaazul.search_financial_statement", [
          { id: "1", financialEventId: "fe1", description: "Honorário", value: 250, dueDateIso: "2026-06-30", customerName: "AZUOS ASSESSORIA", status: "PENDING" },
          { id: "2", financialEventId: "fe2", description: "Outro", value: 90, dueDateIso: "2026-06-30", customerName: "OUTRA EMPRESA", status: "PENDING" }
        ])
    });
    const store = createInteractiveFlowStore();
    const sessionId = "sess_nl_list_deliver";

    await runInteractiveFlowTurn({
      request: "me entregue os boletos do cliente AZUOS",
      registry,
      sessionId,
      store
    });

    const delivered = await runInteractiveFlowTurn({
      request: "MAIS NEGOCIOS",
      registry,
      sessionId,
      store,
      params: {
        __interactive: { flow: "contaazul_list_charges", action: "select_tenant" },
        tenantId: 3047702,
        relationId: "rel_mais",
        tenantName: "MAIS NEGOCIOS"
      }
    });

    expect(delivered.handled).toBe(true);
    if (!delivered.handled) throw new Error("expected handled result");
    expect(delivered.result.toolName).toBe("contaazul.search_financial_statement");
    // Só o boleto da AZUOS deve sobrar (filtrado pelo cliente citado).
    expect(Array.isArray(delivered.result.receiptData)).toBe(true);
    const rows = delivered.result.receiptData as Array<{ customerName?: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customerName).toBe("AZUOS ASSESSORIA");
  });

  it("auto-seleciona o cliente citado em linguagem natural (slot-filling)", async () => {
    const registry = createToolRegistry();
    registerTenantTools(registry);
    registerSearchTools(registry);
    const store = createInteractiveFlowStore();
    const sessionId = "sess_nl_autoselect";

    const start = await runInteractiveFlowTurn({
      request: "emite um boleto pra AZUOS na conta azul vencendo 30/06",
      registry,
      sessionId,
      store
    });
    expect(start.handled).toBe(true);
    if (!start.handled) throw new Error("expected handled result");
    expect(start.result.choices?.[0]?.params).toMatchObject({
      __interactive: { flow: "contaazul_service_sale_boleto", action: "select_tenant" }
    });

    const afterTenant = await runInteractiveFlowTurn({
      request: "MAIS NEGOCIOS",
      registry,
      sessionId,
      store,
      params: {
        __interactive: { flow: "contaazul_service_sale_boleto", action: "select_tenant" },
        tenantId: 3047702,
        relationId: "rel_mais",
        tenantName: "MAIS NEGOCIOS"
      }
    });
    expect(afterTenant.handled).toBe(true);
    if (!afterTenant.handled) throw new Error("expected handled result");
    // Cliente AZUOS foi resolvido sozinho (1 correspondência) → já pede categoria.
    expect(afterTenant.result.missingFields).toContain("categoryId");
    expect(afterTenant.result.summary ?? "").toContain("AZUOS");
  });

  it("coloca a empresa lembrada no topo da escolha (memória)", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "contaazul.list_accountancy_clients",
      description: "List tenants",
      parameters: z.object({}),
      execute: async () =>
        receipt("contaazul.list_accountancy_clients", [
          { tenantId: 101, relationId: "rel_a", name: "EMPRESA A", active: true },
          { tenantId: 202, relationId: "rel_b", name: "EMPRESA B", active: true }
        ])
    });
    const memory = createInMemoryPreferencesStore({
      lastTenant: { tenantId: 202, relationId: "rel_b", tenantName: "EMPRESA B" }
    });

    const result = await runInteractiveFlowTurn({
      request: "quero cadastrar um novo cliente",
      registry,
      sessionId: "sess_mem",
      store: createInteractiveFlowStore(),
      memory
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result.choices?.[0]?.label).toBe("EMPRESA B");
    expect(result.result.choices?.[0]?.description).toBe("Usada recentemente");
  });

  it("registra a empresa selecionada na memória", async () => {
    const registry = createToolRegistry();
    registerTenantTools(registry);
    registerSearchTools(registry);
    const memory = createInMemoryPreferencesStore();
    const store = createInteractiveFlowStore();
    const sessionId = "sess_mem_record";

    await runInteractiveFlowTurn({ request: "criar cliente", registry, sessionId, store, memory });
    await runInteractiveFlowTurn({
      request: "MAIS NEGOCIOS",
      registry,
      sessionId,
      store,
      memory,
      params: {
        __interactive: { flow: "contaazul_create_customer", action: "select_tenant" },
        tenantId: 3047702,
        relationId: "rel_mais",
        tenantName: "MAIS NEGOCIOS"
      }
    });

    expect(memory.get().lastTenant?.tenantId).toBe(3047702);
  });
});

function registerTenantTools(registry: ReturnType<typeof createToolRegistry>): void {
  registry.register({
    name: "contaazul.list_accountancy_clients",
    description: "List tenants",
    parameters: z.object({}),
    execute: async () =>
      receipt("contaazul.list_accountancy_clients", [
        { tenantId: 3047702, relationId: "rel_mais", name: "MAIS NEGOCIOS", active: true }
      ])
  });
  registry.register({
    name: "contaazul.switch_to_pro_session",
    description: "Switch tenant",
    parameters: z.object({ relationId: z.string() }),
    execute: async () =>
      receipt("contaazul.switch_to_pro_session", {
        relationId: "rel_mais",
        proSessionId: "relation:rel_mais",
        authToken: "[REDACTED_SECRET]"
      })
  });
}

function registerSearchTools(registry: ReturnType<typeof createToolRegistry>): void {
  registry.register({
    name: "contaazul.search_sale_customers",
    description: "Search customers",
    parameters: z.object({
      relationId: z.string(),
      searchTerm: z.string().optional(),
      listAll: z.boolean().optional()
    }),
    execute: async () =>
      receipt("contaazul.search_sale_customers", [
        { id: "cust_1", name: "AZUOS ASSESSORIA CONTÁBIL LTDA" }
      ])
  });
  registry.register({
    name: "contaazul.search_financial_categories",
    description: "Search categories",
    parameters: z.object({
      relationId: z.string(),
      searchTerm: z.string().optional(),
      listAll: z.boolean().optional()
    }),
    execute: async () =>
      receipt("contaazul.search_financial_categories", [
        { uuid: "cat_1", dsNaturezaFinanceira: "Honorário contábil mensal" }
      ])
  });
  registry.register({
    name: "contaazul.search_service_items",
    description: "Search items",
    parameters: z.object({
      relationId: z.string(),
      searchTerm: z.string().optional(),
      listAll: z.boolean().optional()
    }),
    execute: async () =>
      receipt("contaazul.search_service_items", [
        { id: "item_1", name: "Honorário Contábil" }
      ])
  });
}

async function startAndSelectTenant(
  store: ReturnType<typeof createInteractiveFlowStore>,
  registry: ReturnType<typeof createToolRegistry>
): Promise<void> {
  await runInteractiveFlowTurn({
    request: "Emitir Novo Boleto de Serviço",
    registry,
    sessionId: "sess_contaazul",
    store
  });
  await runInteractiveFlowTurn({
    request: "MAIS NEGOCIOS",
    registry,
    sessionId: "sess_contaazul",
    store,
    params: {
      __interactive: { flow: "contaazul_service_sale_boleto", action: "select_tenant" },
      tenantId: 3047702,
      relationId: "rel_mais",
      tenantName: "MAIS NEGOCIOS"
    }
  });
}

async function reachSaleForm(
  store: ReturnType<typeof createInteractiveFlowStore>,
  registry: ReturnType<typeof createToolRegistry>
): Promise<void> {
  await startAndSelectTenant(store, registry);
  await runInteractiveFlowTurn({
    request: "AZUOS ASSESSORIA CONTÁBIL LTDA",
    registry,
    sessionId: "sess_contaazul",
    store,
    params: {
      __interactive: { flow: "contaazul_service_sale_boleto", action: "select_customer" },
      customerId: "cust_1",
      customerName: "AZUOS ASSESSORIA CONTÁBIL LTDA"
    }
  });
}

function receipt<T>(toolName: string, data: T): ToolReceipt<T> {
  return {
    operationId: `op_${toolName.replace(/[^a-z0-9]+/gi, "_")}`,
    provider: toolName.startsWith("asaas.") ? "asaas" : "contaazul",
    toolName,
    status: "succeeded",
    dryRun: true,
    summary: "ok",
    data,
    artifacts: [],
    warnings: []
  };
}
