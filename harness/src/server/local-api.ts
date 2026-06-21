import http from "node:http";
import { URL } from "node:url";

import { createConfereService, type ConfereService } from "./confere-service.js";
import type { AgentTurnApiRequest } from "./api-types.js";

export type ConfereLocalApi = {
  url: string;
  port: number;
  close(): Promise<void>;
};

export async function startConfereLocalApi(input: {
  service?: ConfereService;
  port?: number;
} = {}): Promise<ConfereLocalApi> {
  const service = input.service ?? await createConfereService();
  const server = http.createServer(async (request, response) => {
    try {
      await routeRequest(service, request, response);
    } catch (error) {
      writeJson(response, 500, {
        status: "error",
        message: error instanceof Error ? error.message : "Unexpected server error"
      });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(input.port ?? 0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Confere local API did not bind to a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

async function routeRequest(
  service: ConfereService,
  request: http.IncomingMessage,
  response: http.ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/api/status") {
    writeJson(response, 200, await service.getStatus());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/operations") {
    const limit = Number(url.searchParams.get("limit") ?? "50");
    writeJson(response, 200, { status: "ok", operations: await service.listOperations(limit) });
    return;
  }

  const operationMatch = url.pathname.match(/^\/api\/operations\/([^/]+)$/);
  if (request.method === "GET" && operationMatch) {
    writeJson(response, 200, {
      status: "ok",
      operation: await service.summarizeOperation(decodeURIComponent(operationMatch[1]!))
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/agent/turn") {
    const body = await readJson(request);
    if (!body.ok) {
      writeJson(response, 400, { status: "error", message: body.message });
      return;
    }
    writeJson(response, 200, await service.runAgentTurn(body.value as AgentTurnApiRequest));
    return;
  }

  writeJson(response, 404, { status: "error", message: "Route not found" });
}

async function readJson(request: http.IncomingMessage): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string }
> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, message: "Request body must be a JSON object." };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, message: "Invalid JSON body." };
  }
}

function writeJson(response: http.ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(value));
}
