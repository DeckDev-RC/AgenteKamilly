import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ConnectionHealth, RenewProvider } from "../../src/server/api-types.js";
import { ConnectionBanner } from "../../src/ui/components/ConnectionBanner.js";
import { OnboardingOverlay } from "../../src/ui/components/OnboardingOverlay.js";
import type { RenewUiState } from "../../src/ui/lib/use-connections.js";

const idleRenew: Record<RenewProvider, RenewUiState> = {
  asaas: { phase: "idle", logs: [] },
  contaazul: { phase: "idle", logs: [] }
};

const connections: ConnectionHealth[] = [
  {
    provider: "asaas",
    label: "Asaas",
    status: "missing",
    detail: "COOKIE_STRING do Asaas não configurado.",
    checkedAt: new Date().toISOString(),
    recaptureCommand: "node renew-session.cjs asaas"
  },
  {
    provider: "contaazul",
    label: "Conta Azul",
    status: "expired",
    detail: "Conta Azul session cookie is expired.",
    checkedAt: new Date().toISOString(),
    recaptureCommand: "node renew-session.cjs contaazul"
  }
];

describe("Onboarding + connection banner", () => {
  it("renders the onboarding wizard with both providers and a renew action", () => {
    const html = renderToString(
      <OnboardingOverlay
        connections={connections}
        loading={false}
        onConfirm={() => undefined}
        onFinish={() => undefined}
        onRefresh={() => undefined}
        onRenew={() => undefined}
        renewState={idleRenew}
      />
    );
    expect(html).toContain("Vamos conectar suas contas");
    expect(html).toContain("Asaas");
    expect(html).toContain("Conta Azul");
    expect(html).toContain("Renovar credenciais");
    expect(html).toContain("Pular por agora");
    expect(html).toContain("Concluir");
  });

  it("disables Concluir until every connection is healthy", () => {
    const healthy: ConnectionHealth[] = connections.map((c) => ({
      ...c,
      status: "healthy",
      detail: "Sessão ativa."
    }));
    const html = renderToString(
      <OnboardingOverlay
        connections={healthy}
        loading={false}
        onConfirm={() => undefined}
        onFinish={() => undefined}
        onRefresh={() => undefined}
        onRenew={() => undefined}
        renewState={idleRenew}
      />
    );
    // Botão "Concluir" não deve estar desabilitado quando tudo está saudável.
    expect(html).not.toContain('action-button--primary" disabled');
  });

  it("renders a banner that points to renewal when a connection is down", () => {
    const html = renderToString(
      <ConnectionBanner connections={connections} onOpen={() => undefined} />
    );
    expect(html).toContain("precisam de atenção");
    expect(html).toContain("Renovar credenciais");
  });

  it("renders nothing in the banner when all connections are healthy", () => {
    const healthy: ConnectionHealth[] = connections.map((c) => ({ ...c, status: "healthy" }));
    const html = renderToString(
      <ConnectionBanner connections={healthy} onOpen={() => undefined} />
    );
    expect(html).toBe("");
  });
});
