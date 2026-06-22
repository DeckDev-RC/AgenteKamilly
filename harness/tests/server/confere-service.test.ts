import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createFakeModelProvider } from "../support/fake-model-provider.js";
import { createToolRegistry } from "../../src/core/tool-registry.js";
import type { ToolReceipt } from "../../src/core/tool-types.js";
import { createConfereService } from "../../src/server/confere-service.js";

describe("confere service", () => {
  it("returns status without exposing secrets", async () => {
    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: {
        RUNTIME_MODE: "dry-run",
        GEMINI_API_KEY: "secret_value",
        ASAAS_ENV_PATH: "missing.env",
        CONTAAZUL_STATE_PATH: "missing.json"
      },
      registryFactory: async () => ({
        registry: createToolRegistry(),
        warnings: ["missing sessions"]
      }),
      modelProvider: createFakeModelProvider({})
    });

    const status = await service.getStatus();

    expect(status.appName).toBe("Confere");
    expect(JSON.stringify(status)).not.toContain("secret_value");
    expect(status.warnings).toContain("missing sessions");
  });

  it("saves a draft when agent dry-run plans a workflow", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "asaas.create_boleto_charge_workflow",
      description: "workflow",
      parameters: z.object({
        customerName: z.string(),
        valueBr: z.string(),
        dueDateBr: z.string(),
        description: z.string()
      }),
      execute: async () => ({
        ...plannedReceipt("asaas.create_boleto_charge_workflow", "op_agent"),
        summary: "Plano para Cliente Exemplo"
      })
    });

    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: { RUNTIME_MODE: "dry-run" },
      registryFactory: async () => ({ registry, warnings: [] }),
      modelProvider: createFakeModelProvider({
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
        confidence: 0.95,
        reason: "Dados completos."
      })
    });

    const response = await service.runAgentTurn({
      request: "criar boleto no Asaas",
      sessionId: "sess_demo"
    });

    expect(response.draftOperationId).toBe("op_agent");
    expect(response.result).toMatchObject({
      status: "executed",
      operationId: "op_agent",
      receiptStatus: "planned",
      approvalAvailable: true
    });
    expect(JSON.stringify(response.result)).not.toContain("Cliente Exemplo");
    expect(service.getDraft("op_agent")).toMatchObject({
      operationId: "op_agent",
      params: { customerName: "Cliente Exemplo" }
    });
  });

  it("handles the Conta Azul service boleto wizard before calling the model planner", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "contaazul.list_accountancy_clients",
      description: "tenants",
      parameters: z.object({}),
      execute: async () => ({
        operationId: "op_tenants",
        provider: "contaazul",
        toolName: "contaazul.list_accountancy_clients",
        status: "succeeded",
        dryRun: true,
        summary: "tenants",
        data: [
          { tenantId: 3047702, relationId: "rel_mais", name: "MAIS NEGOCIOS", active: true }
        ],
        artifacts: [],
        warnings: []
      } satisfies ToolReceipt)
    });
    const provider = createFakeModelProvider({});
    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: { RUNTIME_MODE: "dry-run" },
      registryFactory: async () => ({ registry, warnings: [] }),
      modelProvider: provider
    });

    const response = await service.runAgentTurn({
      request: "Emitir Novo Boleto de Serviço",
      sessionId: "sess_interactive"
    });

    expect(provider.calls).toEqual([]);
    expect(response.result).toMatchObject({
      status: "needs_input",
      toolName: "contaazul.interactive_service_sale_boleto",
      missingFields: ["tenantId"],
      choices: [
        {
          id: "tenant:3047702",
          label: "MAIS NEGOCIOS"
        }
      ]
    });
  });

  it("saves a live-approval draft after the interactive Conta Azul wizard plans a dry-run", async () => {
    const registry = createToolRegistry();
    registerInteractiveContaAzulTools(registry);
    const provider = createFakeModelProvider({});
    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: { RUNTIME_MODE: "dry-run" },
      registryFactory: async () => ({ registry, warnings: [] }),
      modelProvider: provider
    });
    const sessionId = "sess_interactive_full";

    await service.runAgentTurn({ request: "Emitir Novo Boleto de Serviço", sessionId });
    await service.runAgentTurn({
      request: "MAIS NEGOCIOS",
      sessionId,
      params: {
        __interactive: { flow: "contaazul_service_sale_boleto", action: "select_tenant" },
        tenantId: 3047702,
        relationId: "rel_mais",
        tenantName: "MAIS NEGOCIOS"
      }
    });
    await service.runAgentTurn({ request: "AZUOS", sessionId });
    await service.runAgentTurn({
      request: "AZUOS ASSESSORIA CONTÁBIL LTDA",
      sessionId,
      params: {
        __interactive: { flow: "contaazul_service_sale_boleto", action: "select_customer" },
        customerId: "cust_1",
        customerName: "AZUOS ASSESSORIA CONTÁBIL LTDA"
      }
    });
    await service.runAgentTurn({ request: "Honorário contábil mensal", sessionId });
    await service.runAgentTurn({
      request: "Honorário contábil mensal",
      sessionId,
      params: {
        __interactive: { flow: "contaazul_service_sale_boleto", action: "select_category" },
        categoryId: "cat_1",
        categoryName: "Honorário contábil mensal"
      }
    });
    await service.runAgentTurn({ request: "Honorário Contábil", sessionId });
    await service.runAgentTurn({
      request: "Honorário Contábil",
      sessionId,
      params: {
        __interactive: { flow: "contaazul_service_sale_boleto", action: "select_item" },
        itemId: "item_1",
        itemName: "Honorário Contábil"
      }
    });
    await service.runAgentTurn({ request: "Honorário mensal", sessionId });
    await service.runAgentTurn({ request: "10,00", sessionId });
    await service.runAgentTurn({ request: "30/06/2026", sessionId });
    await service.runAgentTurn({ request: "62991514384", sessionId });
    await service.runAgentTurn({ request: "kamilly.agregarnegocios@gmail.com", sessionId });
    const response = await service.runAgentTurn({
      request: "sccontabilidadefinanceiro@gmail.com",
      sessionId
    });

    expect(provider.calls).toEqual([]);
    expect(response.draftOperationId).toBe("op_interactive_plan");
    expect(service.getDraft("op_interactive_plan")).toMatchObject({
      operationId: "op_interactive_plan",
      toolName: "contaazul.create_service_sale_boleto_workflow",
      params: {
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
    });
  });

  it("builds the confirmation sheet from the active draft params", async () => {
    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: { RUNTIME_MODE: "dry-run" },
      registryFactory: async () => ({ registry: createToolRegistry(), warnings: [] }),
      modelProvider: createFakeModelProvider({})
    });
    service.saveDraftForTest({
      operationId: "op_sheet",
      toolName: "contaazul.create_service_sale_boleto_workflow",
      request: "criar venda",
      params: {
        tenantId: 3047702,
        customerName: "Cliente Exemplo",
        categoryName: "Honorário contábil mensal",
        itemName: "Honorário Contábil",
        serviceDescription: "Honorário mensal",
        unitValueBr: "10,00",
        dueDateBr: "30/06/2026",
        idempotencyKey: "idem_demo"
      },
      createdAt: "2026-06-20T12:00:00.000Z"
    });

    const response = await service.getConfirmationSheet("op_sheet");

    expect(response).toMatchObject({
      status: "ok",
      sheet: {
        operationId: "op_sheet",
        tenantId: 3047702,
        customerName: "Cliente Exemplo",
        itemName: "Honorário Contábil",
        description: "Honorário mensal",
        value: "10,00",
        dueDate: "30/06/2026",
        idempotencyKey: "idem_demo"
      }
    });
  });

  it("executes a saved draft in live mode with APROVAR token", async () => {
    const calls: unknown[] = [];
    const registry = createToolRegistry();
    registry.register({
      name: "asaas.create_boleto_charge_workflow",
      description: "workflow",
      parameters: z.object({
        operationId: z.string().optional(),
        approvalText: z.string().optional(),
        customerName: z.string(),
        valueBr: z.string(),
        dueDateBr: z.string(),
        description: z.string()
      }),
      execute: async (params) => {
        calls.push(params);
        return {
          ...plannedReceipt("asaas.create_boleto_charge_workflow", "op_agent"),
          status: "succeeded",
          dryRun: false
        } satisfies ToolReceipt;
      }
    });

    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: {
        RUNTIME_MODE: "dry-run",
        ALLOW_LIVE_MUTATIONS: "true"
      },
      registryFactory: async (config) => {
        expect(config.runtimeMode).toBe("live");
        return { registry, warnings: [] };
      },
      modelProvider: createFakeModelProvider({})
    });
    service.saveDraftForTest({
      operationId: "op_agent",
      toolName: "asaas.create_boleto_charge_workflow",
      request: "criar boleto",
      params: {
        customerName: "Cliente Exemplo",
        valueBr: "120,00",
        dueDateBr: "30/06/2026",
        description: "Honorarios"
      },
      createdAt: "2026-06-20T12:00:00.000Z"
    });

    const response = await service.executeApprovedOperation({ operationId: "op_agent" });

    expect(response.status).toBe("executed");
    if (response.status === "executed") {
      expect(response.receiptStatus).toBe("succeeded");
      expect(response.operation.operationId).toBe("op_agent");
    }
    expect(calls).toEqual([
      {
        operationId: "op_agent",
        approvalText: "APROVAR op_agent",
        customerName: "Cliente Exemplo",
        valueBr: "120,00",
        dueDateBr: "30/06/2026",
        description: "Honorarios"
      }
    ]);
  });

  it("blocks live execution for a draft whose tool is not on the workflow allowlist", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "asaas.create_boleto_charge",
      description: "low-level mutation",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("should not execute");
      }
    });
    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: { ALLOW_LIVE_MUTATIONS: "true" },
      registryFactory: async () => ({ registry, warnings: [] }),
      modelProvider: createFakeModelProvider({})
    });
    service.saveDraftForTest({
      operationId: "op_low",
      toolName: "asaas.create_boleto_charge",
      request: "criar boleto",
      params: {},
      createdAt: "2026-06-20T12:00:00.000Z"
    });

    const response = await service.executeApprovedOperation({ operationId: "op_low" });

    expect(response).toEqual({
      status: "blocked",
      reason: "Tool is not allowed for Confere live approval: asaas.create_boleto_charge"
    });
    expect(service.getDraft("op_low")).toMatchObject({ operationId: "op_low" });
  });

  it("allows live execution of the Asaas update-charge-due-date tool", async () => {
    const calls: unknown[] = [];
    const registry = createToolRegistry();
    registry.register({
      name: "asaas.update_charge_due_date",
      description: "update due date",
      parameters: z.object({
        operationId: z.string().optional(),
        approvalText: z.string().optional(),
        chargeId: z.string(),
        dueDateBr: z.string()
      }),
      execute: async (params) => {
        calls.push(params);
        return {
          ...plannedReceipt("asaas.update_charge_due_date", "op_upd"),
          status: "succeeded",
          dryRun: false
        } satisfies ToolReceipt;
      }
    });

    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: { RUNTIME_MODE: "dry-run", ALLOW_LIVE_MUTATIONS: "true" },
      registryFactory: async () => ({ registry, warnings: [] }),
      modelProvider: createFakeModelProvider({})
    });
    service.saveDraftForTest({
      operationId: "op_upd",
      toolName: "asaas.update_charge_due_date",
      request: "alterar vencimento",
      params: { chargeId: "ch_1", dueDateBr: "20/07/2026" },
      createdAt: "2026-06-20T12:00:00.000Z"
    });

    const response = await service.executeApprovedOperation({ operationId: "op_upd" });

    expect(response.status).toBe("executed");
    expect(calls).toEqual([
      {
        operationId: "op_upd",
        approvalText: "APROVAR op_upd",
        chargeId: "ch_1",
        dueDateBr: "20/07/2026"
      }
    ]);
  });

  it("allows live execution of the Conta Azul due-date reissue workflow", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "contaazul.update_due_date_reissue_boleto_workflow",
      description: "reissue",
      parameters: z.object({}).passthrough(),
      execute: async () =>
        ({
          ...plannedReceipt("contaazul.update_due_date_reissue_boleto_workflow", "op_reissue"),
          status: "succeeded",
          dryRun: false
        }) satisfies ToolReceipt
    });

    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: { RUNTIME_MODE: "dry-run", ALLOW_LIVE_MUTATIONS: "true" },
      registryFactory: async () => ({ registry, warnings: [] }),
      modelProvider: createFakeModelProvider({})
    });
    service.saveDraftForTest({
      operationId: "op_reissue",
      toolName: "contaazul.update_due_date_reissue_boleto_workflow",
      request: "alterar vencimento",
      params: { tenantId: 3047702, financialEventId: "fe_1", installmentId: "inst_1", dueDateIso: "2026-07-20" },
      createdAt: "2026-06-20T12:00:00.000Z"
    });

    const response = await service.executeApprovedOperation({ operationId: "op_reissue" });
    expect(response.status).toBe("executed");
  });

  it("blocks live execution when no draft exists", async () => {
    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: { ALLOW_LIVE_MUTATIONS: "true" },
      registryFactory: async () => ({ registry: createToolRegistry(), warnings: [] }),
      modelProvider: createFakeModelProvider({})
    });

    const response = await service.executeApprovedOperation({ operationId: "missing" });

    expect(response).toEqual({
      status: "blocked",
      reason: "No active dry-run draft found for operation: missing"
    });
  });

  it("keeps a draft when live mutations are disabled", async () => {
    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: { ALLOW_LIVE_MUTATIONS: "false" },
      registryFactory: async () => ({ registry: createToolRegistry(), warnings: [] }),
      modelProvider: createFakeModelProvider({})
    });
    service.saveDraftForTest({
      operationId: "op_guard",
      toolName: "asaas.create_boleto_charge_workflow",
      request: "criar boleto",
      params: { customerName: "Cliente" },
      createdAt: "2026-06-20T12:00:00.000Z"
    });

    const response = await service.executeApprovedOperation({ operationId: "op_guard" });

    expect(response.status).toBe("blocked");
    expect(service.getDraft("op_guard")).toMatchObject({ operationId: "op_guard" });
  });

  it("does not create a live draft for a high-risk plan without operator confirmation", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "asaas.create_boleto_charge_workflow",
      description: "workflow",
      parameters: z.object({ customerName: z.string() }).passthrough(),
      execute: async () => plannedReceipt("asaas.create_boleto_charge_workflow", "op_risk")
    });
    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: { RUNTIME_MODE: "dry-run" },
      registryFactory: async () => ({ registry, warnings: [] }),
      modelProvider: createFakeModelProvider({
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
        risk: "high",
        confidence: 0.5,
        reason: "Plano incerto."
      })
    });

    const response = await service.runAgentTurn({
      request: "criar boleto no Asaas",
      sessionId: "sess_risk"
    });

    expect(response.draftOperationId).toBeUndefined();
    expect(response.result).toMatchObject({
      status: "needs_input",
      missingFields: ["operatorConfirmation"],
      approvalAvailable: false
    });
  });

  it("does not create a live draft when the workflow dry-run blocks a duplicate", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "contaazul.create_service_sale_boleto_workflow",
      description: "workflow",
      parameters: z.object({ tenantId: z.number() }).passthrough(),
      execute: async () => ({
        ...plannedReceipt("contaazul.create_service_sale_boleto_workflow", "op_duplicate"),
        status: "blocked",
        summary: "duplicate operation",
        warnings: ["duplicate"]
      })
    });
    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: { RUNTIME_MODE: "dry-run" },
      registryFactory: async () => ({ registry, warnings: [] }),
      modelProvider: createFakeModelProvider({
        intent: "create_service_sale_boleto_workflow",
        toolName: "contaazul.create_service_sale_boleto_workflow",
        params: completeContaAzulParams(),
        missingFields: [],
        questions: [],
        risk: "medium",
        confidence: 0.9,
        reason: "Dados completos."
      })
    });

    const response = await service.runAgentTurn({
      request: "criar venda Conta Azul",
      sessionId: "sess_dup"
    });

    expect(response.draftOperationId).toBeUndefined();
    expect(response.result).toMatchObject({
      status: "executed",
      receiptStatus: "blocked",
      approvalAvailable: false
    });
  });

  it("does not create a live draft for an orphaned partial failure", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "contaazul.create_service_sale_boleto_workflow",
      description: "workflow",
      parameters: z.object({ tenantId: z.number() }).passthrough(),
      execute: async () => ({
        ...plannedReceipt("contaazul.create_service_sale_boleto_workflow", "op_orphan"),
        status: "failed",
        summary: "sale created but boleto failed",
        warnings: ["manual cleanup required"]
      })
    });
    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: { RUNTIME_MODE: "dry-run" },
      registryFactory: async () => ({ registry, warnings: [] }),
      modelProvider: createFakeModelProvider({
        intent: "create_service_sale_boleto_workflow",
        toolName: "contaazul.create_service_sale_boleto_workflow",
        params: completeContaAzulParams(),
        missingFields: [],
        questions: [],
        risk: "medium",
        confidence: 0.9,
        reason: "Dados completos."
      })
    });

    const response = await service.runAgentTurn({
      request: "criar venda Conta Azul",
      sessionId: "sess_orphan"
    });

    expect(response.draftOperationId).toBeUndefined();
    expect(response.result).toMatchObject({
      status: "executed",
      receiptStatus: "failed",
      approvalAvailable: false
    });
  });
});

