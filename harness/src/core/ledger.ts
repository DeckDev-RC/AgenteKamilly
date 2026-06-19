import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";

import { redact } from "./redaction.js";
import type { Artifact, OperationStatus, Provider } from "./tool-types.js";

export type LedgerEntryInput = {
  operationId: string;
  provider: Provider;
  toolName: string;
  status: OperationStatus;
  args?: unknown;
  responseSummary?: unknown;
  artifacts: Artifact[];
  warnings: string[];
};

export type LedgerEntry = LedgerEntryInput & {
  timestamp: string;
};

export async function appendLedgerEntry(
  ledgerPath: string,
  input: LedgerEntryInput
): Promise<LedgerEntry> {
  await mkdir(path.dirname(ledgerPath), { recursive: true });

  const entry: LedgerEntry = {
    ...input,
    timestamp: new Date().toISOString(),
    args: redact(input.args),
    responseSummary: redact(input.responseSummary)
  };

  await appendFile(ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function readLedgerEntries(ledgerPath: string): Promise<LedgerEntry[]> {
  const raw = await readFile(ledgerPath, "utf8");
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerEntry);
}
