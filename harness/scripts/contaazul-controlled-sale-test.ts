import { existsSync } from "node:fs";
import path from "node:path";

import { loadHarnessConfig } from "../src/core/config.js";
import { checkContaAzulSessionState, loadBrowserState } from "../src/core/session-store.js";
import {
  MappedContaAzulSessionClient
} from "../src/modules/contaazul/client.js";
import { parseAccountancyClients } from "../src/modules/contaazul/parsers.js";
import {
  createContaAzulMutationTools,
  createContaAzulReadTools
} from "../src/modules/contaazul/tools.js";

type Args = {
  tenantId: string;
  customerName: string;
  categoryName: string;
  itemName: string;
  serviceDescription: string;
  unitValueBr: string;
  dueDateBr: string;
  phone: string;
  email: string;
  replyTo: string;
  companyDisplayName?: string;
  operationId?: string;
  saleNumber?: number;
  approvalText?: string;
  live: boolean;
};

type ResolvedSaleSetup = {
  relationId: string;
  customerId: string;
  customerName: string;
  categoryId: string;
  serviceItemId: string;
  saleNumber: number;
  operationNatureId: string;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) return;

  const runtimeMode = args.live ? "live" : "dry-run";
  const configCwd = path.basename(process.cwd()).toLowerCase() === "harness"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();
  const config = loadHarnessConfig(
    {
      ...process.env,
      RUNTIME_MODE: runtimeMode
    },
    configCwd
  );

  if (!existsSync(config.contaAzulStatePath)) {
    throw new Error(`Conta Azul state not found: ${config.contaAzulStatePath}`);
  }

  const state = await loadBrowserState(config.contaAzulStatePath);
  const health = checkContaAzulSessionState(state);
  if (!health.ok) {
    throw new Error(`${health.reason} ${health.recaptureCommand ?? ""}`.trim());
  }

  const client = new MappedContaAzulSessionClient({ state });
  const proSessionStore = new Map<string, string>();
  const readTools = createContaAzulReadTools({
    client,
    ledgerPath: config.ledgerPath,
    runtimeMode,
    proSessionStore
  });
  const mutationTools = createContaAzulMutationTools({
    client,
    ledgerPath: config.ledgerPath,
    artifactsDir: config.artifactsDir,
    runtimeMode,
    allowLiveMutations: config.allowLiveMutations,
    config: {
      financialAccountId: config.contaAzulFinancialAccountId,
      defaultReplyToEmail: config.contaAzulDefaultReplyToEmail,
      defaultCompanyDisplayName: config.contaAzulDefaultCompanyDisplayName
    },
    proSessionStore
  });

  const accountancyClients = parseAccountancyClients(await client.listAccountancyClients());
  const accountancyClient = pickByField({
    label: "Conta Azul Mais tenant",
    items: accountancyClients,
    expected: args.tenantId,
    field: (item) => String(item.tenantId)
  });

  await readTools.switchToProSession({ relationId: accountancyClient.relationId });
  const authToken = proSessionStore.get(accountancyClient.relationId);
  if (!authToken) {
    throw new Error("Conta Azul Pro auth token was not stored after session switch.");
  }

  const resolved = await resolveSaleSetup({
    client,
    authToken,
    relationId: accountancyClient.relationId,
    tenantId: args.tenantId,
    customerName: args.customerName,
    categoryName: args.categoryName,
    itemName: args.itemName,
    saleNumber: args.saleNumber
  });
  const operationId =
    args.operationId ?? `op_controlled_contaazul_sale_${new Date().toISOString().replace(/[^0-9]/g, "")}`;
  const receipt = await mutationTools.createServiceSaleAndIssueBoleto({
    relationId: resolved.relationId,
    customerId: resolved.customerId,
    customerName: resolved.customerName,
    categoryId: resolved.categoryId,
    serviceItemId: resolved.serviceItemId,
    serviceDescription: args.serviceDescription,
    unitValue: parseMoneyBr(args.unitValueBr),
    dueDateIso: parseDateBr(args.dueDateBr),
    saleDateIso: todayIso(),
    saleNumber: resolved.saleNumber,
    operationNatureId: resolved.operationNatureId,
    notification: {
      email: args.email,
      phone: onlyDigits(args.phone),
      replyTo: args.replyTo,
      companyDisplayName: args.companyDisplayName
    },
    operationId,
    approvalText: args.approvalText
  });

  console.log(JSON.stringify({ runtimeMode, resolved, receipt }, null, 2));
}

