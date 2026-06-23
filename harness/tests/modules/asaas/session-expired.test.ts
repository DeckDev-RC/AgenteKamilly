import { describe, expect, it } from "vitest";

import { SessionExpiredError } from "../../../src/core/http-client.js";
import { MappedAsaasSessionClient } from "../../../src/modules/asaas/client.js";

function client(response: Response): MappedAsaasSessionClient {
  return new MappedAsaasSessionClient({
    cookieString: "abc=1",
    request: (async () => response) as never
  });
}

describe("Asaas session expiry handling", () => {
  it("throws SessionExpiredError on an HTML login page (HTTP 200)", async () => {
    const html = new Response("<!DOCTYPE html><html>login</html>", {
      status: 200,
      headers: { "content-type": "text/html" }
    });
    await expect(client(html).listCustomersPage(0, 1)).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("throws SessionExpiredError on HTTP 401", async () => {
    const unauthorized = new Response("", { status: 401 });
    await expect(client(unauthorized).listCustomersPage(0, 1)).rejects.toBeInstanceOf(
      SessionExpiredError
    );
  });

  it("parses JSON content normally when the session is valid", async () => {
    const ok = new Response(JSON.stringify({ content: "<table></table>" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
    await expect(client(ok).listCustomersPage(0, 1)).resolves.toBe("<table></table>");
  });
});
