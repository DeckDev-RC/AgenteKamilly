import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import type { ReactElement } from "react";

import type { ConnectionHealth, ConnectionStatus, RenewProvider } from "../../server/api-types.js";
import type { RenewUiState } from "../lib/use-connections.js";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  healthy: "Conectado",
  expired: "Expirada",
  missing: "Não configurado",
  error: "Erro"
};

const STATUS_TONE: Record<ConnectionStatus, "good" | "warn" | "neutral" | "danger"> = {
  healthy: "good",
  expired: "warn",
  missing: "neutral",
  error: "danger"
};

const PROVIDER_MARK: Record<RenewProvider, string> = {
  asaas: "A",
  contaazul: "C"
};

export function ConnectionControl(props: {
  connection: ConnectionHealth;
  renew: RenewUiState;
  onRenew: (provider: RenewProvider) => void;
  onConfirm: (provider: RenewProvider) => void;
}): ReactElement {
  const { connection, renew } = props;
  const provider = connection.provider;
  const phase = renew.phase;
  const busy = phase === "starting" || phase === "running";
  const renewLabel = connection.status === "healthy" ? "Reautenticar" : "Renovar credenciais";

  return (
    <article className="conn">
      <div className="conn__head">
        <span className={`conn__mark conn__mark--${provider}`} aria-hidden="true">
          {PROVIDER_MARK[provider]}
        </span>
        <div className="conn__id">
          <strong>{connection.label}</strong>
          <span>{connection.detail}</span>
        </div>
        <span className={`health health--${STATUS_TONE[connection.status]}`}>
          {STATUS_LABEL[connection.status]}
        </span>
      </div>

      <div className="conn__actions">
        {phase === "ready" ? (
          <button
            className="pill-btn pill-btn--primary"
            onClick={() => props.onConfirm(provider)}
            type="button"
          >
            <CheckCircle2 aria-hidden="true" size={15} />
            Já fiz login — capturar sessão
          </button>
        ) : busy ? (
          <span className="conn__progress">
            <Loader2 aria-hidden="true" size={15} />
            {phase === "starting" ? "Abrindo navegador…" : "Capturando sessão…"}
          </span>
        ) : (
          <button
            className="pill-btn pill-btn--primary"
            onClick={() => props.onRenew(provider)}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={15} />
            {renewLabel}
          </button>
        )}
      </div>

      {phase === "ready" ? (
        <p className="conn__hint">
          Navegador com perfil persistente aberto. Na 1ª vez, complete login e MFA. Depois,
          normalmente basta login e senha — então clique em capturar sessão.
        </p>
      ) : null}

      {renew.message ? (
        <p className={`conn__msg conn__msg--${phase === "error" ? "error" : "ok"}`}>
          {phase === "error" ? <AlertTriangle aria-hidden="true" size={14} /> : <CheckCircle2 aria-hidden="true" size={14} />}
          {renew.message}
        </p>
      ) : null}

      {renew.logs.length > 0 && phase !== "done" ? (
        <pre className="conn__logs">{renew.logs.slice(-5).join("\n")}</pre>
      ) : null}
    </article>
  );
}
