import { inspect } from "node:util";

import { loadHarnessConfig } from "../src/core/config.js";
import { loadBrowserState } from "../src/core/session-store.js";
import { MappedContaAzulSessionClient } from "../src/modules/contaazul/client.js";
import { parseAccountancyClients } from "../src/modules/contaazul/parsers.js";

const SERVICES_BASE_URL = "https://services.contaazul.com";
const tenantId = process.argv[2] ?? "3047702";
const saleNumber = process.argv[3] ?? "927";

type ProbeResult = {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  hit: boolean;
  body?: unknown;
  bodySnippet?: string;
};

function proReadHeaders(authToken: string): Record<string, string> {
  return {
    "x-authorization": authToken,
    Accept: "application/json, text/plain, */*",
    Origin: "https://pro.contaazul.com",
    Referer: "https://pro.contaazul.com/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari"
  };
}

function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 3).map(compact);
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const keys = [
    "id",
    "number",
    "legacyId",
    "status",
    "type",
    "description",
    "customer",
    "customerName",
    "client",
    "total",
    "value",
    "items",
    "data"
  ];
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (record[key] === undefined || record[key] === null) continue;
    if (key === "items" || key === "data") {
      out[key] = Array.isArray(record[key])
        ? (record[key] as unknown[]).slice(0, 3).map(compact)
        : compact(record[key]);
    } else {
      out[key] = compact(record[key]);
    }
  }
  if (Object.keys(out).length > 0) return out;

  const fallback: Record<string, unknown> = {};
  for (const key of Object.keys(record).slice(0, 12)) fallback[key] = compact(record[key]);
  return fallback;
}

async function probe(authToken: string, url: string): Promise<ProbeResult> {
  const response = await fetch(url, { headers: proReadHeaders(authToken) });
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  const hit = text.includes(saleNumber);

  if (contentType.includes("application/json")) {
    try {
      return {
        url,
        status: response.status,
        ok: response.ok,
        contentType,
        hit,
        body: compact(JSON.parse(text))
      };
    } catch {
      return {
        url,
        status: response.status,
        ok: response.ok,
        contentType,
        hit,
        bodySnippet: text.slice(0, 600)
      };
    }
  }

  return {
    url,
    status: response.status,
    ok: response.ok,
    contentType,
    hit,
    bodySnippet: text.slice(0, 600)
  };
}

async function main() {
  const config = loadHarnessConfig(process.env, process.cwd());
  const state = await loadBrowserState(config.contaAzulStatePath);
  const client = new MappedContaAzulSessionClient({ state });
  const rawClients = await client.listAccountancyClients();
  const accountancyClient = parseAccountancyClients(rawClients).find(
    (clientItem) => String(clientItem.tenantId) === tenantId
  );

  if (!accountancyClient) throw new Error(`Tenant ${tenantId} not found.`);

  const session = await client.switchToProSession(accountancyClient.relationId);
  const encoded = encodeURIComponent(saleNumber);
  const urls = [
    `${SERVICES_BASE_URL}/app/v1/sales/${encoded}`,
    `${SERVICES_BASE_URL}/app/v1/sales/?number=${encoded}`,
    `${SERVICES_BASE_URL}/app/v1/sales?number=${encoded}`,
    `${SERVICES_BASE_URL}/app/v1/sales?page=1&page_size=20&search=${encoded}`,
    `${SERVICES_BASE_URL}/app/v1/sales?page=1&pageSize=20&search=${encoded}`,
    `${SERVICES_BASE_URL}/app/v1/negotiations/${encoded}`,
    `${SERVICES_BASE_URL}/app/v1/negotiations?number=${encoded}`,
    `${SERVICES_BASE_URL}/app/v1/negotiations?page=1&page_size=20&search=${encoded}`,
    `${SERVICES_BASE_URL}/app/v1/negotiations?page=1&pageSize=20&search=${encoded}`,
    `${SERVICES_BASE_URL}/contaazul-bff/sale/v1/sales/${encoded}`,
    `${SERVICES_BASE_URL}/contaazul-bff/sale/v1/sales?number=${encoded}`,
    `${SERVICES_BASE_URL}/contaazul-bff/sale/v1/sales?page=1&page_size=20&search=${encoded}`,
    `${SERVICES_BASE_URL}/contaazul-bff/sale/v1/sales?page=1&pageSize=20&search=${encoded}`,
    `${SERVICES_BASE_URL}/sale/v1/sales?number=${encoded}`,
    `${SERVICES_BASE_URL}/sale/v1/sales?page=1&page_size=20&search=${encoded}`,
    `${SERVICES_BASE_URL}/sales/v1/sales?number=${encoded}`,
    `${SERVICES_BASE_URL}/sales/v1/sales?page=1&page_size=20&search=${encoded}`,
    `${SERVICES_BASE_URL}/sales-pro/v1/sales?number=${encoded}`,
    `${SERVICES_BASE_URL}/sales-pro/v1/sales?page=1&page_size=20&search=${encoded}`
  ];

  const results: ProbeResult[] = [];
  for (const url of urls) {
    try {
      results.push(await probe(session.authToken, url));
    } catch (error) {
      results.push({
        url,
        status: 0,
        ok: false,
        contentType: "error",
        hit: false,
        bodySnippet: error instanceof Error ? error.message : String(error)
      });
    }
  }

  console.log(
    inspect(
      {
        tenantId,
        relationId: accountancyClient.relationId,
        saleNumber,
        results
      },
      { depth: 10, colors: false }
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
