import { ClipboardList, MessageSquare, RadioTower } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import type { PixelynState } from "../lib/pixelyn-state.js";
import type { ScreenId } from "../types.js";
import { PixelynAvatar } from "./PixelynAvatar.js";

const DESTINATIONS: Array<{ id: ScreenId; label: string; icon: typeof MessageSquare }> = [
  { id: "conversa", label: "Conversa", icon: MessageSquare },
  { id: "operacoes", label: "Operações", icon: ClipboardList },
  { id: "sessoes", label: "Sessões", icon: RadioTower }
];

export function SlimRail(props: {
  activeScreen: ScreenId;
  pixelynState: PixelynState;
  onNavigate: (screen: ScreenId) => void;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Confere navegação principal">
        <div className="rail__pixelyn">
          <PixelynAvatar state={props.pixelynState} size={40} />
          <span className="rail__alive">Confere</span>
        </div>
        <nav className="rail__nav">
          {DESTINATIONS.map((dest) => {
            const Icon = dest.icon;
            const active = props.activeScreen === dest.id;
            return (
              <button
                aria-current={active ? "page" : undefined}
                className={`rail__item ${active ? "rail__item--active" : ""}`}
                key={dest.id}
                onClick={() => props.onNavigate(dest.id)}
                title={dest.label}
                type="button"
              >
                <Icon aria-hidden="true" size={18} />
                <span className="rail__label">{dest.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="main-surface">{props.children}</main>
    </div>
  );
}
