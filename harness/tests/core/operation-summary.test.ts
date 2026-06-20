import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { appendLedgerEntry } from "../../src/core/ledger.js";
import {
  formatOperationSummary,
  summarizeOperationById
} from "../../src/core/operation-summary.js";

describe("operation summary", () => {
  it("summarizes the latest ledger entry for an operation", async () => {
    const ledgerPath = await tempLedgerPath();
    await appendLedgerEntry(ledgerPath, {
      operationId: "op_sale",
      provider: "contaazul",
      toolName: "contaazul.create_service_sale_and_issue_boleto",
      status: "planned",
      responseSummary: { summary: "planned", saleNumber: 10 },
      artifacts: [],
      warnings: []
    });
    await appendLedgerEntry(ledgerPath, {
      operationId: "op_sale",
      provider: "contaazul",
      toolName: "contaazul.create_service_sale_and_issue_boleto",
      status: "succeeded",
      responseSummary: {
        summary: "done",
        saleNumber: 10,
        chargeUrl: "https://example.test/fatura",
        idempotencyKey: "idem_1"
      },
      artifacts: [{ kind: "pdf", path: "boleto.pdf", label: "boleto" }],
      warnings: []
    });

    const summary = await summarizeOperationById({ ledgerPath, operationId: "op_sale" });

    expect(summary).toMatchObject({
      operationId: "op_sale",
      found: true,
      latestStatus: "succeeded",
      entryCount: 2,
      summary: "done",
      saleNumber: 10,
      chargeUrl: "https://example.test/fatura",
      idempotencyKey: "idem_1",
      artifacts: [{ path: "boleto.pdf" }]
    });
    expect(formatOperationSummary(summary)).toContain("Status: succeeded");
  });

  it("summarizes duplicate blocks", async () => {
    const ledgerPath = await tempLedgerPath();
    await appendLedgerEntry(ledgerPath, {
      operationId: "op_repeat",
      provider: "contaazul",
      toolName: "contaazul.create_service_sale_and_issue_boleto",
      status: "blocked",
      responseSummary: {
        summary: "duplicate",
        duplicateOperationId: "op_original",
        idempotencyKey: "idem_1"
      },
      artifacts: [],
      warnings: ["duplicate"]
    });

    const summary = await summarizeOperationById({ ledgerPath, operationId: "op_repeat" });

    expect(summary).toMatchObject({
      latestStatus: "blocked",
      duplicateOperationId: "op_original",
      warnings: ["duplicate"]
    });
  });

  it("summarizes partial failures with orphaned sale details", async () => {
    const ledgerPath = await tempLedgerPath();
    await appendLedgerEntry(ledgerPath, {
      operationId: "op_partial",
      provider: "contaazul",
      toolName: "contaazul.create_service_sale_and_issue_boleto",
      status: "failed",
      responseSummary: {
        summary: "sale created but failed later",
        idempotencyKey: "idem_1",
        orphanedSaleId: "sale_uuid",
        failedStep: "poll_financial_event"
      },
      artifacts: [],
      warnings: ["manual cleanup required"]
    });

    const summary = await summarizeOperationById({ ledgerPath, operationId: "op_partial" });

    expect(summary).toMatchObject({
      latestStatus: "failed",
      orphanedSaleId: "sale_uuid",
      failedStep: "poll_financial_event"
    });
    expect(formatOperationSummary(summary)).toContain("Venda orfa: sale_uuid");
    expect(formatOperationSummary(summary)).toContain("Etapa com falha: poll_financial_event");
  });
});

async function tempLedgerPath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "harness-operation-summary-"));
  return path.join(dir, "ledger", "operations.jsonl");
}
