import { useState } from "react";
import type { ReactElement } from "react";

import { AppShell } from "./components/AppShell.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { SessionsScreen } from "./screens/SessionsScreen.js";
import { WorkflowScreen } from "./screens/WorkflowScreen.js";
import type { ScreenId } from "./types.js";

export function App(): ReactElement {
  const [screen, setScreen] = useState<ScreenId>("home");

  return (
    <AppShell activeScreen={screen} onNavigate={setScreen}>
      {screen === "home" ? <HomeScreen onNavigate={setScreen} /> : null}
      {screen === "sessoes" ? <SessionsScreen /> : null}
      {screen === "contaazul" ? (
        <WorkflowScreen
          module="contaazul"
          title="Conta Azul"
          description="Prepare venda de serviço com boleto pelo fluxo mapeado."
        />
      ) : null}
      {screen === "asaas" ? (
        <WorkflowScreen
          module="asaas"
          title="Asaas"
          description="Prepare cobrança e boleto pelo fluxo mapeado."
        />
      ) : null}
      {screen === "operacoes" ? <Placeholder title="Operações" /> : null}
    </AppShell>
  );
}

function Placeholder(props: { title: string }): ReactElement {
  return (
    <section className="screen">
      <p className="eyebrow">Confere</p>
      <h1>{props.title}</h1>
      <p className="screen-lead">Fluxo operacional em preparação.</p>
    </section>
  );
}
