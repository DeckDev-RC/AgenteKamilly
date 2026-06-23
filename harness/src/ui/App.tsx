import { useState } from "react";
import type { ReactElement } from "react";

import { ConnectionBanner } from "./components/ConnectionBanner.js";
import { OnboardingOverlay } from "./components/OnboardingOverlay.js";
import { SlimRail } from "./components/SlimRail.js";
import { useConnections } from "./lib/use-connections.js";
import type { PixelynState } from "./lib/pixelyn-state.js";
import { AssistantScreen } from "./screens/AssistantScreen.js";
import { OperationsScreen } from "./screens/OperationsScreen.js";
import { SessionsScreen } from "./screens/SessionsScreen.js";
import type { ScreenId } from "./types.js";

const ONBOARDED_KEY = "confere.onboarded";

function readOnboarded(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(ONBOARDED_KEY) === "true";
  } catch {
    return false;
  }
}

export function App(): ReactElement {
  const [screen, setScreen] = useState<ScreenId>("conversa");
  const [pixelynState, setPixelynState] = useState<PixelynState>("parada");
  const [onboarded, setOnboarded] = useState(readOnboarded);
  const connections = useConnections();

  const anyBroken = connections.connections.some((c) => c.status !== "healthy");
  // Bloqueante só na primeira vez (ou enquanto não concluído) e quando há conexão fora.
  const showOnboarding = !onboarded && !connections.loading && anyBroken;

  function finishOnboarding(): void {
    try {
      localStorage.setItem(ONBOARDED_KEY, "true");
    } catch {
      // ignore storage failures
    }
    setOnboarded(true);
  }

  // Todas as telas ficam montadas; alternar só troca a visibilidade, então a
  // conversa (e qualquer rascunho) sobrevive à navegação entre abas.
  return (
    <SlimRail activeScreen={screen} onNavigate={setScreen} pixelynState={pixelynState}>
      {onboarded ? (
        <ConnectionBanner
          connections={connections.connections}
          onOpen={() => setScreen("sessoes")}
        />
      ) : null}

      <div className={`screen-host ${screen === "conversa" ? "" : "screen-host--hidden"}`}>
        <AssistantScreen onPixelynState={setPixelynState} />
      </div>
      <div className={`screen-host ${screen === "operacoes" ? "" : "screen-host--hidden"}`}>
        <OperationsScreen />
      </div>
      <div className={`screen-host ${screen === "sessoes" ? "" : "screen-host--hidden"}`}>
        <SessionsScreen
          connections={connections.connections}
          loading={connections.loading}
          onConfirm={connections.confirm}
          onRefresh={connections.refresh}
          onRenew={connections.renew}
          renewState={connections.renewState}
        />
      </div>

      {showOnboarding ? (
        <OnboardingOverlay
          connections={connections.connections}
          loading={connections.loading}
          onConfirm={connections.confirm}
          onFinish={finishOnboarding}
          onRefresh={() => void connections.refresh()}
          onRenew={connections.renew}
          renewState={connections.renewState}
        />
      ) : null}
    </SlimRail>
  );
}
