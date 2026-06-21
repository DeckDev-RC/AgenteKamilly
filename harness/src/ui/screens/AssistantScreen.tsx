import { Send } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";

import type { OperationSummary } from "../../core/operation-summary.js";
import type { AgentResultView, ConfirmationSheetView } from "../../server/api-types.js";
import { executeOperation, getConfirmationSheet, getOperation, runAgentTurn } from "../api.js";
import { ActionButton } from "../components/ActionButton.js";
import { ConfirmationSheet } from "../components/ConfirmationSheet.js";
import { PixelynAvatar } from "../components/PixelynAvatar.js";
import { PlanCard, type PlanFacts } from "../components/PlanCard.js";
import {
  pixelynStateFromResult,
  type PixelynPhase,
  type PixelynState
} from "../lib/pixelyn-state.js";

function factsFromOperation(
  operation: OperationSummary | undefined,
  result: AgentResultView
): PlanFacts {
  return {
    customerName: operation?.customerName,
    value: operation?.unitValue !== undefined ? `R$ ${operation.unitValue}` : undefined,
    dueDate: operation?.dueDateIso,
    action: result.toolName?.includes("asaas")
      ? "Gerar boleto · Asaas"
      : "Venda + boleto · Conta Azul"
  };
}

export function AssistantScreen(props: {
  onPixelynState?: (state: PixelynState) => void;
}): ReactElement {
  const [request, setRequest] = useState("");
  const [sessionId] = useState(() => `confere_${Date.now()}`);
  const [result, setResult] = useState<AgentResultView | undefined>();
  const [draftOperationId, setDraftOperationId] = useState<string | undefined>();
  const [operation, setOperation] = useState<OperationSummary | undefined>();
  const [confirmationSheet, setConfirmationSheet] = useState<ConfirmationSheetView | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phase, setPhase] = useState<PixelynPhase>("idle");
  const [error, setError] = useState<string | undefined>();

  const pixelynState = pixelynStateFromResult(result, phase);
  useEffect(() => {
    props.onPixelynState?.(pixelynState);
  }, [pixelynState, props.onPixelynState]);

  async function prepare(): Promise<void> {
    setPhase("preparing");
    setError(undefined);
    setConfirmOpen(false);
    setConfirmationSheet(undefined);
    try {
      const response = await runAgentTurn({ request, sessionId });
      setResult(response.result);
      setDraftOperationId(response.draftOperationId);
      if (response.draftOperationId) {
        const summary = await getOperation(response.draftOperationId);
        setOperation(summary.operation);
      } else {
        setOperation(undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao preparar operação.");
    } finally {
      setPhase("idle");
    }
  }

  async function reviewExecution(): Promise<void> {
    if (!draftOperationId) return;
    setError(undefined);
    try {
      const sheetResponse = await getConfirmationSheet(draftOperationId);
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
      <header className="assistant__top">
        <div className="assistant__title">Conversa</div>
      </header>

      <div className="assistant__thread">
        {!result ? (
          <div className="assistant__greeting">
            <PixelynAvatar state={pixelynState} size={64} />
            <p>E aí, o que vamos resolver hoje?</p>
          </div>
        ) : null}

        {result ? (
          <div className="assistant__turn">
            <PixelynAvatar state={pixelynState} size={36} />
            <div className="assistant__bubble">
              {result.summary ? <p className="assistant__say">{result.summary}</p> : null}
              {result.questions.map((question) => (
                <p className="assistant__say" key={question}>{question}</p>
              ))}
              {result.warnings.map((warning) => (
                <p className="assistant__warn" key={warning}>{warning}</p>
              ))}
              {draftOperationId ? (
                <PlanCard
                  approvalAvailable={result.approvalAvailable}
                  facts={factsFromOperation(operation, result)}
                  onApprove={() => void reviewExecution()}
                  technicalDetail={operation ? JSON.stringify(operation, null, 2) : undefined}
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {error ? <div className="notice notice--danger">{error}</div> : null}
      </div>

      <div className="assistant__composer">
        <input
          aria-label="Peça algo à Pixelyn"
          className="assistant__input"
          onChange={(event) => setRequest(event.target.value)}
          placeholder="Peça algo à Pixelyn..."
          value={request}
        />
        <ActionButton
          disabled={!request.trim() || phase !== "idle"}
          icon={Send}
          onClick={() => void prepare()}
          variant="primary"
        >
          Enviar
        </ActionButton>
      </div>

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
