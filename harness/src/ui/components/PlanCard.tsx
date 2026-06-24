import { ClipboardCheck, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";

import { ActionButton } from "./ActionButton.js";

export type PlanFacts = {
  customerName?: string;
  value?: string;
  dueDate?: string;
  action?: string;
  document?: string;
  personType?: string;
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
    ["Documento", props.facts.document],
    ["Tipo de pessoa", props.facts.personType],
    ["Valor", props.facts.value],
    ["Vencimento", props.facts.dueDate],
    ["Ação", props.facts.action]
  ];

  return (
    <div className="plan-card">
      <header className="plan-card__header">
        <div className="plan-card__icon" aria-hidden="true">
          <ClipboardCheck size={18} />
        </div>
        <div>
          <h2>Plano pronto para revisão</h2>
          <p>Dry-run concluído. Revise os dados antes da execução real.</p>
        </div>
        <span className="plan-card__safe">
          <ShieldCheck aria-hidden="true" size={14} />
          protegido
        </span>
      </header>
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
          Revisar e aprovar
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
