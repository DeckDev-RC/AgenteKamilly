import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../../src/ui/App.js";
import { ConfirmationSheet } from "../../src/ui/components/ConfirmationSheet.js";
import { PixelynAvatar } from "../../src/ui/components/PixelynAvatar.js";
import { PlanCard } from "../../src/ui/components/PlanCard.js";
import { AssistantResultMessage, buildBoletoHandoffParams } from "../../src/ui/screens/AssistantScreen.js";
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
    expect(html).toContain("Enter envia");
    expect(html).toContain("Ctrl + Enter quebra linha");
    // Anexar e Atalhos foram removidos da caixa de digitação.
    expect(html).not.toContain("Anexar");
    expect(html).not.toContain("Atalhos");
  });

  it("shows the four explicit anchored operations on the empty conversation", () => {
    const html = renderToString(<App />);
    expect(html).toContain("Mudar boleto · Asaas");
    expect(html).toContain("Emitir boleto · Conta Azul");
    expect(html).toContain("Criar cliente · Conta Azul");
    expect(html).toContain("Mudar vencimento · Conta Azul");
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

    expect(html).toContain("choice-search");
    expect(html).toContain("Pesquisar empresa...");
    expect(html).not.toContain("choice-action");
    expect(html).not.toContain("__interactive");
  });

  it("renders the inline sale form after item selection", () => {
    const html = renderToString(
      <AssistantResultMessage
        message={{
          id: "assistant_form",
          role: "assistant",
          timestamp: "12:05",
          result: {
            status: "needs_input",
            provider: "contaazul",
            intent: "create_service_sale_boleto",
            toolName: "contaazul.interactive_service_sale_boleto",
            summary: "Quase lá! Preencha os dados da cobrança.",
            missingFields: ["serviceDescription", "unitValueBr", "dueDateBr"],
            questions: [],
            warnings: [],
            approvalAvailable: false,
            formId: "contaazul_service_sale_details",
            formContext: {
              customerName: "AZUOS ASSESSORIA",
              itemName: "Honorário Contábil"
            }
          }
        }}
        isLatest={true}
        onReview={() => undefined}
        onSend={() => undefined}
      />
    );

    expect(html).toContain("chat-form");
    expect(html).toContain("Preparar boleto");
    expect(html).toContain("Descrição do serviço");
    expect(html).not.toContain("question-list");
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

    expect(html).toContain("choice-search");
    expect(html).toContain("Pesquisar cliente...");
    expect(html).not.toContain("Selecione a empresa acima primeiro");
    expect(html).not.toContain("Pesquisar cliente por nome");
  });

  it("renders provider menu as selectable actions instead of search", () => {
    const html = renderToString(
      <AssistantResultMessage
        message={{
          id: "m_provider_menu",
          role: "assistant",
          timestamp: "10:07",
          result: {
            status: "needs_input",
            provider: "contaazul",
            toolName: "confere.interactive_provider_menu",
            summary: "Qual operação você quer fazer no Conta Azul?",
            missingFields: ["operation"],
            questions: ["Selecione uma das operações disponíveis no Conta Azul."],
            warnings: [],
            approvalAvailable: false,
            choices: [
              {
                id: "provider-op:ca-boleto",
                label: "Emitir boleto",
                description: "Venda de serviço com boleto",
                params: {
                  __interactive: { flow: "anchor", action: "start_contaazul_service_sale" }
                }
              },
              {
                id: "provider-op:ca-customer",
                label: "Criar cliente",
                description: "Cadastrar um novo cliente",
                params: {
                  __interactive: { flow: "anchor", action: "start_contaazul_create_customer" }
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

    expect(html).toContain("choice-action");
    expect(html).toContain("Emitir boleto");
    expect(html).not.toContain("choice-search");
    expect(html).not.toContain("Pesquisar destino");
  });

  it("hides boleto buttons while due-date update is still awaiting approval", () => {
    const html = renderToString(
      <AssistantResultMessage
        message={{
          id: "m_update_planned",
          role: "assistant",
          timestamp: "08:59",
          draftOperationId: "op_test",
          result: {
            status: "executed",
            provider: "asaas",
            intent: "update_charge_due_date",
            toolName: "asaas.update_charge_due_date",
            receiptStatus: "planned",
            summary: "Dry-run concluído. Revise os dados e aprove para alterar o vencimento e baixar o boleto atualizado.",
            missingFields: [],
            questions: [],
            warnings: [],
            approvalAvailable: true,
            receiptData: {}
          },
          operation: {
            operationId: "op_test",
            found: true,
            entryCount: 1,
            latestStatus: "planned",
            artifacts: [
              {
                kind: "pdf",
                path: "C:\\artifacts\\asaas\\op_test\\boleto_836609393.pdf",
                label: "boleto pdf planejado"
              }
            ],
            warnings: [],
            customerName: "IRANI LACERDA DA SILVA",
            chargeId: "836609393",
            dueDateBr: "18/07/2026"
          }
        }}
        isLatest={true}
        onReview={() => undefined}
        onSend={() => undefined}
      />
    );

    expect(html).toContain("Dry-run concluído");
    expect(html).not.toContain("Boleto pronto");
    expect(html).not.toContain("boleto pdf");
    expect(html).not.toContain("Alteração registrada no Asaas");
  });

  it("shows due-date update success copy with PDF when artifact is available", () => {
    const html = renderToString(
      <AssistantResultMessage
        message={{
          id: "m_update",
          role: "assistant",
          timestamp: "22:38",
          result: {
            status: "executed",
            provider: "asaas",
            intent: "update_charge_due_date",
            toolName: "asaas.update_charge_due_date",
            receiptStatus: "succeeded",
            summary: "Vencimento atualizado e PDF do boleto baixado.",
            missingFields: [],
            questions: [],
            warnings: [],
            approvalAvailable: false,
            receiptData: {
              approvalPreview: {
                target: { chargeId: "836609393" },
                changes: [{ field: "dueDate", to: "25/07/2026" }]
              },
              customerName: "IRANI LACERDA DA SILVA"
            }
          },
          operation: {
            operationId: "op_test",
            found: true,
            entryCount: 1,
            artifacts: [
              {
                kind: "pdf",
                path: "C:\\artifacts\\asaas\\op_test\\boleto_836609393.pdf",
                label: "boleto pdf atualizado"
              }
            ],
            warnings: [],
            customerName: "IRANI LACERDA DA SILVA",
            chargeId: "836609393",
            dueDateBr: "25/07/2026"
          }
        }}
        isLatest={true}
        onReview={() => undefined}
        onSend={() => undefined}
      />
    );

    expect(html).toContain("Vencimento alterado com sucesso");
    expect(html).toContain("836609393");
    expect(html).toContain("25/07/2026");
    expect(html).toContain("Baixe o PDF atualizado abaixo");
    expect(html).toContain("boleto pdf atualizado");
    expect(html).not.toContain("Boleto emitido com sucesso");
  });

  it("shows download-boleto success copy with PDF and no emission wording", () => {
    const html = renderToString(
      <AssistantResultMessage
        message={{
          id: "m_download",
          role: "assistant",
          timestamp: "10:39",
          result: {
            status: "executed",
            provider: "asaas",
            intent: "download_boleto_pdf",
            toolName: "asaas.download_boleto_pdf",
            operationId: "op_dl_1",
            receiptStatus: "succeeded",
            summary: "PDF do boleto baixado com sucesso.",
            missingFields: [],
            questions: [],
            warnings: [],
            approvalAvailable: false,
            receiptData: {
              chargeId: "836609393",
              customerName: "52.778.106 IRANI LACERDA DA SILVA",
              valueBr: "R$ 15,00",
              dueDateBr: "18/07/2026",
              artifacts: [
                {
                  kind: "pdf",
                  path: "C:\\artifacts\\asaas\\op_dl_1\\Mensalidade.pdf",
                  label: "boleto pdf"
                }
              ]
            }
          },
          operation: {
            operationId: "op_dl_1",
            found: true,
            entryCount: 1,
            artifacts: [
              {
                kind: "pdf",
                path: "C:\\artifacts\\asaas\\op_dl_1\\Mensalidade.pdf",
                label: "boleto pdf"
              }
            ],
            warnings: [],
            customerName: "52.778.106 IRANI LACERDA DA SILVA",
            chargeId: "836609393"
          }
        }}
        isLatest={true}
        onReview={() => undefined}
        onSend={() => undefined}
      />
    );

    expect(html).toContain("PDF do boleto");
    expect(html).toContain("836609393");
    expect(html).toContain("R$ 15,00");
    expect(html).toContain("18/07/2026");
    expect(html).toContain("boleto pdf");
    expect(html).not.toContain("emitir o boleto");
    expect(html).not.toContain("Boleto emitido");
    expect(html).not.toContain("Boleto pronto");
  });

  it("builds the boleto hand-off marker from the resolved customer", () => {
    const params = buildBoletoHandoffParams({
      customerId: "new_cust",
      customerName: "MARIA SILVA",
      tenantId: 3047702,
      relationId: "rel_mais"
    });
    expect(params).toEqual({
      __interactive: { flow: "contaazul_service_sale_boleto", action: "start_with_customer" },
      tenantId: 3047702,
      relationId: "rel_mais",
      customerId: "new_cust",
      customerName: "MARIA SILVA"
    });
  });

  it("renders the boleto offer after a successful cadastro", () => {
    const html = renderToString(
      <AssistantResultMessage
        message={{
          id: "m",
          role: "assistant",
          timestamp: "21:11",
          result: {
            status: "executed",
            toolName: "contaazul.create_customer_workflow",
            receiptStatus: "succeeded",
            missingFields: [],
            questions: [],
            warnings: [],
            approvalAvailable: false,
            receiptData: { resolved: { customerId: "new_cust", customerName: "MARIA SILVA", tenantId: 3047702, relationId: "rel_mais" } }
          }
        }}
        isLatest
        onReview={() => undefined}
        onSend={() => undefined}
      />
    );
    expect(html).toContain("Deseja emitir um novo boleto");
    expect(html).toContain("Sim, emitir boleto");
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
