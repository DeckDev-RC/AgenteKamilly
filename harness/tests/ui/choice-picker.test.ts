import { describe, expect, it } from "vitest";

import type { AgentResultView } from "../../src/server/api-types.js";
import { filterChoices, inferChoicePicker } from "../../src/ui/lib/choice-picker.js";

function result(partial: Partial<AgentResultView>): AgentResultView {
  return {
    status: "needs_input",
    missingFields: [],
    questions: [],
    warnings: [],
    approvalAvailable: false,
    ...partial
  };
}

describe("inferChoicePicker", () => {
  it("uses selection mode for provider and operation menus", () => {
    expect(
      inferChoicePicker(
        result({
          missingFields: ["operation"],
          choices: [{ id: "op1", label: "Emitir boleto" }]
        })
      )
    ).toMatchObject({ display: "select" });

    expect(
      inferChoicePicker(
        result({
          missingFields: ["provider"],
          choices: [
            { id: "p1", label: "Conta Azul" },
            { id: "p2", label: "Asaas" }
          ]
        })
      )
    ).toMatchObject({ display: "select" });
  });

  it("keeps search mode for tenant choices", () => {
    const picker = inferChoicePicker(
      result({
        missingFields: ["tenantId"],
        choices: [{ id: "t1", label: "Empresa A" }]
      })
    );
    expect(picker).toMatchObject({ mode: "local", display: "search", placeholder: "Pesquisar empresa..." });
  });

  it("uses local search for preloaded customer choices with create option", () => {
    const picker = inferChoicePicker(
      result({
        provider: "contaazul",
        missingFields: ["customerId"],
        choices: [{ id: "c1", label: "Cliente A" }]
      })
    );
    expect(picker).toMatchObject({
      mode: "local",
      display: "search",
      allowCreate: true,
      createLabel: "Criar novo cliente"
    });
  });

  it("filters local choices by label and description", () => {
    const filtered = filterChoices(
      [
        { id: "1", label: "MARC MIX LTDA", description: "Tenant 3141682" },
        { id: "2", label: "INARA TEXTIL", description: "Tenant 999" }
      ],
      "inara"
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.label).toContain("INARA");
  });
});
