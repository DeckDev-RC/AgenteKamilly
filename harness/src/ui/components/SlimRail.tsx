import { ClipboardList, MessageSquare, RadioTower, Settings } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import sidebarLogoUrl from "../assets/logo/sidebar-logo.png";
import type { ScreenId } from "../types.js";

const DESTINATIONS: Array<{ id: ScreenId; label: string; icon: typeof MessageSquare }> = [
  { id: "conversa", label: "Conversa", icon: MessageSquare },
  { id: "operacoes", label: "Operações", icon: ClipboardList },
  { id: "sessoes", label: "Sessões", icon: RadioTower },
  { id: "configuracoes", label: "Configurações", icon: Settings }
];

export function SlimRail(props: {
  activeScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Confere navegação principal">
        <div className="rail__brand">
          <img alt="Confere" className="rail__brand-logo" src={sidebarLogoUrl} />
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
                <span className="rail__item-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="rail__item-text">{dest.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="rail__footer">
          <span className="rail__status">
            <span className="rail__status-dot" aria-hidden="true" />
            online
          </span>
        </div>
      </aside>
      <main className="main-surface">{props.children}</main>
    </div>
  );
}
