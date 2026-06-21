import { ArrowRight, Building2, Landmark } from "lucide-react";
import type { ReactElement } from "react";

import { ActionButton } from "../components/ActionButton.js";
import { StatusPill } from "../components/StatusPill.js";

type LegacyHomeTarget = "contaazul" | "asaas" | "operacoes";

export function HomeScreen(props: {
  onNavigate: (screen: LegacyHomeTarget) => void;
}): ReactElement {
  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <p className="eyebrow">Confere</p>
          <h1>Operações financeiras com aprovação humana</h1>
          <p className="screen-lead">
            Prepare cobranças e boletos em dry-run, revise o plano e execute apenas com confirmação.
          </p>
        </div>
        <StatusPill tone="warn">Dry-run primeiro</StatusPill>
      </div>

      <div className="module-grid">
        <button className="module-tile" onClick={() => props.onNavigate("contaazul")} type="button">
          <Building2 aria-hidden="true" size={24} />
          <strong>Conta Azul</strong>
          <span>Venda de serviço + boleto</span>
          <ArrowRight aria-hidden="true" size={18} />
        </button>
        <button className="module-tile" onClick={() => props.onNavigate("asaas")} type="button">
          <Landmark aria-hidden="true" size={24} />
          <strong>Asaas</strong>
          <span>Cobrança e boleto</span>
          <ArrowRight aria-hidden="true" size={18} />
        </button>
      </div>

      <div className="status-grid">
        <div className="metric-panel">
          <span>Modo de operação</span>
          <strong>Dry-run com handoff seguro</strong>
        </div>
        <div className="metric-panel">
          <span>Quota do modelo</span>
          <strong>Uso controlado local</strong>
        </div>
      </div>

      <ActionButton variant="secondary" onClick={() => props.onNavigate("operacoes")}>
        Ver operações
      </ActionButton>
    </section>
  );
}
