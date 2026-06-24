import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createConversationStore,
  deriveConversationPreview,
  deriveConversationTitle
} from "../../src/core/conversation-store.js";

describe("conversation-store", () => {
  let tempDir = "";

  afterEach(() => {
    tempDir = "";
  });

  it("saves, lists and removes conversations", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "confere-conv-"));
    const store = createConversationStore(tempDir);

    store.save({
      id: "confere_1",
      title: "Emitir boleto",
      createdAt: "2026-06-22T10:00:00.000Z",
      updatedAt: "2026-06-22T10:05:00.000Z",
      messages: [
        { id: "u1", role: "user", text: "Emitir boleto", timestamp: "10:00" },
        {
          id: "a1",
          role: "assistant",
          timestamp: "10:01",
          result: {
            status: "needs_input",
            summary: "Selecione a empresa.",
            missingFields: ["tenantId"],
            questions: ["Qual empresa?"],
            warnings: [],
            approvalAvailable: false
          }
        }
      ]
    });

    const listed = store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: "confere_1",
      title: "Emitir boleto",
      preview: "Selecione a empresa.",
      messageCount: 2
    });

    expect(store.get("confere_1")?.messages).toHaveLength(2);
    store.remove("confere_1");
    expect(store.get("confere_1")).toBeUndefined();
  });

  it("derives title and preview from messages", () => {
    const messages = [
      { id: "u1", role: "user" as const, text: "Cliente AZUOS", timestamp: "10:00" },
      {
        id: "a1",
        role: "assistant" as const,
        timestamp: "10:01",
        result: {
          status: "needs_input" as const,
          summary: "Informe o valor.",
          missingFields: [],
          questions: [],
          warnings: [],
          approvalAvailable: false
        }
      }
    ];

    expect(deriveConversationTitle(messages)).toBe("Cliente AZUOS");
    expect(deriveConversationPreview(messages)).toBe("Informe o valor.");
  });
});
