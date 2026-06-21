import type { ReactElement } from "react";

import type { OperationSummary } from "../../core/operation-summary.js";
import { ActionButton } from "./ActionButton.js";

export function OperationSummaryPanel(props: {
  operation?: OperationSummary;
  draftOperationId?: string;
  onReviewExecution?: () => void;
  executing?: boolean;
}): ReactElement {
  if (!props.operation && !props.draftOperationId) {
    return (
      <aside className="summary-panel">
        <h2>Plano</h2>
        <p>Prepare uma operação para ver o resumo antes da execução.</p>
      </aside>
    );
  }

  return (
    <aside className="summary-panel">
      <h2>Plano</h2>
      <dl className="summary-list">
        <div>
          <dt>Operação</dt>
          <dd>{props.operation?.operationId ?? props.draftOperationId}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{props.operation?.latestStatus ?? "planned"}</dd>
        </div>
        {props.operation?.customerName ? (
          <div>
            <dt>Cliente</dt>
            <dd>{props.operation.customerName}</dd>
          </div>
        ) : null}
        {props.operation?.unitValue ? (
          <div>
            <dt>Valor</dt>
            <dd>{props.operation.unitValue}</dd>
          </div>
        ) : null}
        {props.operation?.dueDateIso ? (
          <div>
            <dt>Vencimento</dt>
            <dd>{props.operation.dueDateIso}</dd>
          </div>
        ) : null}
      </dl>
      <ActionButton
        disabled={!props.draftOperationId || props.executing}
        onClick={props.onReviewExecution}
        variant="primary"
      >
        Revisar execução real
      </ActionButton>
    </aside>
  );
}
