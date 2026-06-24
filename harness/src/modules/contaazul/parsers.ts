import type { AccountancyClient, FinancialStatementItem } from "../../core/tool-types.js";

export function parseAccountancyClients(input: unknown): AccountancyClient[] {
  const items = arrayFromUnknownObject(input, "items");

  return items
    .map((item) => objectOrUndefined(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => {
      const relationId = stringValue(item.relationId) ?? stringValue(item.id);
      const tenantId = item.tenantId;
      const name = stringValue(item.name) ?? stringValue(item.companyName);

      if (!relationId || !name || !hasPositiveTenantId(tenantId)) return undefined;

      const client: AccountancyClient = {
        relationId,
        tenantId: typeof tenantId === "number" ? tenantId : String(tenantId),
        name,
        active: item.active !== false
      };

      const document =
        stringValue(item.document) ?? stringValue(item.cpfCnpj) ?? stringValue(item.federalTaxNumber);
      if (document) client.document = document;

      return client;
    })
    .filter((client): client is AccountancyClient => Boolean(client));
}

export function parseFinancialStatementItems(input: unknown): FinancialStatementItem[] {
  const items = Array.isArray(input) ? input : [];

  return items
    .map((item) => objectOrUndefined(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => {
      const id = stringValue(item.id);
      const financialEventId =
        stringValue(item.financialEventId) ??
        stringValue(objectOrUndefined(item.financialEvent)?.id);
      const description = stringValue(item.description) ?? "";
      const value = numberValue(item.value);

      if (!id || !financialEventId || value === undefined) return undefined;

      const parsed: FinancialStatementItem = {
        id,
        financialEventId,
        description,
        value,
        installmentId: id
      };

      const dueDateIso =
        stringValue(item.dueDate) ??
        stringValue(item.date) ??
        stringValue(item.expectedPaymentDate);
      if (dueDateIso) parsed.dueDateIso = dueDateIso;

      const customerName = extractFinancialStatementCustomerName(item);
      if (customerName) parsed.customerName = customerName;

      const status = stringValue(item.status);
      if (status) parsed.status = status;

      const categoryName = stringValue(item.categoryName);
      if (categoryName) parsed.categoryName = categoryName;

      return parsed;
    })
    .filter((item): item is FinancialStatementItem => Boolean(item));
}

export function extractFinancialStatementCustomerName(item: Record<string, unknown>): string | undefined {
  return (
    stringValue(item.customerName) ??
    stringValue(objectOrUndefined(item.customer)?.name) ??
    stringValue(objectOrUndefined(item.negotiator)?.name) ??
    stringValue(objectOrUndefined(item.person)?.name)
  );
}

function arrayFromUnknownObject(input: unknown, key: string): unknown[] {
  const object = objectOrUndefined(input);
  const value = object?.[key];
  return Array.isArray(value) ? value : [];
}

function objectOrUndefined(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : undefined;
}

function stringValue(input: unknown): string | undefined {
  if (typeof input === "string" && input.trim()) return input.trim();
  if (typeof input === "number") return String(input);
  return undefined;
}

function numberValue(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string") {
    const parsed = Number(input.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function hasPositiveTenantId(input: unknown): boolean {
  if (typeof input === "number") return input > 0;
  if (typeof input === "string") return Number(input) > 0;
  return false;
}
