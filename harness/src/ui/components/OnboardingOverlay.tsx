import type { ReactElement } from "react";

import type { ConnectionHealth, RenewProvider } from "../../server/api-types.js";
import type { RenewUiState } from "../lib/use-connections.js";
import { ActionButton } from "./ActionButton.js";
import { ConnectionControl } from "./ConnectionControl.js";
import { PixelynAvatar } from "./PixelynAvatar.js";

export function OnboardingOverlay(props: {
  connections: ConnectionHealth[];
  renewState: Record<RenewProvider, RenewUiState>;
  loading: boolean;
  onRenew: (provider: RenewProvider) => void;
  onConfirm: (provider: RenewProvider) => void;
  onRefresh: () => void;
  onFinish: () => void;
}): ReactElement {
  const allHealthy =
    props.connections.length > 0 && props.connections.every((c) => c.status === "healthy");

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-modal="true" className="onboarding" role="dialog">
        <header className="onboarding__head">
          <PixelynAvatar state="preciso-de-dado" size={72} />
          <div>
            <p className="eyebrow">Bem-vindo ao Confere</p>
            <h2>Vamos conectar suas contas</h2>
            <p>
              O Confere opera no Asaas e no Conta Azul usando as suas sessões. Conecte
              cada uma para começar — abrimos o navegador para você logar.
            </p>
          </div>
        </header>

        <div className="onboarding__cards">
          {props.connections.map((connection) => (
            <ConnectionControl
              connection={connection}
              key={connection.provider}
              onConfirm={props.onConfirm}
              onRenew={props.onRenew}
              renew={props.renewState[connection.provider]}
            />
          ))}
        </div>

        <footer className="onboarding__foot">
          <button className="pill-btn pill-btn--ghost" onClick={props.onRefresh} type="button">
            Testar novamente
          </button>
          <div className="onboarding__foot-right">
            <button className="pill-btn pill-btn--ghost" onClick={props.onFinish} type="button">
              Pular por agora
            </button>
            <ActionButton disabled={!allHealthy} onClick={props.onFinish} variant="primary">
              Concluir
            </ActionButton>
          </div>
        </footer>
      </section>
    </div>
  );
}
