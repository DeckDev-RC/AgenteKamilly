import { readLedgerEntries, type LedgerEntry } from "./ledger.js";
import type { Artifact, OperationStatus, Provider } from "./tool-types.js";

export type OperationSummary = {
  operationId: string;
  found: boolean;
  provider?: Provider;
  toolName?: string;
  latestStatus?: OperationStatus;
  firstTimestamp?: string;
  latestTimestamp?: string;
  entryCount: number;
  summary?: string;
  idempotencyKey?: string;
  duplicateOperationId?: string;
  saleNumber?: number | string;
  chargeUrl?: string;
  customerName?: string;
  dueDateIso?: string;
  unitValue?: number | string;
  artifacts: Artifact[];
  warnings: string[];
  entries?: LedgerEntry[];
};

export async function summarizeOperationById(input: {
  ledgerPath: string;
  operationId: string;
  includeEntries?: boolean;
}): Promise<OperationSummary> {
  const entries = (await safeReadLedgerEntries(input.ledgerPath)).filter(
    (entry) => entry.operationId === input.operationId
  );

  if (entries.length === 0) {
    return {
      operationId: input.operationId,
      found: false,
      entryCount: 0,
      artifacts: [],
      warnings: []
    };
  }

  const latest = entries[entries.length - 1]!;
  const summary = asRecord(latest.responseSummary);
  const artifacts = latest.artifacts.length > 0
    ? latest.artifacts
    : lastNonEmptyArtifacts(entries);

  return {
    operationId: input.operationId,
    found: true,
    provider: latest.provider,
    toolName: latest.toolName,
    latestStatus: latest.status,
    firstTimestamp: entries[0]?.timestamp,
    latestTimestamp: latest.timestamp,
    entryCount: entries.length,
    summary: stringValue(summary?.summary),
    idempotencyKey: stringValue(summary?.idempotencyKey),
    duplicateOperationId: stringValue(summary?.duplicateOperationId),
    saleNumber: stringOrNumber(summary?.saleNumber),
    chargeUrl: stringValue(summary?.chargeUrl),
    customerName: stringValue(summary?.customerName),
    dueDateIso: stringValue(summary?.dueDateIso),
    unitValue: stringOrNumber(summary?.unitValue),
    artifacts,
    warnings: unique(entries.flatMap((entry) => entry.warnings)),
    entries: input.includeEntries ? entries : undefined
  };
}

export function formatOperationSummary(summary: OperationSummary): string {
  if (!summary.found) {
    return `Operacao nao encontrada: ${summary.operationId}`;
  }

  const lines = [
    `Operacao: ${summary.operationId}`,
    `Status: ${summary.latestStatus}`,
    `Provider: ${summary.provider}`,
    `Tool: ${summary.toolName}`
  ];

  if (summary.summary) lines.push(`Resumo: ${summary.summary}`);
  if (summary.saleNumber !== undefined) lines.push(`Venda: ${summary.saleNumber}`);
  if (summary.customerName) lines.push(`Cliente: ${summary.customerName}`);
  if (summary.unitValue !== undefined) lines.push(`Valor: ${summary.unitValue}`);
  if (summary.dueDateIso) lines.push(`Vencimento: ${summary.dueDateIso}`);
  if (summary.chargeUrl) lines.push(`Fatura: ${summary.chargeUrl}`);
  if (summary.duplicateOperationId) {
    lines.push(`Duplicata de: ${summary.duplicateOperationId}`);
  }
  if (summary.idempotencyKey) lines.push(`Idempotency: ${summary.idempotencyKey}`);
  if (summary.latestTimestamp) lines.push(`Atualizado em: ${summary.latestTimestamp}`);

  if (summary.artifacts.length > 0) {
    lines.push("Artefatos:");
    for (const artifact of summary.artifacts) {
      lines.push(`- ${artifact.label}: ${artifact.path}`);
    }
  }

  if (summary.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of summary.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join("\n");
}

async function safeReadLedgerEntries(ledgerPath: string): Promise<LedgerEntry[]> {
  try {
    return await readLedgerEntries(ledgerPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function lastNonEmptyArtifacts(entries: LedgerEntry[]): Artifact[] {
  for (const entry of entries.slice().reverse()) {
    if (entry.artifacts.length > 0) return entry.artifacts;
  }
  return [];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringOrNumber(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}
