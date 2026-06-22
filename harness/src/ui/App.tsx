import { useState } from "react";
import type { ReactElement } from "react";

import { SlimRail } from "./components/SlimRail.js";
import type { PixelynState } from "./lib/pixelyn-state.js";
import { AssistantScreen } from "./screens/AssistantScreen.js";
import { OperationsScreen } from "./screens/OperationsScreen.js";
import { SessionsScreen } from "./screens/SessionsScreen.js";
import type { ScreenId } from "./types.js";

export function App(): ReactElement {
  const [screen, setScreen] = useState<ScreenId>("conversa");
  const [pixelynState, setPixelynState] = useState<PixelynState>("parada");

  return (
    <SlimRail activeScreen={screen} onNavigate={setScreen} pixelynState={pixelynState}>
      {screen === "conversa" ? <AssistantScreen onPixelynState={setPixelynState} /> : null}
      {screen === "operacoes" ? <OperationsScreen /> : null}
      {screen === "sessoes" ? <SessionsScreen /> : null}
    </SlimRail>
  );
}
