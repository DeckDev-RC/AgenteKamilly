import { AlertTriangle, Cpu, RefreshCcw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";

import type {
  ConfereStatus,
  ConnectionHealth,
  RenewProvider
} from "../../server/api-types.js";
import { getStatus } from "../api.js";
import { ConnectionControl } from "../components/ConnectionControl.js";
import type { RenewUiState } from "../lib/use-connections.js";

export function SessionsScreen(props: {
  connections: ConnectionHealth[];
  renewState: Record<RenewProvider, RenewUiState>;
  loading: boolean;
  onRenew: (provider: RenewProvider) => void;
  onConfirm: (provider: RenewProvider) => void;
  onRefresh: () => void;
}): ReactElement {
  const [status, setStatus] = useState<ConfereStatus | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    void getStatus()
      .then(setStatus)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar status.");
      });
  }, []);

  const live = status?.allowLiveMutations;
  const warnings = status?.warnings ?? [];

  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <p className="eyebrow">Sessões</p>
          <h1>Conexões & runtime</h1>
          <p className="screen-lead">
            Saúde real das sessões (testada ao vivo) e renovação de credenciais.
          </p>
        </div>
        <button className="assistant__reset" onClick={props.onRefresh} type="button">
          <RefreshCcw aria-hidden="true" size={15} />
          {props.loading ? "Testando…" : "Testar agora"}
        </button>
      </div>

      {error ? <div className="notice notice--danger">{error}</div> : null}

      <div className="dashboard">
        <div className="dashboard__grid">
          {props.connections.map((connection) => (
            <ConnectionControl
              connection={connection}
              key={connection.provider}
              onConfirm={props.onConfirm}
              onRenew={props.onRenew}
              renew={props.renewState[connection.provider]}
            />
          ))}

          <article className="connection-card">
            <div className="connection-card__top">
              <span className="connection-card__mark connection-card__mark--runtime" aria-hidden="true">
                <ShieldCheck size={20} />
              </span>
              <div className="connection-card__title">
                <strong>Execução real</strong>
                <span>Gate de mutações ao vivo</span>
              </div>
            </div>
            <div className="connection-card__status">
              <span className="connection-card__value">
                {status ? (live ? "Mutações liberadas" : "Somente dry-run") : "—"}
              </span>
              <span className={`health health--${status ? (live ? "good" : "neutral") : "neutral"}`}>
                {status ? (live ? "Habilitado" : "Bloqueado") : "Carregando…"}
              </span>
            </div>
          </article>

          <article className="connection-card">
            <div className="connection-card__top">
              <span className="connection-card__mark connection-card__mark--model" aria-hidden="true">
                <Cpu size={20} />
              </span>
              <div className="connection-card__title">
                <strong>Modelo</strong>
                <span>Provedor de IA</span>
              </div>
            </div>
            <div className="connection-card__status">
              <span className="connection-card__value">
                {status ? `${status.model.provider} · ${status.model.model}` : "carregando"}
              </span>
              <span className="health health--neutral">Ativo</span>
            </div>
          </article>
        </div>

        {warnings.length > 0 ? (
          <div className="dashboard__warnings">
            <h3>Avisos</h3>
            {warnings.map((warning) => (
              <div className="alert-row" key={warning}>
                <AlertTriangle aria-hidden="true" size={16} />
                {warning}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
