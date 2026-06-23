import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterCustomersByQuery,
  parseChargeLinksFromHtml,
  parseChargesTableContent,
  parseCustomerTableContent,
  parsePendingChargesTableContent
} from "../../../src/modules/asaas/parsers.js";

const fixturesDir = join(process.cwd(), "tests", "fixtures", "asaas");

describe("Asaas parsers", () => {
  it("normalizes customers from table content", () => {
    const fixture = JSON.parse(
      readFileSync(join(fixturesDir, "customer-table.json"), "utf-8")
    ) as { content: string };

    expect(parseCustomerTableContent(fixture.content)).toEqual([
      {
        id: "101",
        name: "Cliente Exemplo Ltda",
        email: "financeiro@example.test",
        phone: "+55 11 90000-0000"
      },
      {
        id: "102",
        name: "Cliente Sem Email"
      }
    ]);
  });

  it("filters customers by case-insensitive query", () => {
    const customers = [
      { id: "101", name: "Cliente Exemplo Ltda" },
      { id: "102", name: "Outro Cliente" }
    ];

    expect(filterCustomersByQuery(customers, "exemplo")).toEqual([
      { id: "101", name: "Cliente Exemplo Ltda" }
    ]);
  });

  it("returns only pending charges from payment table content", () => {
    const fixture = JSON.parse(
      readFileSync(join(fixturesDir, "pending-charges.json"), "utf-8")
    ) as { content: string };

    expect(parsePendingChargesTableContent(fixture.content, "101")).toEqual([
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
  });

  it("returns all boleto charges regardless of status when filter is all", () => {
    const fixture = JSON.parse(
      readFileSync(join(fixturesDir, "pending-charges.json"), "utf-8")
    ) as { content: string };

    expect(parseChargesTableContent(fixture.content, "101", { statusFilter: "all" })).toEqual([
      {
        id: "501",
        customerId: "101",
        customerName: "Cliente Exemplo Ltda",
        valueBr: "R$ 120,50",
        dueDateBr: "20/07/2026",
        status: "Aguardando pagamento",
        description: "HONORARIO MENSAL"
      },
      {
        id: "502",
        customerId: "101",
        customerName: "Cliente Exemplo Ltda",
        valueBr: "R$ 80,00",
        dueDateBr: "10/07/2026",
        status: "Recebida"
      }
    ]);
  });

  it("extracts boleto and invoice links from charge detail html", () => {
    const html = readFileSync(join(fixturesDir, "charge-show.html"), "utf-8");

    expect(parseChargeLinksFromHtml(html, "501")).toEqual({
      chargeId: "501",
      boletoUrl: "https://www.asaas.com/b/pdf/tok_test_123",
      invoiceUrl: "https://www.asaas.com/i/tok_test_123",
      externalToken: "tok_test_123"
    });
  });
});
