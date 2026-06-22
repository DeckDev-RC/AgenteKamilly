import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Command,
  Loader2,
  Paperclip,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";

import type { OperationSummary } from "../../core/operation-summary.js";
import type { AgentResultView, ConfirmationSheetView } from "../../server/api-types.js";
import { executeOperation, getConfirmationSheet, getOperation, runAgentTurn } from "../api.js";
import { ConfirmationSheet } from "../components/ConfirmationSheet.js";
import { PixelynAvatar } from "../components/PixelynAvatar.js";
import { PlanCard, type PlanFacts } from "../components/PlanCard.js";
import {
  pixelynStateFromResult,
  type PixelynPhase,
  type PixelynState
} from "../lib/pixelyn-state.js";

type ChatMessage =
  | {
      id: string;
      role: "user";
      text: string;
      timestamp: string;
    }
  | {
      id: string;
      role: "assistant";
      result: AgentResultView;
      operation?: OperationSummary;
      draftOperationId?: string;
      timestamp: string;
    };

const ANCHORED_OPERATIONS: { label: string; action: string }[] = [
  { label: "Mudar boleto · Asaas", action: "start_asaas_update_due_date" },
  { label: "Emitir boleto · Conta Azul", action: "start_contaazul_service_sale" },
  { label: "Criar cliente · Conta Azul", action: "start_contaazul_create_customer" },
  { label: "Mudar vencimento · Conta Azul", action: "start_contaazul_update_due_date" }
];

const DEFAULT_PENDING_FIELDS = ["Cliente", "Valor", "Vencimento", "Plataforma"];

const FIELD_LABELS: Record<string, string> = {
  customerName: "Cliente",
  customer: "Cliente",
  value: "Valor da cobrança",
  unitValue: "Valor da cobrança",
  dueDate: "Vencimento",
  dueDateIso: "Vencimento",
  provider: "Plataforma",
  module: "Plataforma",
  description: "Descrição",
  tenantId: "Empresa",
  categoryName: "Categoria",
  itemName: "Item",
  personType: "Tipo de pessoa",
  document: "CPF ou CNPJ",
  name: "Nome completo",
  companyName: "Razão social",
  email: "E-mail",
  commercialPhone: "Telefone comercial",
  cellPhone: "Celular do cliente",
  zipcode: "CEP",
  street: "Rua/Avenida",
  numberAddress: "Número",
  neighborhood: "Bairro",
  complement: "Complemento",
  billingEmail: "E-mail de cobrança",
  billingPhone: "Telefone de cobrança",
  createBoleto: "Gerar boleto?",
  dueDateBr: "Vencimento",
  unitValueBr: "Valor unitário",
  serviceDescription: "Descrição do serviço",
  "notification.email": "E-mail de cobrança",
  operatorConfirmation: "Confirmação de segurança"
};

export function buildBoletoHandoffParams(resolved: {
  customerId?: string;
  customerName?: string;
  tenantId?: string | number;
  relationId?: string;
}): Record<string, unknown> {
  return {
    __interactive: { flow: "contaazul_service_sale_boleto", action: "start_with_customer" },
    tenantId: resolved.tenantId,
    relationId: resolved.relationId,
    customerId: resolved.customerId,
    customerName: resolved.customerName
  };
}

function createSessionId(): string {
  return `confere_${Date.now()}`;
}

function createMessageId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function timeLabel(): string {
  return new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function factsFromOperation(
  operation: OperationSummary | undefined,
  result: AgentResultView
): PlanFacts {
  return {
    customerName: operation?.customerName,
    value: formatMoney(operation?.unitValue),
    dueDate: formatDate(operation?.dueDateIso),
    action: result.toolName?.includes("asaas")
      ? "Gerar boleto · Asaas"
      : result.toolName?.includes("contaazul")
        ? "Venda + boleto · Conta Azul"
        : "Preparar cobrança"
  };
}

function formatMoney(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    return value.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });
  }
  const clean = value.trim();
  if (!clean) return undefined;
  return clean.startsWith("R$") ? clean : `R$ ${clean}`;
}

