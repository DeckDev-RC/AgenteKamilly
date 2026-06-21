import { useState } from "react";
import type { ReactElement } from "react";

import { AppShell } from "./components/AppShell.js";
import type { ScreenId } from "./types.js";

export function App(): ReactElement {
  const [screen, setScreen] = useState<ScreenId>("home");

  return (
    <AppShell activeScreen={screen} onNavigate={setScreen}>
      <section className="screen">
        <p className="eyebrow">Confere</p>
        <h1>{titleForScreen(screen)}</h1>
        <p className="screen-lead">
          Operação local com agente em dry-run, aprovação humana e histórico auditável.
        </p>
      </section>
    </AppShell>
  );
}

function titleForScreen(screen: ScreenId): string {
  const titles: Record<ScreenId, string> = {
    home: "Início",
    contaazul: "Conta Azul",
    asaas: "Asaas",
    operacoes: "Operações",
    sessoes: "Sessões"
  };
  return titles[screen];
}
