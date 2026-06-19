import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseAccountancyClients,
  parseFinancialStatementItems
} from "../../../src/modules/contaazul/parsers.js";

const fixturesDir = path.join(process.cwd(), "tests", "fixtures", "contaazul");

describe("Conta Azul parsers", () => {
  it("normalizes active accountancy clients with tenant ids", () => {
    const json = JSON.parse(
      readFileSync(path.join(fixturesDir, "accountancy-clients.json"), "utf-8")
    );

    expect(parseAccountancyClients(json)).toEqual([
      {
        relationId: "rel_001",
        tenantId: 101,
        name: "Cliente Exemplo Ltda",
        document: "00000000000000",
        active: true
      }
    ]);
  });

  it("normalizes financial statement items", () => {
    const json = JSON.parse(
      readFileSync(path.join(fixturesDir, "financial-statement-page.json"), "utf-8")
    );

    expect(parseFinancialStatementItems(json.items)).toEqual([
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
  });
});
