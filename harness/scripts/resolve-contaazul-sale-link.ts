import { inspect } from "node:util";

import { loadHarnessConfig } from "../src/core/config.js";
import { loadBrowserState } from "../src/core/session-store.js";
import { MappedContaAzulSessionClient } from "../src/modules/contaazul/client.js";
import { parseAccountancyClients } from "../src/modules/contaazul/parsers.js";

const tenantId = process.argv[2] ?? "3047702";
const search = process.argv[3] ?? "Venda 927";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pickRecord(record: JsonRecord | undefined, keys: string[]): JsonRecord | undefined {
  if (!record) return undefined;

  const picked: JsonRecord = {};
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) picked[key] = value;
  }

  return Object.keys(picked).length > 0 ? picked : undefined;
}

function compactItem(item: unknown): JsonRecord {
  const record = asRecord(item) ?? {};
  const chargeRequest = asRecord(record.chargeRequest);
  const sale = asRecord(record.sale);
  const reference = asRecord(record.reference);
  const origin = asRecord(record.origin);

  return {
    keys: Object.keys(record),
    id: record.id,
    description: record.description,
    title: record.title,
    name: record.name,
    number: record.number,
    type: record.type,
    value: record.value,
    date: record.date,
    dueDate: record.dueDate,
    financialEventId: record.financialEventId,
    referenceId: record.referenceId,
    reference_id: record.reference_id,
    saleId: record.saleId,
    chargeRequest: pickRecord(chargeRequest, ["id", "url", "status"]),
    sale: pickRecord(sale, ["id", "number", "legacyId", "url"]),
    reference: pickRecord(reference, ["id", "number", "type", "legacyId", "url"]),
    origin: pickRecord(origin, ["id", "number", "type", "legacyId", "url"])
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

  if (!accountancyClient) {
    throw new Error(`Tenant ${tenantId} not found in Conta Azul accountancy clients.`);
  }

  const session = await client.switchToProSession(accountancyClient.relationId);
  const items = await client.searchFinancialStatement({
    authToken: session.authToken,
    query: search,
    pageSize: 100
  });

  const compact = items.map(compactItem);
  console.log(
    inspect(
      {
        tenantId,
        relationId: accountancyClient.relationId,
        clientName: accountancyClient.name,
        search,
        count: compact.length,
        items: compact
      },
      { depth: 8, colors: false }
    )
  );

  const directUrls = new Set<string>();
  for (const item of compact) {
    const chargeRequest = asRecord(item.chargeRequest);
    const chargeUrl = stringValue(chargeRequest?.url);
    if (chargeUrl) directUrls.add(chargeUrl);

    for (const nestedKey of ["sale", "reference", "origin"]) {
      const nested = asRecord(item[nestedKey]);
      const url = stringValue(nested?.url);
      if (url) directUrls.add(url);
    }
  }

  if (directUrls.size > 0) {
    console.log("directUrls:");
    for (const url of directUrls) console.log(url);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
