import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../../src/ui/App.js";
import { ConfirmationSheet } from "../../src/ui/components/ConfirmationSheet.js";
import { OperationsScreen } from "../../src/ui/screens/OperationsScreen.js";

describe("Confere UI", () => {
  it("renders the product shell and module navigation", () => {
    const html = renderToString(<App />);

    expect(html).toContain("Confere");
    expect(html).toContain("Conta Azul");
    expect(html).toContain("Asaas");
    expect(html).toContain("Operações");
    expect(html).toContain("Sessões");
  });

  it("renders home status language without secret values", () => {
    const html = renderToString(<App />);

    expect(html).toContain("Modo de operação");
    expect(html).toContain("Quota do modelo");
    expect(html).not.toContain("GEMINI_API_KEY");
  });

  it("renders workflow action language", () => {
    const html = renderToString(<App />);

    expect(html).toContain("Conta Azul");
    expect(html).toContain("Asaas");
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

  it("renders operations navigation language", () => {
    const html = renderToString(<App />);

    expect(html).toContain("Operações");
  });

  it("renders the operations history screen", () => {
    const html = renderToString(<OperationsScreen />);

    expect(html).toContain("Histórico auditável");
    expect(html).toContain("Ledger redigido");
  });
});
