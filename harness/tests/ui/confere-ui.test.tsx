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
});
