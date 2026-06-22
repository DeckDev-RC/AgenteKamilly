import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../../src/ui/App.js";
import { ConfirmationSheet } from "../../src/ui/components/ConfirmationSheet.js";
import { PixelynAvatar } from "../../src/ui/components/PixelynAvatar.js";
import { PlanCard } from "../../src/ui/components/PlanCard.js";
import { AssistantResultMessage } from "../../src/ui/screens/AssistantScreen.js";
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
    expect(html).toContain("Confere");
    expect(html).toContain("Pixelyn");
  });

  it("renders a professional assistant workspace with operation context", () => {
    const html = renderToString(<App />);
    expect(html).toContain("o que vamos resolver hoje");
    expect(html).toContain("Operação em preparo");
    expect(html).toContain("Dry-run primeiro");
    expect(html).toContain("Campos pendentes");
  });

  it("renders a modern prompt composer with command affordances", () => {
    const html = renderToString(<App />);
    expect(html).toContain("Descreva o que você precisa");
    expect(html).toContain("Ctrl");
    expect(html).toContain("Enter");
    expect(html).toContain("Atalhos");
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
    expect(html).toContain("Plano pronto para revisão");
    expect(html).toContain("Revisar e aprovar");
    expect(html).not.toContain("{\"");
  });

  it("renders assistant structured choices as action buttons", () => {
    const html = renderToString(
      <AssistantResultMessage
        message={{
          id: "assistant_choices",
          role: "assistant",
          timestamp: "12:00",
          result: {
            status: "needs_input",
            provider: "contaazul",
            intent: "create_service_sale_boleto",
            toolName: "contaazul.interactive_service_sale_boleto",
            summary: "Selecione a empresa do Conta Azul.",
            missingFields: ["tenantId"],
            questions: ["Selecione a empresa para esta operação."],
            warnings: [],
            approvalAvailable: false,
            choices: [
              {
                id: "tenant:3047702",
                label: "MAIS NEGOCIOS",
                description: "Tenant 3047702",
                params: {
                  __interactive: {
                    flow: "contaazul_service_sale_boleto",
                    action: "select_tenant"
                  },
                  tenantId: 3047702,
                  tenantName: "MAIS NEGOCIOS"
                }
              }
            ]
          }
        }}
        isLatest={true}
        onReview={() => undefined}
        onSend={() => undefined}
      />
    );

    expect(html).toContain("MAIS NEGOCIOS");
    expect(html).toContain("Tenant 3047702");
    expect(html).toContain("button");
    expect(html).not.toContain("__interactive");
  });

  it("renders backend choice chips and not the legacy inline tenant/customer search", () => {
    const html = renderToString(
      <AssistantResultMessage
        message={{
          id: "m1",
          role: "assistant",
          timestamp: "21:10",
          result: {
            status: "needs_input",
            toolName: "contaazul.interactive_service_sale_boleto",
            missingFields: ["customerId"],
            questions: ["Selecione o cliente para esta venda."],
            warnings: [],
            approvalAvailable: false,
            choices: [
              {
                id: "customer:cust_1",
                label: "AZUOS ASSESSORIA CONTÁBIL LTDA",
                description: "Cliente Conta Azul",
                params: {
                  __interactive: {
                    flow: "contaazul_service_sale_boleto",
                    action: "select_customer"
                  },
                  customerId: "cust_1",
                  customerName: "AZUOS ASSESSORIA CONTÁBIL LTDA"
                }
              }
            ]
          }
        }}
        isLatest={true}
        onReview={() => undefined}
        onSend={() => undefined}
      />
    );

    expect(html).toContain("AZUOS ASSESSORIA CONTÁBIL LTDA");
    expect(html).not.toContain("Selecione a empresa acima primeiro");
    expect(html).not.toContain("Pesquisar cliente por nome");
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
