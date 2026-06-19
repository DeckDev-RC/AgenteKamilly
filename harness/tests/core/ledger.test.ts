import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { appendLedgerEntry, readLedgerEntries } from "../../src/core/ledger.js";

describe("ledger", () => {
  it("writes redacted JSONL entries and creates parent directories", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-ledger-"));
    const ledgerPath = path.join(dir, "nested", "operations.jsonl");

    await appendLedgerEntry(ledgerPath, {
      operationId: "op_test",
      provider: "asaas",
      toolName: "asaas.search_customers",
      status: "planned",
      args: {
        Cookie: "sid=secret-session",
        email: "client@example.com"
      },
      responseSummary: {
        token: "private-token",
        message: "ok"
      },
      artifacts: [],
      warnings: []
    });

    const raw = await readFile(ledgerPath, "utf8");
    expect(raw).not.toContain("secret-session");
    expect(raw).not.toContain("client@example.com");
    expect(raw).not.toContain("private-token");

    const entries = await readLedgerEntries(ledgerPath);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.operationId).toBe("op_test");
    expect(entries[0]?.responseSummary).toMatchObject({ message: "ok" });
  });
});