function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatField(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function statusLabel(
  result: AgentResultView | undefined,
  phase: PixelynPhase
): { label: string; tone: "idle" | "working" | "ready" | "blocked" | "done" } {
  if (phase === "preparing") return { label: "Pensando", tone: "working" };
  if (phase === "executing") return { label: "Executando", tone: "working" };
  if (!result) return { label: "Em preparo", tone: "idle" };
  if (result.status === "needs_input") return { label: "Aguardando dados", tone: "working" };
  if (result.status === "planned") return { label: "Pronto para revisão", tone: "ready" };
  if (result.status === "executed") return { label: "Executado", tone: "done" };
  return { label: "Bloqueado", tone: "blocked" };
}

function moduleSuggestion(result: AgentResultView | undefined): "asaas" | "contaazul" | undefined {
  if (result?.toolName?.includes("asaas")) return "asaas";
  if (result?.toolName?.includes("contaazul")) return "contaazul";
  return undefined;
}

function assistantFallback(result: AgentResultView): string {
  if (result.status === "needs_input") {
    return "Preciso de alguns dados para preparar a operação.";
  }
  if (result.status === "planned") {
    return "Preparei um dry-run para revisão.";
  }
  if (result.status === "executed") {
    return "Execução registrada.";
  }
  if (result.reason) return result.reason;
  return "Não consegui prosseguir com segurança.";
}

function UserMessage(props: { text: string; timestamp: string }): ReactElement {
  return (
    <article className="chat-message chat-message--user">
      <div className="chat-message__body chat-message__body--user">
        <p>{props.text}</p>
      </div>
      <span className="chat-message__time">{props.timestamp}</span>
    </article>
  );
}

export function AssistantResultMessage(props: {
  message: Extract<ChatMessage, { role: "assistant" }>;
  isLatest: boolean;
  onReview: (operationId: string) => void;
  onSend: (text: string, params?: Record<string, unknown>) => void;
}): ReactElement {
  const result = props.message.result;
  const summary = result.summary ?? assistantFallback(result);
  const hasQuestions = result.questions.length > 0;

  const isSearchFinancial = result.toolName === "contaazul.search_financial_statement";
  const financialItems = (isSearchFinancial && Array.isArray(result.receiptData))
    ? result.receiptData
    : [];

  const isCreateCustomer = result.toolName === "contaazul.create_customer_workflow";
  const resolvedCustomer = (isCreateCustomer && result.receiptStatus === "succeeded" && result.receiptData && typeof result.receiptData === "object")
    ? (result.receiptData as any).resolved
    : undefined;

  function handleUpdateDueDate(item: any) {
    const newDate = window.prompt(
      `Digite o novo vencimento para o lançamento "${item.description}" no valor de ${formatMoney(item.value)} (DD/MM/AAAA):`,
      ""
    );
    if (!newDate) return;
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(newDate)) {
      alert("Formato de data inválido! Use DD/MM/AAAA.");
      return;
    }
    const [day, month, year] = newDate.split("/");
    const dueDateIso = `${year}-${month}-${day}`;

    props.onSend(`Alterar o vencimento para ${newDate}`, {
      financialEventId: item.financialEventId,
      installmentId: item.installmentId || item.id,
      dueDateIso
    });
  }

  return (
    <article className="chat-message chat-message--assistant">
      <PixelynAvatar state={pixelynStateFromResult(result, "idle")} size={42} />
      <div className="chat-message__stack">
        <header className="chat-message__meta">
          <strong>Pixelyn</strong>
          <span>{props.message.timestamp}</span>
        </header>
        <div className="chat-message__body chat-message__body--assistant">
          <p className="assistant__say">{summary}</p>
          {hasQuestions ? (
            <QuestionChecklist
              questions={result.questions}
              missingFields={result.missingFields}
            />
          ) : null}
          {result.warnings.length > 0 ? (
            <div className="warning-list">
              {result.warnings.map((warning) => (
                <p className="assistant__warn" key={warning}>
                  <AlertTriangle aria-hidden="true" size={14} />
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          {result.choices && result.choices.length > 0 ? (
            <div className="choice-actions" aria-label="Escolhas disponíveis">
              {result.choices.map((choice) => (
                <button
                  className="choice-action"
                  key={choice.id}
                  onClick={() => props.onSend(choice.request ?? choice.label, choice.params)}
                  type="button"
                >
                  <span>{choice.label}</span>
                  {choice.description ? <small>{choice.description}</small> : null}
                </button>
              ))}
            </div>
          ) : null}

          {/* Candidates / Ambiguity choice chips */}
          {result.candidates && result.candidates.length > 0 ? (
            <div className="candidates-container" style={{ marginTop: "12px" }}>
              <p style={{ fontWeight: 600, fontSize: "0.9em", marginBottom: "8px" }}>
                Múltiplas opções para {formatField(result.fieldName || "")}:
              </p>
              <div className="candidates-chips" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {result.candidates.map((candidate) => (
                  <button
                    key={candidate}
                    className="composer-chip"
                    style={{
                      cursor: "pointer",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-color, #e0e0e0)",
                      backgroundColor: "var(--bg-card, #f5f5f5)",
                      color: "var(--text-color, #333)",
                      fontSize: "0.85em",
                      fontWeight: 500
                    }}
                    onClick={() => props.onSend(candidate)}
                    type="button"
                  >
                    {candidate}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Financial Statement Extrato Table */}
          {financialItems.length > 0 ? (
            <div className="extrato-container" style={{ marginTop: "16px", overflowX: "auto" }}>
              <table className="extrato-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85em", textAlign: "left" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #ddd", color: "#666" }}>
                    <th style={{ padding: "8px" }}>Vencimento</th>
                    <th style={{ padding: "8px" }}>Cliente</th>
                    <th style={{ padding: "8px" }}>Descrição</th>
                    <th style={{ padding: "8px" }}>Valor</th>
                    <th style={{ padding: "8px" }}>Status</th>
                    <th style={{ padding: "8px" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {financialItems.map((item: any) => (
                    <tr key={item.id} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "8px" }}>{formatDate(item.dueDateIso) || "--"}</td>
                      <td style={{ padding: "8px" }}>{item.customerName || "--"}</td>
                      <td style={{ padding: "8px" }}>{item.description || "--"}</td>
                      <td style={{ padding: "8px" }}>{formatMoney(item.value) || "--"}</td>
                      <td style={{ padding: "8px" }}>
                        <span style={{
                          padding: "2px 6px",
                          borderRadius: "4px",
                          fontSize: "0.8em",
                          backgroundColor: item.status === "PAID" || item.status === "ACQUITTED" ? "#e6f4ea" : "#fce8e6",
                          color: item.status === "PAID" || item.status === "ACQUITTED" ? "#137333" : "#c5221f"
                        }}>
                          {item.status === "PAID" || item.status === "ACQUITTED" ? "Pago" : "Pendente"}
                        </span>
                      </td>
                      <td style={{ padding: "8px" }}>
                        <button
                          className="composer-chip"
                          style={{
                            cursor: "pointer",
                            padding: "4px 8px",
                            borderRadius: "4px",
                            border: "1px solid #1a73e8",
                            backgroundColor: "transparent",
                            color: "#1a73e8",
                            fontSize: "0.9em",
                            fontWeight: 500
                          }}
                          onClick={() => handleUpdateDueDate(item)}
                          type="button"
                        >
                          Alterar Vencimento
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* Customer Created Followup */}
          {resolvedCustomer ? (
            <div className="followup-container" style={{ marginTop: "16px", padding: "12px", border: "1px solid #1a73e8", borderRadius: "8px", backgroundColor: "#f8faff" }}>
              <p style={{ fontWeight: 600, color: "#1a73e8", marginBottom: "8px" }}>
                Cadastro concluído com sucesso para "{resolvedCustomer.customerName}".
              </p>
              <p style={{ fontSize: "0.9em", marginBottom: "12px" }}>
                Deseja emitir um novo boleto de serviço para este cliente agora?
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className="composer-chip"
                  style={{
                    cursor: "pointer",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #1a73e8",
                    backgroundColor: "#1a73e8",
                    color: "#fff",
                    fontSize: "0.85em",
                    fontWeight: 500
                  }}
                  onClick={() => props.onSend("Emitir boleto de serviço", buildBoletoHandoffParams(resolvedCustomer))}
                  type="button"
                >
                  Sim, emitir boleto
                </button>
                <button
                  className="composer-chip"
                  style={{
                    cursor: "pointer",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #ccc",
                    backgroundColor: "#fff",
                    color: "#666",
                    fontSize: "0.85em",
                    fontWeight: 500
                  }}
                  onClick={() => props.onSend("Não, obrigado")}
                  type="button"
                >
                  Não, apenas cadastrar
                </button>
              </div>
            </div>
          ) : null}

          {props.message.draftOperationId ? (
            <PlanCard
              approvalAvailable={result.approvalAvailable}
              facts={factsFromOperation(props.message.operation, result)}
              onApprove={() => props.onReview(props.message.draftOperationId!)}
              technicalDetail={
                props.message.operation ? JSON.stringify(props.message.operation, null, 2) : undefined
              }
            />
          ) : null}
          {hasQuestions ? (
            <p className="assistant__hint">Você pode responder os campos em qualquer ordem.</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

const FIELD_QUESTIONS: Record<string, string> = {
  tenantId: "Selecione a empresa contábil no Conta Azul.",
  customerName: "Busque e selecione o cliente.",
  categoryName: "Busque e selecione a categoria de receita.",
  itemName: "Busque e selecione o item de serviço.",
  personType: "O cliente é Pessoa Física ou Jurídica?",
  document: "Informe o CPF ou CNPJ do cliente.",
  valueBr: "Informe o valor da cobrança.",
  dueDateBr: "Informe a data de vencimento.",
  dueDateIso: "Informe a data de vencimento.",
  serviceDescription: "Informe a descrição do serviço.",
  "notification.email": "Informe o e-mail de cobrança do cliente.",
  name: "Qual o nome completo do cliente?",
  companyName: "Qual a razão social da empresa?",
  email: "Qual o e-mail do cliente?",
  commercialPhone: "Qual o telefone comercial do cliente?",
  cellPhone: "Qual o celular do cliente?",
  zipcode: "Qual o CEP do endereço?",
  street: "Qual a rua/avenida?",
  numberAddress: "Qual o número do endereço?",
  neighborhood: "Qual o bairro?",
  complement: "Qual o complemento do endereço?",
  billingEmail: "Qual o e-mail de cobrança?",
  billingPhone: "Qual o telefone de cobrança?"
};

function getFriendlyQuestion(field: string, fallback: string): string {
  return FIELD_QUESTIONS[field] ?? fallback;
}

function QuestionChecklist(props: {
  questions: string[];
  missingFields: string[];
}): ReactElement {
  return (
    <div className="question-list" aria-label="Campos faltantes">
      {props.questions.map((question, index) => {
        const fieldName = props.missingFields[index] ?? `Campo ${index + 1}`;
        return (
          <div className="question-list__item" key={fieldName} style={{ display: "flex", width: "100%", alignItems: "center", gap: "10px" }}>
            <span className="question-list__index">{index + 1}</span>
            <div style={{ flex: 1 }}>
              <strong>{formatField(fieldName)}</strong>
              <p>{getFriendlyQuestion(fieldName, question)}</p>
            </div>
            <span className="question-list__tag">pendente</span>
          </div>
        );
      })}
    </div>
  );
}

function TypingIndicator(): ReactElement {
  return (
    <article className="chat-message chat-message--assistant chat-message--typing">
      <PixelynAvatar state="pensando" size={42} />
      <div className="typing-pill">
        <Loader2 aria-hidden="true" size={15} />
        Pixelyn está preparando...
        <span className="typing-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </article>
  );
}

function OperationContextPanel(props: {
  result: AgentResultView | undefined;
  operation: OperationSummary | undefined;
  draftOperationId: string | undefined;
  phase: PixelynPhase;
}): ReactElement {
  const status = statusLabel(props.result, props.phase);
  const suggested = moduleSuggestion(props.result);
  const pendingFields = props.result?.missingFields.length
    ? props.result.missingFields.map(formatField)
    : props.result
      ? []
      : DEFAULT_PENDING_FIELDS;

  return (
    <aside className="operation-panel">
      <header className="operation-panel__header">
        <div>
          <h2>Operação em preparo</h2>
          <p>Rascunho seguro antes de qualquer execução real.</p>
        </div>
        <Sparkles aria-hidden="true" size={18} />
      </header>

      <section className="operation-panel__section">
        <div className="operation-status">
          <span>Status atual</span>
          <strong className={`operation-status__badge operation-status__badge--${status.tone}`}>
            <CircleDot aria-hidden="true" size={12} />
            {status.label}
          </strong>
        </div>
        <div className="operation-id">
          <span>ID da operação</span>
          <code>{props.draftOperationId ?? props.operation?.operationId ?? "ainda não gerada"}</code>
        </div>
      </section>

      <section className="operation-panel__section">
        <h3>Módulo sugerido</h3>
        <div className="module-choice">
          <div className={`module-choice__item ${suggested === "asaas" ? "module-choice__item--active" : ""}`}>
            <span className="module-choice__mark module-choice__mark--asaas">A</span>
            <div>
              <strong>Asaas</strong>
              <p>Boletos e cobranças</p>
            </div>
            <CheckCircle2 aria-hidden="true" size={16} />
          </div>
          <div className={`module-choice__item ${suggested === "contaazul" ? "module-choice__item--active" : ""}`}>
            <span className="module-choice__mark module-choice__mark--contaazul">C</span>
            <div>
              <strong>Conta Azul</strong>
              <p>Vendas e boleto</p>
            </div>
            <CheckCircle2 aria-hidden="true" size={16} />
          </div>
        </div>
      </section>

      <section className="operation-panel__section">
        <div className="section-title-row">
          <h3>Campos pendentes</h3>
          <span>{pendingFields.length === 0 ? "ok" : `${pendingFields.length}`}</span>
        </div>
        <ol className="pending-list">
          {pendingFields.length > 0 ? (
            pendingFields.map((field, index) => (
              <li key={`${field}-${index}`}>
                <span>{index + 1}</span>
                {field}
              </li>
            ))
          ) : (
            <li className="pending-list__done">
              <CheckCircle2 aria-hidden="true" size={15} />
              Nenhum campo pendente
            </li>
          )}
        </ol>
      </section>

      <section className="security-card">
        <ShieldCheck aria-hidden="true" size={19} />
        <div>
          <strong>Gate de segurança</strong>
          <p>Dry-run primeiro. A execução real continua exigindo confirmação final.</p>
        </div>
        <span>Protegido</span>
      </section>

      <section className="operation-preview">
        <h3>Prévia da operação</h3>
        <div className="operation-preview__body">
          <ClipboardList aria-hidden="true" size={22} />
          <div>
            <strong>{props.result?.toolName?.includes("contaazul") ? "Venda + boleto" : "Boleto avulso"}</strong>
            <p>{suggested === "contaazul" ? "Conta Azul" : suggested === "asaas" ? "Asaas" : "Aguardando módulo"}</p>
          </div>
        </div>
        <dl className="operation-preview__facts">
          <div>
            <dt>Cliente</dt>
            <dd>{props.operation?.customerName ?? "--"}</dd>
          </div>
          <div>
            <dt>Valor</dt>
            <dd>{formatMoney(props.operation?.unitValue) ?? "R$ --,--"}</dd>
          </div>
          <div>
            <dt>Vencimento</dt>
            <dd>{formatDate(props.operation?.dueDateIso) ?? "--/--/----"}</dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}

export function AssistantScreen(props: {
  onPixelynState?: (state: PixelynState) => void;
}): ReactElement {
  const [request, setRequest] = useState("");
  const [sessionId, setSessionId] = useState(createSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [result, setResult] = useState<AgentResultView | undefined>();
  const [draftOperationId, setDraftOperationId] = useState<string | undefined>();
  const [operation, setOperation] = useState<OperationSummary | undefined>();
  const [confirmationSheet, setConfirmationSheet] = useState<ConfirmationSheetView | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phase, setPhase] = useState<PixelynPhase>("idle");
  const [error, setError] = useState<string | undefined>();
  const threadRef = useRef<HTMLDivElement>(null);

  const pixelynState = pixelynStateFromResult(result, phase);
  useEffect(() => {
    props.onPixelynState?.(pixelynState);
  }, [pixelynState, props.onPixelynState]);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [messages.length, phase, error]);

  function resetConversation(): void {
    setSessionId(createSessionId());
    setMessages([]);
    setRequest("");
    setResult(undefined);
    setDraftOperationId(undefined);
    setOperation(undefined);
    setConfirmationSheet(undefined);
    setConfirmOpen(false);
    setError(undefined);
    setPhase("idle");
  }

  async function prepare(customText?: string, customParams?: Record<string, unknown>): Promise<void> {
    const content = (customText !== undefined ? customText : request).trim();
    if (!content || phase !== "idle") return;

    setMessages((current) => [
      ...current,
      {
        id: createMessageId("user"),
        role: "user",
        text: content,
        timestamp: timeLabel()
      }
    ]);
    if (customText === undefined) {
      setRequest("");
    }
    setPhase("preparing");
    setError(undefined);
    setConfirmOpen(false);
    setConfirmationSheet(undefined);

    try {
      const mergedParams = { ...customParams };
      const response = await runAgentTurn({ request: content, sessionId, params: mergedParams });
      let nextOperation: OperationSummary | undefined;
      if (response.draftOperationId) {
        const summary = await getOperation(response.draftOperationId);
        nextOperation = summary.operation;
      }

      setResult(response.result);
      setDraftOperationId(response.draftOperationId);
      setOperation(nextOperation);
      setMessages((current) => [
        ...current,
        {
          id: createMessageId("assistant"),
          role: "assistant",
          result: response.result,
          operation: nextOperation,
          draftOperationId: response.draftOperationId,
          timestamp: timeLabel()
        }
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao preparar operação.");
    } finally {
      setPhase("idle");
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void prepare();
    }
  }

  async function reviewExecution(operationId: string): Promise<void> {
    setDraftOperationId(operationId);
    setError(undefined);
    try {
      const sheetResponse = await getConfirmationSheet(operationId);
      if (sheetResponse.status === "blocked") {
        setError(sheetResponse.reason);
        return;
      }
      setConfirmationSheet(sheetResponse.sheet);
      setConfirmOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar confirmação.");
    }
  }

  async function approve(): Promise<void> {
    if (!draftOperationId) return;
    setPhase("executing");
    setError(undefined);
    try {
      const executed = await executeOperation(draftOperationId);
      if (executed.status === "blocked") {
        setError(executed.reason);
        return;
      }

      setOperation(executed.operation);
      setResult((previous) =>
        previous ? { ...previous, status: "executed", receiptStatus: executed.receiptStatus } : previous
      );
      setMessages((current) =>
        current.map((message) =>
          message.role === "assistant" && message.draftOperationId === draftOperationId
            ? {
                ...message,
                result: {
                  ...message.result,
                  status: "executed",
                  receiptStatus: executed.receiptStatus
                },
                operation: executed.operation,
                draftOperationId: undefined
              }
            : message
        )
      );
      setConfirmOpen(false);
      setDraftOperationId(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao executar operação.");
    } finally {
      setPhase("idle");
    }
  }

  return (
    <section className="assistant">
      <div className="assistant__workspace">
        <header className="assistant__top">
          <div>
            <div className="assistant__title">Conversa</div>
            <p className="assistant__subtitle">Seu assistente de operações financeiras.</p>
          </div>
          <button className="assistant__reset" onClick={resetConversation} type="button">
            <RotateCcw aria-hidden="true" size={15} />
            Nova conversa
          </button>
        </header>

        <div className="assistant__thread" ref={threadRef}>
          {messages.length === 0 ? (
            <div className="assistant__greeting">
              <PixelynAvatar state={pixelynState} size={72} />
              <div>
                <h1>E aí, o que vamos resolver hoje?</h1>
                <p>Descreva a cobrança, a venda ou o boleto que eu preparo o rascunho.</p>
                <div className="assistant__starter-grid">
                  {ANCHORED_OPERATIONS.map((op) => (
                    <button
                      key={op.action}
                      onClick={() =>
                        void prepare(op.label, { __interactive: { flow: "anchor", action: op.action } })
                      }
                      type="button"
                    >
                      {op.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {messages.map((message, idx) =>
            message.role === "user" ? (
              <UserMessage key={message.id} text={message.text} timestamp={message.timestamp} />
            ) : (
              <AssistantResultMessage
                key={message.id}
                message={message}
                isLatest={idx === messages.length - 1}
                onReview={(operationId) => void reviewExecution(operationId)}
                onSend={(text, params) => void prepare(text, params)}
              />
            )
          )}

          {phase === "preparing" ? <TypingIndicator /> : null}
          {error ? <div className="notice notice--danger">{error}</div> : null}
        </div>

        <div className="assistant__composer">
          <textarea
            aria-label="Descreva o que você precisa"
            className="assistant__input"
            onChange={(event) => setRequest(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Descreva o que você precisa..."
            rows={2}
            value={request}
          />
          <div className="composer-toolbar">
            <div className="composer-toolbar__left">
              <button className="composer-chip" type="button">
                <Paperclip aria-hidden="true" size={14} />
                Anexar
              </button>
              <button
                className="composer-chip"
                onClick={() => setRequest(ANCHORED_OPERATIONS[0]!.label)}
                type="button"
              >
                /
                Atalhos
              </button>
              <span className="composer-shortcut">
                <Command aria-hidden="true" size={12} />
                Ctrl + Enter
              </span>
            </div>
            <button
              className="composer-send"
              disabled={!request.trim() || phase !== "idle"}
              onClick={() => void prepare()}
              type="button"
            >
              Enviar
              <Send aria-hidden="true" size={17} />
            </button>
          </div>
        </div>
      </div>

      <OperationContextPanel
        draftOperationId={draftOperationId}
        operation={operation}
        phase={phase}
        result={result}
      />

      <ConfirmationSheet
        busy={phase === "executing"}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void approve()}
        open={confirmOpen}
        sheet={confirmationSheet}
      />
    </section>
  );
}
