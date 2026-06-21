import { ExternalLink, FileText, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";

import type { OperationSummary } from "../../core/operation-summary.js";
import { listOperations } from "../api.js";
import { ActionButton } from "../components/ActionButton.js";
import { OperationSummaryPanel } from "../components/OperationSummaryPanel.js";
import { StatusPill } from "../components/StatusPill.js";

export function OperationsScreen(): ReactElement {
  const [operations, setOperations] = useState<OperationSummary[]>([]);
  const [selected, setSelected] = useState<OperationSummary | undefined>();
  const [error, setError] = useState<string | undefined>();

  async function refresh(): Promise<void> {
    try {
      const response = await listOperations();
      setOperations(response.operations);
      setSelected(response.operations[0]);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao listar operações.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="workflow-layout">
      <div className="workflow-main">
        <div className="screen-header">
          <div>
            <p className="eyebrow">Operações</p>
            <h1>Histórico auditável</h1>
            <p className="screen-lead">Ledger redigido com resumo por operação.</p>
          </div>
          <ActionButton icon={RefreshCcw} onClick={() => void refresh()}>Atualizar</ActionButton>
        </div>
        {error ? <div className="notice notice--danger">{error}</div> : null}
        <div className="operations-table">
          {operations.map((operation) => (
            <button
              className="operation-row"
              key={operation.operationId}
              onClick={() => setSelected(operation)}
              type="button"
            >
              <span>{operation.operationId}</span>
              <StatusPill tone={toneForStatus(operation.latestStatus)}>
                {operation.latestStatus ?? "unknown"}
              </StatusPill>
              <span>{operation.customerName ?? operation.toolName ?? "sem resumo"}</span>
              <span>{operation.latestTimestamp ?? ""}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <OperationSummaryPanel operation={selected} />
        <div className="artifact-actions">
          {(selected?.artifacts ?? []).map((artifact) => (
            <ActionButton
              icon={artifact.kind === "pdf" ? FileText : ExternalLink}
              key={`${artifact.label}-${artifact.path}`}
              onClick={() => void window.confere?.openPath(artifact.path)}
            >
              {artifact.label}
            </ActionButton>
          ))}
        </div>
      </div>
    </section>
  );
}

function toneForStatus(status: OperationSummary["latestStatus"]): "neutral" | "good" | "warn" | "danger" {
  if (status === "succeeded") return "good";
  if (status === "failed" || status === "blocked") return "danger";
  if (status === "planned" || status === "approved" || status === "running") return "warn";
  return "neutral";
}
