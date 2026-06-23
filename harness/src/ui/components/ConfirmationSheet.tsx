import type { ReactElement } from "react";

import type { ConfirmationSheetView } from "../../server/api-types.js";
import { ActionButton } from "./ActionButton.js";

export function ConfirmationSheet(props: {
  open: boolean;
  sheet?: ConfirmationSheetView;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement | null {
  if (!props.open || !props.sheet) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-modal="true" className="confirmation-sheet" role="dialog">
        <header>
          <p className="eyebrow">Aprovação final</p>
          <h2>Confirmar execução real</h2>
          <p>Revise os dados antes de autorizar a mutação no provedor.</p>
        </header>
        <dl className="summary-list">
          <div>
            <dt>Operação</dt>
            <dd>{props.sheet.operationId}</dd>
          </div>
          <div>
            <dt>Workflow</dt>
            <dd>{props.sheet.toolName ?? "workflow"}</dd>
          </div>
          {props.sheet.tenantName || props.sheet.tenantId ? (
            <div>
              <dt>Empresa/Tenant</dt>
              <dd>{props.sheet.tenantName ?? props.sheet.tenantId}</dd>
            </div>
          ) : null}
          {props.sheet.customerName ? (
            <div>
              <dt>Cliente</dt>
              <dd>{props.sheet.customerName}</dd>
            </div>
          ) : null}
          {props.sheet.itemName ? (
            <div>
              <dt>Item</dt>
              <dd>{props.sheet.itemName}</dd>
            </div>
          ) : null}
          {props.sheet.description ? (
            <div>
              <dt>Descrição</dt>
              <dd>{props.sheet.description}</dd>
            </div>
          ) : null}
          {props.sheet.value ? (
            <div>
              <dt>Valor</dt>
              <dd>{props.sheet.value}</dd>
            </div>
          ) : null}
          {props.sheet.dueDate ? (
            <div>
              <dt>Vencimento</dt>
              <dd>{props.sheet.dueDate}</dd>
            </div>
          ) : null}
          {props.sheet.idempotencyKey ? (
            <div>
              <dt>Idempotência</dt>
              <dd>{props.sheet.idempotencyKey}</dd>
            </div>
          ) : null}
        </dl>
        {props.sheet.warnings.length > 0 ? (
          <div className="notice notice--danger">
            {props.sheet.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}
        {props.busy ? (
          <div className="confirmation-sheet__progress">
            <p>
              Emitindo venda e aguardando o boleto no Conta Azul. Isso pode levar até 2 minutos —
              não feche esta janela.
            </p>
          </div>
        ) : null}
        <footer className="confirmation-actions">
          <ActionButton disabled={props.busy} onClick={props.onCancel}>Cancelar</ActionButton>
          <ActionButton disabled={props.busy} onClick={props.onConfirm} variant="danger">
            {props.busy ? "Emitindo boleto…" : "Aprovar execução real"}
          </ActionButton>
        </footer>
      </section>
    </div>
  );
}