async function resolveSaleSetup(input: {
  client: MappedContaAzulSessionClient;
  authToken: string;
  relationId: string;
  tenantId: string;
  customerName: string;
  categoryName: string;
  itemName: string;
  saleNumber?: number;
}): Promise<ResolvedSaleSetup> {
  const customers = await input.client.searchSaleCustomers({
    authToken: input.authToken,
    searchTerm: input.customerName
  });
  const customer = pickByField({
    label: "customer",
    items: customers,
    expected: input.customerName,
    field: (item) => stringField(item, "name")
  });

  const categories = await input.client.searchFinancialCategories({
    authToken: input.authToken,
    searchTerm: input.categoryName
  });
  const category = pickByField({
    label: "financial category",
    items: categories,
    expected: input.categoryName,
    field: (item) => stringField(item, "dsNaturezaFinanceira")
  });

  const serviceItems = await input.client.searchServiceItems({
    authToken: input.authToken,
    searchTerm: input.itemName
  });
  const serviceItem = pickByField({
    label: "service item",
    items: serviceItems,
    expected: input.itemName,
    field: (item) => stringField(item, "name")
  });

  const operationNatures = await input.client.listOperationNatures({
    authToken: input.authToken
  });
  const operationNature = operationNatures
    .map(asRecord)
    .find((item) => stringField(item, "operationTemplate") === "PRESTACAO_SERVICO");
  if (!operationNature) {
    throw new Error("No PRESTACAO_SERVICO operation nature was found.");
  }

  return {
    relationId: input.relationId,
    customerId: requiredStringField(customer, "id", "customer id"),
    customerName: requiredStringField(customer, "name", "customer name"),
    categoryId: requiredStringField(category, "uuid", "category uuid"),
    serviceItemId: requiredStringField(serviceItem, "id", "service item id"),
    saleNumber: input.saleNumber ?? await input.client.getNextSaleNumber({ authToken: input.authToken }),
    operationNatureId: requiredStringField(operationNature, "uuid", "operation nature uuid")
  };
}

function parseArgs(argv: string[]): Args | undefined {
  if (argv.includes("--help")) {
    printHelp();
    return undefined;
  }

  const values = new Map<string, string>();
  let live = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--live") {
      live = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const value = argv[++index];
    if (!value) throw new Error(`Missing value for ${arg}`);
    values.set(arg.slice(2), value);
  }

  const required = [
    "tenant-id",
    "customer-name",
    "category-name",
    "item-name",
    "service-description",
    "unit-value-br",
    "due-date-br",
    "phone",
    "email",
    "reply-to"
  ];
  const missing = required.filter((key) => !values.get(key));
  if (missing.length > 0) {
    throw new Error(`Missing required arguments: ${missing.join(", ")}`);
  }

  return {
    tenantId: requiredValue(values, "tenant-id"),
    customerName: requiredValue(values, "customer-name"),
    categoryName: requiredValue(values, "category-name"),
    itemName: requiredValue(values, "item-name"),
    serviceDescription: requiredValue(values, "service-description"),
    unitValueBr: requiredValue(values, "unit-value-br"),
    dueDateBr: requiredValue(values, "due-date-br"),
    phone: requiredValue(values, "phone"),
    email: requiredValue(values, "email"),
    replyTo: requiredValue(values, "reply-to"),
    companyDisplayName: values.get("company-display-name"),
    operationId: values.get("operation-id"),
    saleNumber: optionalNumber(values.get("sale-number"), "sale-number"),
    approvalText: values.get("approval"),
    live
  };
}

function pickByField<T>(input: {
  label: string;
  items: T[];
  expected: string;
  field: (item: T) => string;
}): T {
  const expected = normalize(input.expected);
  const exact = input.items.filter((item) => normalize(input.field(item)) === expected);
  if (exact.length === 1) return exact[0] as T;

  const partial = input.items.filter((item) => normalize(input.field(item)).includes(expected));
  if (partial.length === 1) return partial[0] as T;

  const candidates = input.items.map((item) => input.field(item)).filter(Boolean);
  throw new Error(
    `Could not resolve unique ${input.label} for "${input.expected}". Candidates: ${candidates.join(" | ")}`
  );
}

function parseMoneyBr(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid BR money value: ${value}`);
  }
  return parsed;
}

function parseDateBr(value: string): string {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error(`Invalid BR date value: ${value}`);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function requiredValue(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`Missing required argument: ${key}`);
  return value;
}

function optionalNumber(value: string | undefined, label: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function requiredStringField(input: unknown, key: string, label: string): string {
  const value = stringField(input, key);
  if (value) return value;
  throw new Error(`Missing ${label} in resolved Conta Azul object.`);
}

function stringField(input: unknown, key: string): string {
  const value = asRecord(input)?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function printHelp(): void {
  console.log(`Usage:
npm run contaazul:controlled-sale -- \\
  --tenant-id 3047702 \\
  --customer-name "Cliente" \\
  --category-name "Honorario contabil mensal" \\
  --item-name "Honorario Contabil" \\
  --service-description "Honorario mensal" \\
  --unit-value-br "10,00" \\
  --due-date-br "30/06/2026" \\
  --phone "62999999999" \\
  --email "cliente@example.test" \\
  --reply-to "financeiro@example.test"

Add --live --operation-id <id> --sale-number <number> --approval "APROVAR <id>" only after reviewing dry-run.`);
}

await main();
