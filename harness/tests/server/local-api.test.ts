import { afterEach, describe, expect, it } from "vitest";

import { startConfereLocalApi } from "../../src/server/local-api.js";
import type { ConfereService } from "../../src/server/confere-service.js";

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers.length = 0;
});

describe("local api", () => {
  it("serves status", async () => {
    const server = await startConfereLocalApi({ service: fakeService() });
    servers.push(server);

    const response = await fetch(`${server.url}/api/status`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      appName: "Confere",
      runtimeMode: "dry-run"
    });
  });

  it("runs an agent turn", async () => {
    const server = await startConfereLocalApi({ service: fakeService() });
    servers.push(server);

    const response = await fetch(`${server.url}/api/agent/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "criar boleto", sessionId: "sess_1" })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      draftOperationId: "op_1"
    });
  });

  it("returns 400 for invalid json", async () => {
    const server = await startConfereLocalApi({ service: fakeService() });
    servers.push(server);

    const response = await fetch(`${server.url}/api/agent/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: "error" });
  });

  it("does not expose live execution over HTTP", async () => {
    const server = await startConfereLocalApi({ service: fakeService() });
    servers.push(server);

    const response = await fetch(`${server.url}/api/operations/op_1/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ status: "error" });
  });
});

function fakeService(): ConfereService {
  return {
    async getStatus() {
      return {
        appName: "Confere",
        runtimeMode: "dry-run",
        allowLiveMutations: false,
        sessions: { asaas: "missing", contaazul: "missing" },
        model: {
          provider: "gemini",
          model: "fake",
          dailyLimit: 100,
          usagePath: "usage.json"
        },
        warnings: [],
        artifactsDir: "artifacts",
        ledgerPath: "ledger.jsonl"
      };
    },
    async checkConnections() {
      return [];
    },
    async runAgentTurn() {
      return {
        status: "ok",
        draftOperationId: "op_1",
        warnings: [],
        result: {
          status: "blocked",
          reason: "fake",
          missingFields: [],
          questions: [],
          warnings: [],
          approvalAvailable: false
        }
      };
    },
    async getConfirmationSheet() {
      return { status: "blocked", reason: "fake" };
    },
    async executeApprovedOperation() {
      return { status: "blocked", reason: "fake" };
    },
    async listOperations() {
      return [];
    },
    async summarizeOperation(operationId) {
      return { operationId, found: false, entryCount: 0, artifacts: [], warnings: [] };
    },
    getDraft() {
      return undefined;
    },
    saveDraftForTest() {},
    async listAccountancyClients() {
      return [];
    },
    async searchSaleCustomers() {
      return [];
    },
    async searchFinancialCategories() {
      return [];
    },
    async searchServiceItems() {
      return [];
    }
  };
}
