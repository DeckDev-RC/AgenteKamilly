import { useState } from "react";
import type { ReactElement } from "react";

import { ActionButton } from "./ActionButton.js";

export type PlanFacts = {
  customerName?: string;
  value?: string;
  dueDate?: string;
  action?: string;
};

export function PlanCard(props: {
  facts: PlanFacts;
  approvalAvailable: boolean;
  technicalDetail?: string;
  onApprove: () => void;
}): ReactElement {
  const [showDetail, setShowDetail] = useState(false);
  const rows: Array<[string, string | undefined]> = [
    ["Cliente", props.facts.customerName],
    ["Valor", props.facts.value],
    ["Vencimento", props.facts.dueDate],
    ["Ação", props.facts.action]
  ];

  return (
    <div className="plan-card">
      <dl className="plan-card__facts">
        {rows
          .filter(([, value]) => Boolean(value))
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      <div className="plan-card__actions">
        <ActionButton disabled={!props.approvalAvailable} onClick={props.onApprove} variant="primary">
          Aprovar execução
        </ActionButton>
        {props.technicalDetail ? (
          <button
            className="plan-card__detail-toggle"
            onClick={() => setShowDetail((value) => !value)}
            type="button"
          >
            {showDetail ? "ocultar resumo técnico" : "ver resumo técnico"}
          </button>
        ) : null}
      </div>
      {showDetail && props.technicalDetail ? (
        <pre className="plan-card__detail">{props.technicalDetail}</pre>
      ) : null}
    </div>
  );
}
