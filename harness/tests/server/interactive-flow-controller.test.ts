import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createInteractiveFlowStore,
  runInteractiveFlowTurn
} from "../../src/server/interactive-flow-controller.js";
import { createToolRegistry } from "../../src/core/tool-registry.js";
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
      missingFields: ["customerSearch"]
    });

    const customers = await runInteractiveFlowTurn({
      request: "AZUOS",
      registry,
      sessionId: "sess_asaas",
      store
    });
    expect(customers.handled).toBe(true);
    if (!customers.handled) throw new Error("expected handled result");
    expect(customers.result.choices).toEqual([
      {
        id: "asaas-customer:asaas_cust_1",
        label: "AZUOS ASSESSORIA CONTÁBIL LTDA",
        description: "Cliente Asaas",
        params: {
          __interactive: { flow: "asaas_boleto_charge", action: "select_customer" },
          customerId: "asaas_cust_1",
          customerName: "AZUOS ASSESSORIA CONTÁBIL LTDA"
        }
      },
      {
        id: "asaas-customer:asaas_cust_2",
        label: "AZUOS SERVICOS LTDA",
        description: "Cliente Asaas",
        params: {
          __interactive: { flow: "asaas_boleto_charge", action: "select_customer" },
          customerId: "asaas_cust_2",
          customerName: "AZUOS SERVICOS LTDA"
        }
      }
    ]);

    const valuePrompt = await runInteractiveFlowTurn({
      request: "AZUOS ASSESSORIA CONTÁBIL LTDA",
      registry,
      sessionId: "sess_asaas",
      store,
      params: {
        __interactive: { flow: "asaas_boleto_charge", action: "select_customer" },
        customerId: "asaas_cust_1",
        customerName: "AZUOS ASSESSORIA CONTÁBIL LTDA"
      }
    });
    expect(valuePrompt.handled).toBe(true);
    if (!valuePrompt.handled) throw new Error("expected handled result");
    expect(valuePrompt.result).toMatchObject({
      missingFields: ["valueBr"],
      questions: ["Digite o valor da cobrança (ex: 10,00)."]
    });

    await runInteractiveFlowTurn({
      request: "10,00",
      registry,
      sessionId: "sess_asaas",
      store
    });
    await runInteractiveFlowTurn({
      request: "30/06/2026",
      registry,
      sessionId: "sess_asaas",
      store
    });
    const planned = await runInteractiveFlowTurn({
      request: "Honorário mensal",
      registry,
      sessionId: "sess_asaas",
      store
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

  it("uses a structured tenant selection before asking for the customer search term", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    registerTenantTools(registry);

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
      missingFields: ["customerSearch"],
      questions: ["Digite o nome do cliente para pesquisa."]
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

  it("searches customers after the tenant selection and shows candidate choices", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    registerTenantTools(registry);
    registry.register({
      name: "contaazul.search_sale_customers",
      description: "Search customers",
      parameters: z.object({
        relationId: z.string(),
        searchTerm: z.string()
      }),
      execute: async () =>
        receipt("contaazul.search_sale_customers", [
          { id: "cust_1", name: "AZUOS ASSESSORIA CONTÁBIL LTDA" },
          { id: "cust_2", name: "AZUOS SERVICOS LTDA" }
        ])
    });

    await startAndSelectTenant(store, registry);

    const result = await runInteractiveFlowTurn({
      request: "AZUOS",
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
      },
      {
        id: "customer:cust_2",
        label: "AZUOS SERVICOS LTDA",
        description: "Cliente Conta Azul",
        params: {
          __interactive: { flow: "contaazul_service_sale_boleto", action: "select_customer" },
          customerId: "cust_2",
          customerName: "AZUOS SERVICOS LTDA"
        }
      }
    ]);
  });

  it("moves through customer, category, and item choices before asking item details", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    registerTenantTools(registry);
    registerSearchTools(registry);

    await startAndSelectTenant(store, registry);
    await runInteractiveFlowTurn({
      request: "AZUOS",
      registry,
      sessionId: "sess_contaazul",
      store
    });

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
      missingFields: ["categorySearch"],
      questions: ["Digite o nome da categoria financeira."]
    });

    const categorySearch = await runInteractiveFlowTurn({
      request: "Honorário contábil mensal",
      registry,
      sessionId: "sess_contaazul",
      store
    });
    expect(categorySearch.handled).toBe(true);
    if (!categorySearch.handled) throw new Error("expected handled result");
    expect(categorySearch.result.choices?.[0]).toMatchObject({
      id: "category:cat_1",
      label: "Honorário contábil mensal"
    });

    const afterCategory = await runInteractiveFlowTurn({
      request: "Honorário contábil mensal",
      registry,
      sessionId: "sess_contaazul",
      store,
      params: {
        __interactive: { flow: "contaazul_service_sale_boleto", action: "select_category" },
        categoryId: "cat_1",
        categoryName: "Honorário contábil mensal"
      }
    });
    expect(afterCategory.handled).toBe(true);
    if (!afterCategory.handled) throw new Error("expected handled result");
    expect(afterCategory.result).toMatchObject({
      missingFields: ["itemSearch"],
      questions: ["Digite o nome do item de serviço."]
    });

    const itemSearch = await runInteractiveFlowTurn({
      request: "Honorário Contábil",
      registry,
      sessionId: "sess_contaazul",
      store
    });
    expect(itemSearch.handled).toBe(true);
    if (!itemSearch.handled) throw new Error("expected handled result");
    expect(itemSearch.result.choices?.[0]).toMatchObject({
      id: "item:item_1",
      label: "Honorário Contábil"
    });

    const afterItem = await runInteractiveFlowTurn({
      request: "Honorário Contábil",
      registry,
      sessionId: "sess_contaazul",
      store,
      params: {
        __interactive: { flow: "contaazul_service_sale_boleto", action: "select_item" },
        itemId: "item_1",
        itemName: "Honorário Contábil"
      }
    });
    expect(afterItem.handled).toBe(true);
    if (!afterItem.handled) throw new Error("expected handled result");
    expect(afterItem.result).toMatchObject({
      missingFields: ["serviceDescription"],
      questions: ["Digite os detalhes do item."]
    });
  });

  it("collects final sale fields one by one and then plans the workflow dry-run", async () => {
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

    await reachItemSelection(store, registry);

    const unitValuePrompt = await runInteractiveFlowTurn({
      request: "Honorário mensal",
      registry,
      sessionId: "sess_contaazul",
      store
    });
    expect(unitValuePrompt.handled).toBe(true);
    if (!unitValuePrompt.handled) throw new Error("expected handled result");
    expect(unitValuePrompt.result).toMatchObject({
      missingFields: ["unitValueBr"],
      questions: ["Digite o valor unitário (ex: 10,00)."]
    });

    const dueDatePrompt = await runInteractiveFlowTurn({
      request: "10,00",
      registry,
      sessionId: "sess_contaazul",
      store
    });
    expect(dueDatePrompt.handled).toBe(true);
    if (!dueDatePrompt.handled) throw new Error("expected handled result");
    expect(dueDatePrompt.result).toMatchObject({
      missingFields: ["dueDateBr"],
      questions: ["Digite a data de vencimento (DD/MM/AAAA)."]
    });

    const phonePrompt = await runInteractiveFlowTurn({
      request: "30/06/2026",
      registry,
      sessionId: "sess_contaazul",
      store
    });
    expect(phonePrompt.handled).toBe(true);
    if (!phonePrompt.handled) throw new Error("expected handled result");
    expect(phonePrompt.result).toMatchObject({
      missingFields: ["notification.phone"],
      questions: ["Digite o telefone celular do cliente com DDD."]
    });

    const emailPrompt = await runInteractiveFlowTurn({
      request: "62991514384",
      registry,
      sessionId: "sess_contaazul",
      store
    });
    expect(emailPrompt.handled).toBe(true);
    if (!emailPrompt.handled) throw new Error("expected handled result");
    expect(emailPrompt.result).toMatchObject({
      missingFields: ["notification.email"],
      questions: ["Digite o e-mail de cobrança do cliente."]
    });

    const replyToPrompt = await runInteractiveFlowTurn({
      request: "kamilly.agregarnegocios@gmail.com",
      registry,
      sessionId: "sess_contaazul",
      store
    });
    expect(replyToPrompt.handled).toBe(true);
    if (!replyToPrompt.handled) throw new Error("expected handled result");
    expect(replyToPrompt.result).toMatchObject({
      missingFields: ["notification.replyTo"],
      questions: ["Digite o e-mail para o destinatário entrar em contato."]
    });

    const planned = await runInteractiveFlowTurn({
      request: "sccontabilidadefinanceiro@gmail.com",
      registry,
      sessionId: "sess_contaazul",
      store
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

  it("keeps asking for due date when the typed date is invalid", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    registerTenantTools(registry);
    registerSearchTools(registry);
    await reachItemSelection(store, registry);
    await runInteractiveFlowTurn({
      request: "Honorário mensal",
      registry,
      sessionId: "sess_contaazul",
      store
    });
    await runInteractiveFlowTurn({
      request: "10,00",
      registry,
      sessionId: "sess_contaazul",
      store
    });

    const result = await runInteractiveFlowTurn({
      request: "2026-06-30",
      registry,
      sessionId: "sess_contaazul",
      store
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result).toMatchObject({
      missingFields: ["dueDateBr"],
      questions: ["Digite a data de vencimento no formato DD/MM/AAAA."]
    });
  });

  it("re-prompts the customer search when no Conta Azul customer matches", async () => {
    const store = createInteractiveFlowStore();
    const registry = createToolRegistry();
    registerTenantTools(registry);
    registry.register({
      name: "contaazul.search_sale_customers",
      description: "Search customers",
      parameters: z.object({ relationId: z.string(), searchTerm: z.string() }),
      execute: async () => receipt("contaazul.search_sale_customers", [])
    });

    await startAndSelectTenant(store, registry);

    const result = await runInteractiveFlowTurn({
      request: "Irani",
      registry,
      sessionId: "sess_contaazul",
      store
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error("expected handled result");
    expect(result.result).toMatchObject({
      status: "needs_input",
      missingFields: ["customerSearch"],
      questions: ['Não encontrei ninguém com "Irani". Tente outro nome.']
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

    await runInteractiveFlowTurn({
      request: "começar",
      registry, sessionId: "sess_au", store,
      params: { __interactive: { flow: "anchor", action: "start_asaas_update_due_date" } }
    });

    const charges = await runInteractiveFlowTurn({ request: "JOÃO", registry, sessionId: "sess_au", store });
    expect(charges.handled).toBe(true);
    if (!charges.handled) throw new Error("expected handled result");
    expect(charges.result.choices?.[0]).toMatchObject({
      id: "asaas-charge:ch_1",
      label: "Mensalidade",
      params: {
        __interactive: { flow: "asaas_update_charge_due_date", action: "select_charge" },
        chargeId: "ch_1"
      }
    });

    const askDate = await runInteractiveFlowTurn({
      request: "Mensalidade", registry, sessionId: "sess_au", store,
      params: { __interactive: { flow: "asaas_update_charge_due_date", action: "select_charge" }, chargeId: "ch_1" }
    });
    expect(askDate.handled).toBe(true);
    if (!askDate.handled) throw new Error("expected handled result");
    expect(askDate.result).toMatchObject({ missingFields: ["dueDateBr"] });

    const planned = await runInteractiveFlowTurn({ request: "20/07/2026", registry, sessionId: "sess_au", store });
    expect(planned.handled).toBe(true);
    if (!planned.handled) throw new Error("expected handled result");
    expect(planned.draftOperationId).toBe("op_asaas_update");
    expect(planned.result).toMatchObject({ status: "executed", receiptStatus: "planned", approvalAvailable: true });
    expect(calls).toEqual([{ chargeId: "ch_1", dueDateBr: "20/07/2026" }]);
  });
  it.todo("starts the create-customer flow from the anchor marker");
  it.todo("starts the Conta Azul update-due-date flow from the anchor marker");
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
      searchTerm: z.string()
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
      searchTerm: z.string()
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
      searchTerm: z.string()
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

async function reachItemSelection(
  store: ReturnType<typeof createInteractiveFlowStore>,
  registry: ReturnType<typeof createToolRegistry>
): Promise<void> {
  await startAndSelectTenant(store, registry);
  await runInteractiveFlowTurn({
    request: "AZUOS",
    registry,
    sessionId: "sess_contaazul",
    store
  });
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
  await runInteractiveFlowTurn({
    request: "Honorário contábil mensal",
    registry,
    sessionId: "sess_contaazul",
    store
  });
  await runInteractiveFlowTurn({
    request: "Honorário contábil mensal",
    registry,
    sessionId: "sess_contaazul",
    store,
    params: {
      __interactive: { flow: "contaazul_service_sale_boleto", action: "select_category" },
      categoryId: "cat_1",
      categoryName: "Honorário contábil mensal"
    }
  });
  await runInteractiveFlowTurn({
    request: "Honorário Contábil",
    registry,
    sessionId: "sess_contaazul",
    store
  });
  await runInteractiveFlowTurn({
    request: "Honorário Contábil",
    registry,
    sessionId: "sess_contaazul",
    store,
    params: {
      __interactive: { flow: "contaazul_service_sale_boleto", action: "select_item" },
      itemId: "item_1",
      itemName: "Honorário Contábil"
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
