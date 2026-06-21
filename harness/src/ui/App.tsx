import { useState } from "react";
import type { ReactElement } from "react";

import { SlimRail } from "./components/SlimRail.js";
import { OperationsScreen } from "./screens/OperationsScreen.js";
import { SessionsScreen } from "./screens/SessionsScreen.js";
import type { ScreenId } from "./types.js";

export function App(): ReactElement {
  const [screen, setScreen] = useState<ScreenId>("conversa");

  return (
    <SlimRail activeScreen={screen} onNavigate={setScreen} pixelynState="parada">
      {screen === "conversa" ? (
        <section className="screen">
          <p className="eyebrow">Confere</p>
          <h1>Conversa</h1>
          <p className="screen-lead">Assistente em preparação.</p>
        </section>
      ) : null}
      {screen === "operacoes" ? <OperationsScreen /> : null}
      {screen === "sessoes" ? <SessionsScreen /> : null}
    </SlimRail>
  );
}
