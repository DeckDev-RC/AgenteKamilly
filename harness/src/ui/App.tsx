import { useState } from "react";
import type { ReactElement } from "react";

import { AppShell } from "./components/AppShell.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { SessionsScreen } from "./screens/SessionsScreen.js";
import type { ScreenId } from "./types.js";

export function App(): ReactElement {
  const [screen, setScreen] = useState<ScreenId>("home");

  return (
    <AppShell activeScreen={screen} onNavigate={setScreen}>
      {screen === "home" ? <HomeScreen onNavigate={setScreen} /> : null}
      {screen === "sessoes" ? <SessionsScreen /> : null}
      {screen === "contaazul" ? <Placeholder title="Conta Azul" /> : null}
      {screen === "asaas" ? <Placeholder title="Asaas" /> : null}
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
