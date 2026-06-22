import { Building2, ClipboardList, Home, Landmark, RadioTower } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

type LegacyScreenId = "home" | "contaazul" | "asaas" | "operacoes" | "sessoes";

const NAV_ITEMS: Array<{ id: LegacyScreenId; label: string; icon: typeof Home }> = [
  { id: "home", label: "Início", icon: Home },
  { id: "contaazul", label: "Conta Azul", icon: Building2 },
  { id: "asaas", label: "Asaas", icon: Landmark },
  { id: "operacoes", label: "Operações", icon: ClipboardList },
  { id: "sessoes", label: "Sessões", icon: RadioTower }
];

export function AppShell(props: {
  activeScreen: LegacyScreenId;
  onNavigate: (screen: LegacyScreenId) => void;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">C</div>
          <div>
            <strong>Confere</strong>
            <span>Finance OS local</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${props.activeScreen === item.id ? "nav-item--active" : ""}`}
                key={item.id}
                onClick={() => props.onNavigate(item.id)}
                type="button"
              >
                <Icon aria-hidden="true" size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="main-surface">{props.children}</main>
    </div>
  );
}
