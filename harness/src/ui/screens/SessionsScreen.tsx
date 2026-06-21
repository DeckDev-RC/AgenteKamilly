import { useEffect, useState } from "react";
import type { ReactElement } from "react";

import type { ConfereStatus } from "../../server/api-types.js";
import { getStatus } from "../api.js";
import { StatusPill } from "../components/StatusPill.js";

export function SessionsScreen(): ReactElement {
  const [status, setStatus] = useState<ConfereStatus | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    void getStatus().then(setStatus).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Falha ao carregar status.");
    });
  }, []);

  return (
    <section className="screen">
      <p className="eyebrow">Sessões</p>
      <h1>Estado local</h1>
      <p className="screen-lead">Sessões e limites sem expor valores secretos.</p>
      {error ? <div className="notice notice--danger">{error}</div> : null}
      <div className="status-grid">
        <div className="metric-panel">
          <span>Conta Azul</span>
          <strong>{status?.sessions.contaazul ?? "carregando"}</strong>
        </div>
        <div className="metric-panel">
          <span>Asaas</span>
          <strong>{status?.sessions.asaas ?? "carregando"}</strong>
        </div>
        <div className="metric-panel">
          <span>Live</span>
          <strong>{status?.allowLiveMutations ? "habilitado" : "bloqueado"}</strong>
        </div>
        <div className="metric-panel">
          <span>Modelo</span>
          <strong>{status ? `${status.model.provider} · ${status.model.model}` : "carregando"}</strong>
        </div>
      </div>
      <div className="warning-list">
        {(status?.warnings ?? []).map((warning) => (
          <StatusPill key={warning} tone="warn">{warning}</StatusPill>
        ))}
      </div>
    </section>
  );
}
