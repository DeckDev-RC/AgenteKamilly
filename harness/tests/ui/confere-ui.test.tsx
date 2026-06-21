import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../../src/ui/App.js";
import { ConfirmationSheet } from "../../src/ui/components/ConfirmationSheet.js";
import { PixelynAvatar } from "../../src/ui/components/PixelynAvatar.js";
import { PlanCard } from "../../src/ui/components/PlanCard.js";
import { OperationsScreen } from "../../src/ui/screens/OperationsScreen.js";

describe("Confere UI", () => {
  it("renders the assistant-first shell with the three rail destinations", () => {
    const html = renderToString(<App />);
    expect(html).toContain("Confere");
    expect(html).toContain("Conversa");
    expect(html).toContain("Operações");
    expect(html).toContain("Sessões");
  });

  it("renders the Pixelyn presence in the rail", () => {
    const html = renderToString(<App />);
    expect(html).toContain("viva");
    expect(html).toContain("Pixelyn");
  });

  it("greets the operator with the informal tone by default", () => {
    const html = renderToString(<App />);
    expect(html).toContain("o que vamos resolver hoje");
  });

  it("renders the Pixelyn avatar with a state label for accessibility", () => {
    expect(renderToString(<PixelynAvatar state="feito" />)).toContain("feito");
    expect(renderToString(<PixelynAvatar state="bloqueada" />)).toContain("bloqueada");
  });

  it("renders the plan card with business facts and no raw json", () => {
    const html = renderToString(
      <PlanCard
        facts={{
          customerName: "AZUOS ASSESSORIA",
          value: "R$ 250,00",
          dueDate: "30/06/2026",
          action: "Gerar boleto · Asaas"
        }}
        approvalAvailable
        onApprove={() => undefined}
      />
    );
    expect(html).toContain("AZUOS ASSESSORIA");
    expect(html).toContain("Aprovar execução");
    expect(html).not.toContain("{\"");
  });

  it("renders the final confirmation sheet before live approval", () => {
    const html = renderToString(
      <ConfirmationSheet
        onCancel={() => undefined}
        onConfirm={() => undefined}
        open
        sheet={{
          operationId: "op_demo",
          toolName: "contaazul.create_service_sale_boleto_workflow",
          tenantId: 3047702,
          customerName: "Cliente Demonstração",
          itemName: "Honorário Contábil",
          value: "10,00",
          dueDate: "30/06/2026",
          warnings: ["Revise antes de executar."]
        }}
      />
    );
    expect(html).toContain("Confirmar execução real");
    expect(html).toContain("Cliente Demonstração");
    expect(html).toContain("Aprovar execução real");
  });

  it("renders the operations history screen", () => {
    const html = renderToString(<OperationsScreen />);
    expect(html).toContain("Histórico auditável");
    expect(html).toContain("Ledger redigido");
  });
});