function plannedReceipt(toolName: string, operationId: string): ToolReceipt {
  return {
    operationId,
    provider: toolName.startsWith("asaas.") ? "asaas" : "contaazul",
    toolName,
    status: "planned",
    dryRun: true,
    summary: "planned",
    data: { approvalPreview: { operationId } },
    artifacts: [],
    warnings: []
  };
}

function registerInteractiveContaAzulTools(registry: ReturnType<typeof createToolRegistry>): void {
  registry.register({
    name: "contaazul.list_accountancy_clients",
    description: "tenants",
    parameters: z.object({}),
    execute: async () =>
      succeededReceipt("contaazul.list_accountancy_clients", [
        { tenantId: 3047702, relationId: "rel_mais", name: "MAIS NEGOCIOS", active: true }
      ])
  });
  registry.register({
    name: "contaazul.search_sale_customers",
    description: "customers",
    parameters: z.object({ relationId: z.string(), searchTerm: z.string() }),
    execute: async () =>
      succeededReceipt("contaazul.search_sale_customers", [
        { id: "cust_1", name: "AZUOS ASSESSORIA CONTÁBIL LTDA" }
      ])
  });
  registry.register({
    name: "contaazul.switch_to_pro_session",
    description: "switch",
    parameters: z.object({ relationId: z.string() }),
    execute: async () =>
      succeededReceipt("contaazul.switch_to_pro_session", {
        relationId: "rel_mais",
        proSessionId: "relation:rel_mais",
        authToken: "[REDACTED_SECRET]"
      })
  });
  registry.register({
    name: "contaazul.search_financial_categories",
    description: "categories",
    parameters: z.object({ relationId: z.string(), searchTerm: z.string() }),
    execute: async () =>
      succeededReceipt("contaazul.search_financial_categories", [
        { uuid: "cat_1", dsNaturezaFinanceira: "Honorário contábil mensal" }
      ])
  });
  registry.register({
    name: "contaazul.search_service_items",
    description: "items",
    parameters: z.object({ relationId: z.string(), searchTerm: z.string() }),
    execute: async () =>
      succeededReceipt("contaazul.search_service_items", [
        { id: "item_1", name: "Honorário Contábil" }
      ])
  });
  registry.register({
    name: "contaazul.create_service_sale_boleto_workflow",
    description: "workflow",
    parameters: z.object({}).passthrough(),
    execute: async () => plannedReceipt("contaazul.create_service_sale_boleto_workflow", "op_interactive_plan")
  });
}

function succeededReceipt<T>(toolName: string, data: T): ToolReceipt<T> {
  return {
    operationId: `op_${toolName.replace(/[^a-z0-9]+/gi, "_")}`,
    provider: "contaazul",
    toolName,
    status: "succeeded",
    dryRun: true,
    summary: "succeeded",
    data,
    artifacts: [],
    warnings: []
  };
}

function completeContaAzulParams(): Record<string, unknown> {
  return {
    tenantId: 3047702,
    customerName: "Cliente Exemplo",
    categoryName: "Honorário contábil mensal",
    itemName: "Honorário Contábil",
    serviceDescription: "Honorário mensal",
    unitValueBr: "10,00",
    dueDateBr: "30/06/2026",
    notification: {
      email: "cliente@example.test"
    }
  };
}
