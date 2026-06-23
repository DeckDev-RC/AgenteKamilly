import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { HarnessConfig } from "../../src/core/config.js";
import {
  checkAsaasConnection,
  checkContaAzulConnection
} from "../../src/core/connection-health.js";

function tempConfig(): HarnessConfig {
  const root = mkdtempSync(path.join(tmpdir(), "confere-health-"));
  return {
    asaasEnvPath: path.join(root, ".env"),
    contaAzulStatePath: path.join(root, "contaazul", "state.json")
  } as HarnessConfig;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function htmlResponse(): Response {
  return new Response("<!DOCTYPE html><html><body>login</body></html>", {
    status: 200,
    headers: { "content-type": "text/html" }
  });
}

const fakeRequest = (response: Response) => async () => response;

function writeAsaasEnv(config: HarnessConfig, cookie = 'abc=1; def=2'): void {
  writeFileSync(config.asaasEnvPath, `COOKIE_STRING="${cookie}"\n`, "utf-8");
}

function writeContaAzulState(config: HarnessConfig, withCookie = true): void {
  mkdirSync(path.dirname(config.contaAzulStatePath), { recursive: true });
  const cookies = withCookie
    ? [{ name: "auth-token-accountancy", value: "tok", expires: -1 }]
    : [{ name: "other", value: "x", expires: -1 }];
  writeFileSync(config.contaAzulStatePath, JSON.stringify({ cookies }), "utf-8");
}

describe("connection-health", () => {
  it("reports Asaas missing when .env is absent", async () => {
    const result = await checkAsaasConnection(tempConfig());
    expect(result.status).toBe("missing");
  });

  it("reports Asaas healthy on a JSON ping", async () => {
    const config = tempConfig();
    writeAsaasEnv(config);
    const result = await checkAsaasConnection(config, {
      request: fakeRequest(jsonResponse({ content: "<table></table>" })) as never
    });
    expect(result.status).toBe("healthy");
  });

  it("reports Asaas expired when the provider returns an HTML login page", async () => {
    const config = tempConfig();
    writeAsaasEnv(config);
    const result = await checkAsaasConnection(config, {
      request: fakeRequest(htmlResponse()) as never
    });
    expect(result.status).toBe("expired");
  });

  it("reports Conta Azul missing when state.json is absent", async () => {
    const result = await checkContaAzulConnection(tempConfig());
    expect(result.status).toBe("missing");
  });

  it("reports Conta Azul expired when the session cookie is missing", async () => {
    const config = tempConfig();
    writeContaAzulState(config, false);
    const result = await checkContaAzulConnection(config);
    expect(result.status).toBe("expired");
  });

  it("reports Conta Azul healthy on a JSON ping with a valid cookie", async () => {
    const config = tempConfig();
    writeContaAzulState(config, true);
    const result = await checkContaAzulConnection(config, {
      request: fakeRequest(jsonResponse({ items: [] })) as never
    });
    expect(result.status).toBe("healthy");
  });

  it("reports Conta Azul expired on an HTML login page even with a present cookie", async () => {
    const config = tempConfig();
    writeContaAzulState(config, true);
    const result = await checkContaAzulConnection(config, {
      request: fakeRequest(htmlResponse()) as never
    });
    expect(result.status).toBe("expired");
  });
});
