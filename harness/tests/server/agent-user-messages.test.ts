import { describe, expect, it } from "vitest";

import { formatAgentBlockedMessage } from "../../src/server/agent-user-messages.js";

describe("formatAgentBlockedMessage", () => {
  it("traduz erro de schema do plano do agente", () => {
    const message = formatAgentBlockedMessage(
      'Model response did not match the agent plan schema: Too small: expected string to have >=1 characters'
    );
    expect(message).toContain("Não consegui montar um plano seguro");
    expect(message).not.toContain("schema");
    expect(message).not.toContain("Too small");
  });

  it("traduz falha do provedor do modelo", () => {
    const message = formatAgentBlockedMessage("Model provider failed: Gemini API request failed: 400");
    expect(message).toContain("assistente inteligente");
    expect(message).not.toContain("Gemini API");
  });

  it("preserva mensagens curtas e já amigáveis", () => {
    const message = formatAgentBlockedMessage("Sessão expirada. Renove em Sessões.");
    expect(message).toBe("Sessão expirada. Renove em Sessões.");
  });
});
