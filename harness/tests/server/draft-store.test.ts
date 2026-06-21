import { describe, expect, it } from "vitest";

import { createDraftStore } from "../../src/server/draft-store.js";

describe("draft store", () => {
  it("stores exact workflow params by operation id", () => {
    const store = createDraftStore();
    store.save({
      operationId: "op_1",
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

    expect(store.get("op_1")).toMatchObject({
      operationId: "op_1",
      toolName: "asaas.create_boleto_charge_workflow",
      params: { customerName: "Cliente Exemplo" }
    });
  });

  it("does not invent drafts for unknown operation ids", () => {
    const store = createDraftStore();

    expect(store.get("missing")).toBeUndefined();
  });

  it("removes a draft after successful handoff", () => {
    const store = createDraftStore();
    store.save({
      operationId: "op_1",
      toolName: "contaazul.create_service_sale_boleto_workflow",
      request: "criar venda",
      params: { tenantId: 3047702 },
      createdAt: "2026-06-20T12:00:00.000Z"
    });

    expect(store.consume("op_1")).toMatchObject({ operationId: "op_1" });
    expect(store.get("op_1")).toBeUndefined();
  });
});
