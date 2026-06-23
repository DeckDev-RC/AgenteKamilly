import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Command,
  CornerDownLeft,
  FileDown,
  FileText,
  Loader2,
  Receipt,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";

import type { OperationSummary } from "../../core/operation-summary.js";
import type { Artifact } from "../../core/tool-types.js";
import type { AgentResultView, ConfirmationSheetView } from "../../server/api-types.js";
import { executeOperation, getConfirmationSheet, getOperation, runAgentTurn } from "../api.js";
import { ConfirmationSheet } from "../components/ConfirmationSheet.js";
import { ChoiceSearchPicker } from "../components/ChoiceSearchPicker.js";
import { ChoiceSelectList } from "../components/ChoiceSelectList.js";
import { ChatInlineForm } from "../components/ChatInlineForm.js";
import { PixelynAvatar } from "../components/PixelynAvatar.js";
import { PlanCard, type PlanFacts } from "../components/PlanCard.js";
import {
  pixelynStateFromResult,
  type PixelynPhase,
  type PixelynState
} from "../lib/pixelyn-state.js";
import { inferChoicePicker } from "../lib/choice-picker.js";
import { inferInlineForm } from "../lib/inline-form.js";

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

const ANCHORED_OPERATIONS: { label: string; action: string; icon: LucideIcon; hint: string }[] = [
  {
    label: "Baixar boleto · Asaas",
    action: "start_asaas_download_boleto",
    icon: FileDown,
    hint: "Buscar cobrança existente e baixar o PDF"
  },
  {
    label: "Mudar boleto · Asaas",
    action: "start_asaas_update_due_date",
    icon: CalendarClock,
    hint: "Reagendar vencimento de uma cobrança"
  },
  {
    label: "Emitir boleto · Conta Azul",
    action: "start_contaazul_service_sale",
    icon: Receipt,
    hint: "Venda de serviço com boleto"
  },
  {
    label: "Criar cliente · Conta Azul",
    action: "start_contaazul_create_customer",
    icon: UserPlus,
    hint: "Cadastrar um novo cliente"
  },
  {
    label: "Mudar vencimento · Conta Azul",
    action: "start_contaazul_update_due_date",
    icon: CalendarClock,
    hint: "Ajustar a data de um lançamento"
  }
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
  chargeIds: "Cobranças pendentes",
  chargeId: "Cobrança",
  operation: "Operação",
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

function isDownloadBoletoIntent(result?: AgentResultView): boolean {
  return (
    result?.intent === "download_boleto" ||
    result?.intent === "download_boleto_pdf" ||
    Boolean(result?.toolName?.includes("download_boleto"))
  );
}

function factsFromOperation(
  operation: OperationSummary | undefined,
  result: AgentResultView
): PlanFacts {
  const action = planActionLabel(result);
  const receiptData = asReceiptRecord(result.receiptData);
  const approvalPreview = asReceiptRecord(receiptData?.approvalPreview);
  const changes = Array.isArray(approvalPreview?.changes) ? approvalPreview.changes : [];
  const dueDateChange = changes.find(
    (change) => change && typeof change === "object" && (change as { field?: string }).field === "dueDate"
  ) as { to?: string } | undefined;

  return {
    customerName: operation?.customerName ?? stringValue(receiptData?.customerName),
    value: formatMoney(operation?.unitValue),
    dueDate:
      formatDate(operation?.dueDateIso) ??
      formatDateBr(stringValue(dueDateChange?.to)) ??
      formatDateBr(stringValue(receiptData?.dueDateBr)),
    action
  };
}

function planActionLabel(result: AgentResultView): string {
  if (result.intent === "update_charge_due_date") {
    return result.provider === "asaas" ? "Alterar vencimento · Asaas" : "Alterar vencimento";
  }
  if (result.intent === "download_boleto" || result.intent === "download_boleto_pdf" || result.toolName?.includes("download")) {
    return "Baixar boleto · Asaas";
  }
  if (result.toolName?.includes("asaas")) return "Gerar boleto · Asaas";
  if (result.toolName?.includes("contaazul")) return "Venda + boleto · Conta Azul";
  return "Preparar cobrança";
}

function asReceiptRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function formatDateBr(value: string | undefined): string | undefined {
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
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

function isLiveSuccess(result?: AgentResultView, operation?: OperationSummary): boolean {
  return result?.receiptStatus === "succeeded" || operation?.latestStatus === "succeeded";
}

function isLiveFailure(result?: AgentResultView, operation?: OperationSummary): boolean {
  return result?.receiptStatus === "failed" || operation?.latestStatus === "failed";
}

type DueDateUpdateDetails = {
  customerName?: string;
  chargeId?: string;
  dueDateBr?: string;
};

type DownloadBoletoDetails = {
  customerName?: string;
  chargeId?: string;
  chargeLabel?: string;
  valueBr?: string;
  dueDateBr?: string;
};

function resolveDownloadBoletoDetails(
  result: AgentResultView,
  operation?: OperationSummary
): DownloadBoletoDetails {
  const receiptData = asReceiptRecord(result.receiptData);

  return {
    customerName: operation?.customerName ?? stringValue(receiptData?.customerName),
    chargeId: operation?.chargeId ?? stringValue(receiptData?.chargeId),
    chargeLabel: stringValue(receiptData?.chargeLabel),
    valueBr:
      formatMoney(operation?.unitValue) ??
      stringValue(receiptData?.valueBr),
    dueDateBr:
      operation?.dueDateBr ??
      formatDate(operation?.dueDateIso) ??
      stringValue(receiptData?.dueDateBr)
  };
}

function resolveDueDateUpdateDetails(
  result: AgentResultView,
  operation?: OperationSummary
): DueDateUpdateDetails {
  const receiptData = asReceiptRecord(result.receiptData);
  const approvalPreview = asReceiptRecord(receiptData?.approvalPreview);
  const target = asReceiptRecord(approvalPreview?.target);
  const changes = Array.isArray(approvalPreview?.changes) ? approvalPreview.changes : [];
  const dueDateChange = changes.find(
    (change) => change && typeof change === "object" && (change as { field?: string }).field === "dueDate"
  ) as { to?: string } | undefined;

  return {
    customerName: operation?.customerName ?? stringValue(receiptData?.customerName),
    chargeId:
      operation?.chargeId ??
      stringValue(target?.chargeId) ??
      stringValue(receiptData?.chargeId),
    dueDateBr:
      operation?.dueDateBr ??
      operation?.dueDateIso ??
      formatDateBr(stringValue(dueDateChange?.to)) ??
      formatDateBr(stringValue(receiptData?.dueDateBr))
  };
}

function operationSuccessMessage(result: AgentResultView, operation?: OperationSummary): string {
  if (result.intent === "update_charge_due_date") {
    const details = resolveDueDateUpdateDetails(result, operation);
    const hasPdf =
      (operation?.artifacts ?? []).some((artifact) => artifact.kind === "pdf") ||
      artifactsFromReceiptData(result.receiptData).some((artifact) => artifact.kind === "pdf");

    if (details.chargeId && details.dueDateBr) {
      const who = details.customerName ? ` de ${details.customerName}` : "";
      if (hasPdf) {
        return `Vencimento alterado com sucesso${who}! Cobrança ${details.chargeId} agora vence em ${details.dueDateBr}. Baixe o PDF atualizado abaixo.`;
      }
      return `Vencimento alterado com sucesso${who}! Cobrança ${details.chargeId} agora vence em ${details.dueDateBr}.`;
    }
    return operation?.summary ?? result.summary ?? "Vencimento atualizado no Asaas.";
  }

  if (isDownloadBoletoIntent(result)) {
    const details = resolveDownloadBoletoDetails(result, operation);
    const who = details.customerName ? ` de ${details.customerName}` : "";
    const chargeRef = details.chargeId ? ` (cobrança ${details.chargeId})` : "";
    return `PDF do boleto${who}${chargeRef} baixado com sucesso. Abra o arquivo abaixo.`;
  }

  const sale = operation?.saleNumber;
  return sale
    ? `Boleto emitido com sucesso! Venda nº ${sale}. Baixe o PDF abaixo.`
    : "Boleto emitido com sucesso! Baixe o PDF abaixo.";
}

function operationFailureMessage(result: AgentResultView, operation?: OperationSummary): string {
  if (result.intent === "update_charge_due_date") {
    return operation?.summary ?? "Não foi possível alterar o vencimento no Asaas.";
  }
  if (isDownloadBoletoIntent(result)) {
    return operation?.summary ?? result.summary ?? "Não foi possível baixar o PDF do boleto.";
  }
  return operation?.summary ?? "A emissão falhou. Veja os detalhes abaixo ou no histórico de operações.";
}

function messageSummary(result: AgentResultView, operation?: OperationSummary): string {
  if (isLiveSuccess(result, operation)) {
    return operationSuccessMessage(result, operation);
  }
  if (isLiveFailure(result, operation)) {
    return operationFailureMessage(result, operation);
  }
  if (result.receiptStatus === "planned") {
    if (result.intent === "update_charge_due_date") {
      return "Dry-run concluído. Revise os dados e aprove para alterar o vencimento e baixar o boleto atualizado.";
    }
    if (isDownloadBoletoIntent(result)) {
      return "PDF do boleto preparado. Abra o arquivo abaixo.";
    }
    return "Dry-run concluído. Revise os dados e aprove para emitir o boleto de verdade.";
  }
  return result.summary ?? assistantFallback(result);
}

function statusLabel(
  result: AgentResultView | undefined,
  phase: PixelynPhase,
  operation?: OperationSummary
): { label: string; tone: "idle" | "working" | "ready" | "blocked" | "done" } {
  if (phase === "preparing") return { label: "Pensando", tone: "working" };
  if (phase === "executing") {
    if (result?.intent === "update_charge_due_date") {
      return { label: "Alterando vencimento…", tone: "working" };
    }
    if (isDownloadBoletoIntent(result)) {
      return { label: "Baixando PDF…", tone: "working" };
    }
    return { label: "Emitindo boleto…", tone: "working" };
  }
  if (operation?.latestStatus === "succeeded" || result?.receiptStatus === "succeeded") {
    return { label: "Concluído", tone: "done" };
  }
  if (operation?.latestStatus === "failed" || result?.receiptStatus === "failed") {
    return { label: "Falhou", tone: "blocked" };
  }
  if (!result) return { label: "Em preparo", tone: "idle" };
  if (result.status === "needs_input") return { label: "Aguardando dados", tone: "working" };
  if (result.receiptStatus === "planned") {
    if (isDownloadBoletoIntent(result)) {
      return { label: "PDF pronto", tone: "done" };
    }
    return { label: "Aguardando aprovação", tone: "ready" };
  }
  if (result.status === "planned") return { label: "Pronto para revisão", tone: "ready" };
  if (result.status === "executed") return { label: "Registrado", tone: "done" };
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
  if (result.status === "executed" && result.receiptStatus === "planned") {
    if (result.intent === "update_charge_due_date") {
      return "Dry-run concluído. Revise os dados e aprove para alterar o vencimento e baixar o boleto atualizado.";
    }
    if (isDownloadBoletoIntent(result)) {
      return "PDF do boleto preparado. Abra o arquivo abaixo.";
    }
    return "Dry-run concluído. Revise os dados e aprove para emitir o boleto de verdade.";
  }
  if (result.status === "executed" && isDownloadBoletoIntent(result)) {
    return result.summary ?? "PDF do boleto baixado com sucesso.";
  }
  if (result.status === "executed") {
    return "Execução registrada.";
  }
  if (result.status === "blocked") {
    return result.summary ?? "Não consegui prosseguir com segurança. Escolha uma operação no menu ou descreva o pedido com mais detalhes.";
  }
  if (result.reason) return result.reason;
  return "Não consegui prosseguir com segurança.";
}

function DueDateUpdateResultCard(props: {
  result: AgentResultView;
  operation?: OperationSummary;
}): ReactElement | null {
  if (props.result.intent !== "update_charge_due_date" || !isLiveSuccess(props.result, props.operation)) {
    return null;
  }

  const details = resolveDueDateUpdateDetails(props.result, props.operation);
  if (!details.chargeId && !details.dueDateBr) return null;

  const pdfArtifacts = [
    ...(props.operation?.artifacts ?? []),
    ...artifactsFromReceiptData(props.result.receiptData)
  ].filter((artifact) => artifact.kind === "pdf");

  return (
    <div className="followup followup--success">
      <p className="followup__title">
        <CheckCircle2 aria-hidden="true" size={16} />
        Alteração registrada no Asaas
      </p>
      <dl className="operation-preview__facts operation-preview__facts--inline">
        {details.customerName ? (
          <div>
            <dt>Cliente</dt>
            <dd>{details.customerName}</dd>
          </div>
        ) : null}
        {details.chargeId ? (
          <div>
            <dt>Cobrança</dt>
            <dd>{details.chargeId}</dd>
          </div>
        ) : null}
        {details.dueDateBr ? (
          <div>
            <dt>Novo vencimento</dt>
            <dd>{details.dueDateBr}</dd>
          </div>
        ) : null}
      </dl>
      {pdfArtifacts.length > 0 ? (
        <div className="followup__actions">
          {pdfArtifacts.map((artifact) => (
            <button
              className="pill-btn pill-btn--primary"
              key={`${artifact.label}-${artifact.path}`}
              onClick={() => void window.confere?.openPath(artifact.path)}
              type="button"
            >
              <FileText aria-hidden="true" size={16} />
              {artifact.label || "Abrir PDF do boleto"}
            </button>
          ))}
        </div>
      ) : (
        <p className="followup__text">
          O vencimento foi alterado, mas o PDF ainda não ficou disponível nesta sessão.
        </p>
      )}
    </div>
  );
}

function DownloadBoletoResultCard(props: {
  result: AgentResultView;
  operation?: OperationSummary;
}): ReactElement | null {
  if (!isDownloadBoletoIntent(props.result) || !isLiveSuccess(props.result, props.operation)) {
    return null;
  }

  const details = resolveDownloadBoletoDetails(props.result, props.operation);
  const pdfArtifacts = [
    ...(props.operation?.artifacts ?? []),
    ...artifactsFromReceiptData(props.result.receiptData)
  ].filter((artifact) => artifact.kind === "pdf");

  return (
    <div className="followup followup--success">
      <p className="followup__title">
        <CheckCircle2 aria-hidden="true" size={16} />
        PDF do boleto disponível
      </p>
      <dl className="operation-preview__facts operation-preview__facts--inline">
        {details.customerName ? (
          <div>
            <dt>Cliente</dt>
            <dd>{details.customerName}</dd>
          </div>
        ) : null}
        {details.chargeId ? (
          <div>
            <dt>Cobrança</dt>
            <dd>{details.chargeId}</dd>
          </div>
        ) : null}
        {details.valueBr ? (
          <div>
            <dt>Valor</dt>
            <dd>{details.valueBr}</dd>
          </div>
        ) : null}
        {details.dueDateBr ? (
          <div>
            <dt>Vencimento</dt>
            <dd>{details.dueDateBr}</dd>
          </div>
        ) : null}
      </dl>
      {pdfArtifacts.length > 0 ? (
        <div className="followup__actions">
          {pdfArtifacts.map((artifact) => (
            <button
              className="pill-btn pill-btn--primary"
              key={`${artifact.label}-${artifact.path}`}
              onClick={() => void window.confere?.openPath(artifact.path)}
              type="button"
            >
              <FileText aria-hidden="true" size={16} />
              {artifact.label || "Abrir PDF do boleto"}
            </button>
          ))}
        </div>
      ) : (
        <p className="followup__text">
          O download foi registrado, mas o PDF ainda não ficou disponível nesta sessão.
        </p>
      )}
    </div>
  );
}

function OperationArtifactsCard(props: {
  operation?: OperationSummary;
  failed?: boolean;
  receiptData?: unknown;
  receiptStatus?: string;
  intent?: string;
}): ReactElement | null {
  if (props.receiptStatus === "planned" || props.operation?.latestStatus === "planned") {
    return null;
  }
  if (
    props.intent === "update_charge_due_date" ||
    props.intent === "download_boleto" ||
    props.intent === "download_boleto_pdf"
  ) {
    return null;
  }

  const receiptArtifacts = artifactsFromReceiptData(props.receiptData);
  const artifacts = props.operation?.artifacts ?? receiptArtifacts;
  const pdfArtifacts = artifacts.filter((artifact) => artifact.kind === "pdf");
  if (!props.failed && pdfArtifacts.length === 0) return null;

  return (
    <div className={`followup ${props.failed ? "followup--danger" : "followup--success"}`}>
      <p className="followup__title">
        {props.failed ? (
          <AlertTriangle aria-hidden="true" size={16} />
        ) : (
          <CheckCircle2 aria-hidden="true" size={16} />
        )}
        {props.failed ? "A emissão não foi concluída" : "Boleto pronto"}
      </p>
      {props.failed && props.operation?.failedStep ? (
        <p className="followup__text">Etapa com falha: {props.operation.failedStep}</p>
      ) : null}
      {props.operation?.chargeUrl ? (
        <p className="followup__text">
          Link da fatura:{" "}
          <a href={props.operation.chargeUrl} rel="noreferrer" target="_blank">
            abrir no Conta Azul
          </a>
        </p>
      ) : null}
        {pdfArtifacts.length > 0 ? (
        <div className="followup__actions artifact-actions">
          {pdfArtifacts.map((artifact) => (
            <button
              className="pill-btn pill-btn--primary"
              key={`${artifact.label}-${artifact.path}`}
              onClick={() => void window.confere?.openPath(artifact.path)}
              type="button"
            >
              <FileText aria-hidden="true" size={16} />
              {artifact.label || "Abrir PDF do boleto"}
            </button>
          ))}
        </div>
      ) : props.failed ? (
        <p className="followup__text">Consulte Operações no menu lateral para ver o histórico completo.</p>
      ) : null}
    </div>
  );
}

function artifactsFromReceiptData(receiptData: unknown): OperationSummary["artifacts"] {
  if (!receiptData || typeof receiptData !== "object") return [];
  const artifacts = (receiptData as { artifacts?: OperationSummary["artifacts"] }).artifacts;
  return Array.isArray(artifacts) ? artifacts : [];
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
  const operation = props.message.operation;
  const summary = messageSummary(result, operation);
  const hasQuestions = result.questions.length > 0;

  const isSearchFinancial = result.toolName === "contaazul.search_financial_statement";
  const financialItems = (isSearchFinancial && Array.isArray(result.receiptData))
    ? result.receiptData
    : [];

  const isCreateCustomer = result.toolName === "contaazul.create_customer_workflow";
  const choicePicker = inferChoicePicker(result);
  const inlineForm = inferInlineForm(result);
  const showInlineForm = props.isLatest && inlineForm !== null;
  const showChoicePicker =
    props.isLatest &&
    !showInlineForm &&
    choicePicker !== null &&
    (choicePicker.allowCreate === true || (result.choices?.length ?? 0) > 0);
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
      <PixelynAvatar context="chat" state={pixelynStateFromResult(result, "idle")} />
      <div className="chat-message__stack">
        <header className="chat-message__meta">
          <strong>Pixelyn</strong>
          <span>{props.message.timestamp}</span>
        </header>
        <div className="chat-message__body chat-message__body--assistant">
          <p className="assistant__say">{summary}</p>
          {showInlineForm && inlineForm ? (
            <ChatInlineForm
              definition={inlineForm}
              onSubmit={(text, params) => props.onSend(text, params)}
              result={result}
            />
          ) : hasQuestions ? (
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

          {showChoicePicker && choicePicker ? (
            choicePicker.display === "select" ? (
              <ChoiceSelectList
                choices={result.choices ?? []}
                onSelect={(choice) => props.onSend(choice.request ?? choice.label, choice.params)}
              />
            ) : (
              <ChoiceSearchPicker
                choices={result.choices}
                config={choicePicker}
                onCreateNew={
                  choicePicker.allowCreate
                    ? (query) =>
                        props.onSend(`Criar cliente ${query}`, {
                          __interactive: {
                            flow: "contaazul_service_sale_boleto",
                            action: "start_create_customer"
                          },
                          suggestedName: query
                        })
                    : undefined
                }
                onSelect={(choice) => props.onSend(choice.request ?? choice.label, choice.params)}
              />
            )
          ) : null}

          {/* Candidates / Ambiguity choice chips */}
          {result.candidates && result.candidates.length > 0 ? (
            <div className="candidates">
              <p className="candidates__label">
                Múltiplas opções para {formatField(result.fieldName || "")}:
              </p>
              <div className="candidates__chips">
                {result.candidates.map((candidate) => (
                  <button
                    key={candidate}
                    className="candidate-chip"
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
            <div className="extrato">
              <div className="extrato__scroll">
                <table className="extrato__table">
                  <thead>
                    <tr>
                      <th>Vencimento</th>
                      <th>Cliente</th>
                      <th>Descrição</th>
                      <th>Valor</th>
                      <th>Status</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {financialItems.map((item: any) => {
                      const paid = item.status === "PAID" || item.status === "ACQUITTED";
                      return (
                        <tr key={item.id}>
                          <td>{formatDate(item.dueDateIso) || "--"}</td>
                          <td>{item.customerName || "--"}</td>
                          <td>{item.description || "--"}</td>
                          <td>{formatMoney(item.value) || "--"}</td>
                          <td>
                            <span className={`data-pill ${paid ? "data-pill--paid" : "data-pill--pending"}`}>
                              {paid ? "Pago" : "Pendente"}
                            </span>
                          </td>
                          <td>
                            <button
                              className="data-action"
                              onClick={() => handleUpdateDueDate(item)}
                              type="button"
                            >
                              Alterar vencimento
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Customer Created Followup */}
          {resolvedCustomer ? (
            <div className="followup">
              <p className="followup__title">
                <CheckCircle2 aria-hidden="true" size={16} />
                Cadastro concluído com sucesso para "{resolvedCustomer.customerName}".
              </p>
              <p className="followup__text">
                Deseja emitir um novo boleto de serviço para este cliente agora?
              </p>
              <div className="followup__actions">
                <button
                  className="pill-btn pill-btn--primary"
                  onClick={() => props.onSend("Emitir boleto de serviço", buildBoletoHandoffParams(resolvedCustomer))}
                  type="button"
                >
                  Sim, emitir boleto
                </button>
                <button
                  className="pill-btn pill-btn--ghost"
                  onClick={() => props.onSend("Não, obrigado")}
                  type="button"
                >
                  Não, apenas cadastrar
                </button>
              </div>
            </div>
          ) : null}

          {props.message.draftOperationId && result.receiptStatus === "planned" ? (
            <PlanCard
              approvalAvailable={result.approvalAvailable}
              facts={factsFromOperation(props.message.operation, result)}
              onApprove={() => props.onReview(props.message.draftOperationId!)}
              technicalDetail={
                props.message.operation ? JSON.stringify(props.message.operation, null, 2) : undefined
              }
            />
          ) : null}

          <OperationArtifactsCard
            failed={isLiveFailure(result, operation)}
            intent={result.intent}
            operation={operation}
            receiptData={result.receiptData}
            receiptStatus={result.receiptStatus}
          />
          <DueDateUpdateResultCard operation={operation} result={result} />
          <DownloadBoletoResultCard operation={operation} result={result} />
          {hasQuestions && !showInlineForm ? (
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
          <div className="question-list__item" key={fieldName}>
            <span className="question-list__index">{index + 1}</span>
            <div className="question-list__body">
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
      <PixelynAvatar context="chat" state="pensando" />
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
  const status = statusLabel(props.result, props.phase, props.operation);
  const suggested = moduleSuggestion(props.result);
  const liveDone = isLiveSuccess(props.result, props.operation);
  const liveFailed = isLiveFailure(props.result, props.operation);
  const pdfArtifacts = liveDone
    ? [
        ...(props.operation?.artifacts ?? []),
        ...artifactsFromReceiptData(props.result?.receiptData)
      ].filter((artifact) => artifact.kind === "pdf")
    : [];
  const isDueDateUpdate = props.result?.intent === "update_charge_due_date";
  const isDownloadBoleto = isDownloadBoletoIntent(props.result);
  const dueDateDetails = props.result
    ? resolveDueDateUpdateDetails(props.result, props.operation)
    : undefined;
  const downloadDetails = props.result
    ? resolveDownloadBoletoDetails(props.result, props.operation)
    : undefined;
  const previewTitle = isDueDateUpdate
    ? "Alterar vencimento"
    : isDownloadBoleto
      ? "Baixar boleto"
      : props.result?.toolName?.includes("contaazul")
        ? "Venda + boleto"
        : "Boleto avulso";
  const liveDoneMessage = isDueDateUpdate
    ? pdfArtifacts.length > 0
      ? "O vencimento foi atualizado e o PDF do boleto foi baixado."
      : "O vencimento foi atualizado no Asaas."
    : isDownloadBoleto
      ? "O PDF do boleto foi baixado do Asaas."
      : suggested === "asaas"
        ? "O boleto foi registrado no Asaas."
        : "A venda e o boleto foram registrados no Conta Azul.";
  const panelHeading = liveDone
    ? isDueDateUpdate
      ? "Alteração concluída"
      : isDownloadBoleto
        ? "Download concluído"
        : "Operação concluída"
    : liveFailed
      ? "Operação com falha"
      : isDownloadBoleto
        ? "Baixar boleto"
        : "Operação em preparo";
  const panelSubtitle = liveDone
    ? isDueDateUpdate
      ? pdfArtifacts.length > 0
        ? "O vencimento foi atualizado e o PDF está disponível."
        : "O vencimento da cobrança foi atualizado."
      : isDownloadBoleto
        ? "O PDF está disponível para abrir ou salvar."
        : "O boleto foi emitido e o PDF está disponível."
    : liveFailed
      ? "Revise o histórico para entender o que falhou."
      : isDownloadBoleto
        ? "Selecione a cobrança e baixe a segunda via em PDF."
        : "Rascunho seguro antes de qualquer execução real.";
  const pendingFields = props.result?.missingFields.length
    ? props.result.missingFields.map(formatField)
    : props.result
      ? []
      : DEFAULT_PENDING_FIELDS;

  return (
    <aside className="operation-panel">
      <header className="operation-panel__header">
        <div>
          <h2>{panelHeading}</h2>
          <p>{panelSubtitle}</p>
        </div>
        <span className="operation-panel__spark" aria-hidden="true">
          <Sparkles size={18} />
        </span>
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
          <strong>
            {liveDone
              ? isDueDateUpdate
                ? "Alteração concluída"
                : isDownloadBoleto
                  ? "Download concluído"
                  : "Emissão concluída"
              : isDownloadBoleto
                ? "Consulta ao Asaas"
                : "Gate de segurança"}
          </strong>
          <p>
            {liveDone
              ? liveDoneMessage
              : isDownloadBoleto
                ? "Download de PDF é somente leitura — não altera cobranças no Asaas."
                : "Dry-run primeiro. A execução real continua exigindo confirmação final."}
          </p>
        </div>
        <span>{liveDone ? "Concluído" : "Protegido"}</span>
      </section>

      {pdfArtifacts.length > 0 ? (
        <section className="operation-panel__section">
          <h3>Arquivos gerados</h3>
          <div className="artifact-actions">
            {pdfArtifacts.map((artifact: Artifact) => (
              <button
                className="pill-btn pill-btn--primary"
                key={`${artifact.label}-${artifact.path}`}
                onClick={() => void window.confere?.openPath(artifact.path)}
                type="button"
              >
                <FileText aria-hidden="true" size={16} />
                {artifact.label || "Abrir PDF"}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="operation-preview">
        <h3>Prévia da operação</h3>
        <div className="operation-preview__body">
          <ClipboardList aria-hidden="true" size={22} />
          <div>
            <strong>{previewTitle}</strong>
            <p>{suggested === "contaazul" ? "Conta Azul" : suggested === "asaas" ? "Asaas" : "Aguardando módulo"}</p>
          </div>
        </div>
        <dl className="operation-preview__facts">
          <div>
            <dt>Cliente</dt>
            <dd>{dueDateDetails?.customerName ?? props.operation?.customerName ?? "--"}</dd>
          </div>
          {isDueDateUpdate || isDownloadBoleto ? (
            <div>
              <dt>Cobrança</dt>
              <dd>
                {isDownloadBoleto
                  ? downloadDetails?.chargeId ?? props.operation?.chargeId ?? "--"
                  : dueDateDetails?.chargeId ?? props.operation?.chargeId ?? "--"}
              </dd>
            </div>
          ) : (
            <div>
              <dt>Valor</dt>
              <dd>{formatMoney(props.operation?.unitValue) ?? "R$ --,--"}</dd>
            </div>
          )}
          {isDownloadBoleto ? (
            <div>
              <dt>Valor</dt>
              <dd>{downloadDetails?.valueBr ?? "R$ --,--"}</dd>
            </div>
          ) : null}
          <div>
            <dt>{isDueDateUpdate ? "Novo vencimento" : "Vencimento"}</dt>
            <dd>
              {isDownloadBoleto
                ? downloadDetails?.dueDateBr ?? "--/--/----"
                : formatDate(props.operation?.dueDateIso) ??
                  dueDateDetails?.dueDateBr ??
                  "--/--/----"}
            </dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}

function isSilentInteractiveTurn(
  customText: string | undefined,
  customParams: Record<string, unknown> | undefined
): boolean {
  return (
    customText !== undefined &&
    customText.trim() === "" &&
    Boolean(customParams?.__interactive && typeof customParams.__interactive === "object")
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
    const silentInteractive = isSilentInteractiveTurn(customText, customParams);
    const content = (customText !== undefined ? customText : request).trim();
    if ((!content && !silentInteractive) || phase !== "idle") return;

    if (!silentInteractive) {
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
      } else if (response.result.operationId) {
        try {
          const summary = await getOperation(response.result.operationId);
          nextOperation = summary.operation;
        } catch {
          nextOperation = undefined;
        }
      }

      setResult(response.result);
      setDraftOperationId(response.draftOperationId);
      setOperation(nextOperation);
      setMessages((current) => {
        if (silentInteractive) {
          for (let index = current.length - 1; index >= 0; index -= 1) {
            const message = current[index];
            if (message.role !== "assistant") continue;
            const next = [...current];
            next[index] = {
              ...message,
              result: response.result,
              operation: nextOperation,
              draftOperationId: response.draftOperationId,
              timestamp: timeLabel()
            };
            return next;
          }
        }

        return [
          ...current,
          {
            id: createMessageId("assistant"),
            role: "assistant",
            result: response.result,
            operation: nextOperation,
            draftOperationId: response.draftOperationId,
            timestamp: timeLabel()
          }
        ];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao preparar operação.");
    } finally {
      setPhase("idle");
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter") return;

    // Ctrl/Cmd+Enter (e Shift+Enter) inserem quebra de linha; Enter sozinho envia.
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      const next = `${target.value.slice(0, start)}\n${target.value.slice(end)}`;
      setRequest(next);
      requestAnimationFrame(() => {
        target.selectionStart = start + 1;
        target.selectionEnd = start + 1;
      });
      return;
    }

    if (event.shiftKey) return;

    event.preventDefault();
    void prepare();
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

      const success = executed.receiptStatus === "succeeded";
      const failed = executed.receiptStatus === "failed";
      const nextResult = { ...result!, receiptStatus: executed.receiptStatus };
      const nextSummary = success
        ? operationSuccessMessage(nextResult, executed.operation)
        : failed
          ? operationFailureMessage(nextResult, executed.operation)
          : messageSummary(nextResult, executed.operation);

      if (failed) {
        setError(operationFailureMessage(nextResult, executed.operation));
      }

      setOperation(executed.operation);
      setResult((previous) =>
        previous
          ? {
              ...previous,
              status: "executed",
              receiptStatus: executed.receiptStatus,
              summary: nextSummary,
              warnings: [...previous.warnings, ...executed.warnings]
            }
          : previous
      );
      setMessages((current) =>
        current.map((message) =>
          message.role === "assistant" && message.draftOperationId === draftOperationId
            ? {
                ...message,
                result: {
                  ...message.result,
                  status: "executed",
                  receiptStatus: executed.receiptStatus,
                  summary: nextSummary,
                  warnings: [...message.result.warnings, ...executed.warnings]
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
              <div className="assistant__greeting-avatar">
                <PixelynAvatar context="greeting" state={pixelynState} />
              </div>
              <div className="assistant__greeting-copy">
                <h1>E aí, o que vamos resolver hoje?</h1>
                <p>
                  Descreva a cobrança, a venda ou o boleto que eu preparo o rascunho —
                  ou comece por um atalho abaixo.
                </p>
              </div>
              <div className="assistant__starter-grid">
                {ANCHORED_OPERATIONS.map((op) => {
                  const Icon = op.icon;
                  return (
                    <button
                      className="starter-card"
                      key={op.action}
                      onClick={() =>
                        void prepare(op.label, { __interactive: { flow: "anchor", action: op.action } })
                      }
                      type="button"
                    >
                      <span className="starter-card__icon" aria-hidden="true">
                        <Icon size={20} />
                      </span>
                      <span className="starter-card__text">
                        <span className="starter-card__title">{op.label}</span>
                        <span className="starter-card__hint">{op.hint}</span>
                      </span>
                    </button>
                  );
                })}
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
              <span className="composer-shortcut">
                <CornerDownLeft aria-hidden="true" size={12} />
                Enter envia
              </span>
              <span className="composer-shortcut">
                <Command aria-hidden="true" size={12} />
                Ctrl + Enter quebra linha
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
