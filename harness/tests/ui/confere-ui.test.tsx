import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../../src/ui/App.js";

describe("Confere UI", () => {
  it("renders the product shell and module navigation", () => {
    const html = renderToString(<App />);

    expect(html).toContain("Confere");
    expect(html).toContain("Conta Azul");
    expect(html).toContain("Asaas");
    expect(html).toContain("Operações");
    expect(html).toContain("Sessões");
  });

  it("renders home status language without secret values", () => {
    const html = renderToString(<App />);

    expect(html).toContain("Modo de operação");
    expect(html).toContain("Quota do modelo");
    expect(html).not.toContain("GEMINI_API_KEY");
  });
});
