import { Send } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";

import type { OperationSummary } from "../../core/operation-summary.js";
import type { AgentTurnApiResponse, ConfirmationSheetView } from "../../server/api-types.js";
import { executeOperation, getConfirmationSheet, getOperation, runAgentTurn } from "../api.js";
import { ActionButton } from "../components/ActionButton.js";
import { ConfirmationSheet } from "../components/ConfirmationSheet.js";
import { OperationSummaryPanel } from "../components/OperationSummaryPanel.js";

export function WorkflowScreen(props: {
  module: "contaazul" | "asaas";
  title: string;
  description: string;
}): ReactElement {
  const [request, setRequest] = useState("");
  const [sessionId] = useState(() => `confere_${props.module}_${Date.now()}`);
  const [response, setResponse] = useState<AgentTurnApiResponse | undefined>();
  const [operation, setOperation] = useState<OperationSummary | undefined>();
  const [confirmationSheet, setConfirmationSheet] = useState<ConfirmationSheetView | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function prepare(): Promise<void> {
    setBusy(true);
    setError(undefined);
    setConfirmOpen(false);
    setConfirmationSheet(undefined);
    try {
      const result = await runAgentTurn({
        request,
        module: props.module,
        sessionId
      });
      setResponse(result);
      if (result.draftOperationId) {
        const summary = await getOperation(result.draftOperationId);
        setOperation(summary.operation);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao preparar operação.");
    } finally {
      setBusy(false);
    }
  }

  async function approve(): Promise<void> {
    if (!response?.draftOperationId) return;
    setBusy(true);
    setError(undefined);
    try {
      const executed = await executeOperation(response.draftOperationId);
      if (executed.status === "blocked") {
        setError(executed.reason);
        return;
      }
      setOperation(executed.operation);
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao executar operação.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewExecution(): Promise<void> {
    if (!response?.draftOperationId) return;
    setBusy(true);
    setError(undefined);
    try {
      const sheetResponse = await getConfirmationSheet(response.draftOperationId);
      if (sheetResponse.status === "blocked") {
        setError(sheetResponse.reason);
        return;
      }
      setConfirmationSheet(sheetResponse.sheet);
      setConfirmOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar confirmação.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workflow-layout">
      <div className="workflow-main">
        <p className="eyebrow">Confere</p>
        <h1>{props.title}</h1>
        <p className="screen-lead">{props.description}</p>
        <div className="chat-panel">
          <textarea
            aria-label="Pedido operacional"
            onChange={(event) => setRequest(event.target.value)}
            value={request}
          />
          <ActionButton disabled={!request.trim() || busy} icon={Send} onClick={prepare} variant="primary">
            Preparar operação
          </ActionButton>
        </div>
        {error ? <div className="notice notice--danger">{error}</div> : null}
        {response ? (
          <div className="agent-output">
            <strong>Status do agente: {response.result.status}</strong>
            <ul className="agent-facts">
              {response.result.toolName ? <li>Workflow: {response.result.toolName}</li> : null}
              {response.result.operationId ? <li>Operação: {response.result.operationId}</li> : null}
              {response.result.summary ? <li>Resumo: {response.result.summary}</li> : null}
              {response.result.missingFields.map((field) => (
                <li key={field}>Campo pendente: {field}</li>
              ))}
              {response.result.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <OperationSummaryPanel
        draftOperationId={response?.draftOperationId}
        executing={busy}
        operation={operation}
        onReviewExecution={() => void reviewExecution()}
      />
      <ConfirmationSheet
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={approve}
        open={confirmOpen}
        sheet={confirmationSheet}
      />
    </section>
  );
}
