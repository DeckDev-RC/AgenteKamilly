import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { requestWithRetry } from "../../../src/core/http-client.js";
import { loadAsaasCookieString, MappedAsaasSessionClient } from "../../../src/modules/asaas/client.js";

describe("MappedAsaasSessionClient", () => {
  it("lists customer pages with the configured browser-session cookie", async () => {
    const requests: Array<{ url: string; options: RequestInit }> = [];
    const client = new MappedAsaasSessionClient({
      cookieString: "sid=secret-session",
      request: fakeRequest(requests, { content: "<div>clientes</div>" })
    });

    const content = await client.listCustomersPage(10, 20);

    expect(content).toBe("<div>clientes</div>");
    expect(requests[0]?.url).toBe(
      "https://www.asaas.com/customerAccount/loadTableContent?offset=10&max=20"
    );
    expect(new Headers(requests[0]?.options.headers).get("Cookie")).toBe("sid=secret-session");
  });

  it("lists charge pages by customer id", async () => {
    const requests: Array<{ url: string; options: RequestInit }> = [];
    const client = new MappedAsaasSessionClient({
      cookieString: "sid=secret-session",
      request: fakeRequest(requests, { content: "<tr>cobrancas</tr>" })
    });

    const content = await client.listChargesPage("customer 1", 0, 100);

    expect(content).toBe("<tr>cobrancas</tr>");
    expect(requests[0]?.url).toBe(
      "https://www.asaas.com/paymentList/loadTableContent?customerAccountId=customer%201&offset=0&max=100"
    );
  });

  it("loads charge detail html", async () => {
    const requests: Array<{ url: string; options: RequestInit }> = [];
    const client = new MappedAsaasSessionClient({
      cookieString: "sid=secret-session",
      request: async (url, options) => {
        requests.push({ url, options: options ?? {} });
        return new Response("<html>detalhe</html>", { status: 200 });
      }
    });

    await expect(client.getChargeDetailHtml("501")).resolves.toBe("<html>detalhe</html>");
    expect(requests[0]?.url).toBe("https://www.asaas.com/payment/show/501");
  });

  it("loads COOKIE_STRING from an env file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-asaas-env-"));
    const envPath = path.join(dir, ".env");
    await writeFile(envPath, "COOKIE_STRING=sid=secret-session\n", "utf-8");

    expect(loadAsaasCookieString(envPath)).toBe("sid=secret-session");
  });
});

function fakeRequest(
  requests: Array<{ url: string; options: RequestInit }>,
  json: unknown
): typeof requestWithRetry {
  return (async (url: string, options: RequestInit = {}) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof requestWithRetry;
}
