import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { AgentResultView } from "../server/api-types.js";

export type StoredChatMessage =
  | {
      id: string;
      role: "user";
      text: string;
      timestamp: string;
    }
  | {
      id: string;
      role: "assistant";
      result: AgentResultView;
      draftOperationId?: string;
      timestamp: string;
    };

export type StoredConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredChatMessage[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
  messageCount: number;
};

export type ConversationStore = {
  list(): ConversationSummary[];
  get(id: string): StoredConversation | undefined;
  save(conversation: StoredConversation): void;
  remove(id: string): void;
};

const MAX_CONVERSATIONS = 50;

export function createConversationStore(dirPath: string): ConversationStore {
  function ensureDir(): void {
    mkdirSync(dirPath, { recursive: true });
  }

  function conversationPath(id: string): string {
    return path.join(dirPath, `${sanitizeId(id)}.json`);
  }

  return {
    list() {
      ensureDir();
      const summaries: ConversationSummary[] = [];
      for (const fileName of readdirSync(dirPath)) {
        if (!fileName.endsWith(".json")) continue;
        const filePath = path.join(dirPath, fileName);
        const conversation = readConversation(filePath);
        if (!conversation) continue;
        summaries.push(toSummary(conversation));
      }
      return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },

    get(id) {
      ensureDir();
      const filePath = conversationPath(id);
      if (!existsSync(filePath)) return undefined;
      return readConversation(filePath);
    },

    save(conversation) {
      ensureDir();
      const normalized: StoredConversation = {
        ...conversation,
        id: sanitizeId(conversation.id),
        title: conversation.title.trim() || "Nova conversa",
        messages: conversation.messages
      };
      writeFileSync(conversationPath(normalized.id), JSON.stringify(normalized, null, 2), "utf-8");
      trimOldConversations(dirPath, MAX_CONVERSATIONS);
    },

    remove(id) {
      ensureDir();
      const filePath = conversationPath(id);
      if (!existsSync(filePath)) return;
      unlinkSync(filePath);
    }
  };
}

export function deriveConversationTitle(messages: StoredChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser || firstUser.role !== "user") return "Nova conversa";
  const text = firstUser.text.trim();
  if (!text) return "Nova conversa";
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

export function deriveConversationPreview(messages: StoredChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return message.text.trim();
    const summary = message.result.summary?.trim();
    if (summary) return summary;
  }
  return "";
}

function toSummary(conversation: StoredConversation): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    preview: deriveConversationPreview(conversation.messages),
    messageCount: conversation.messages.length
  };
}

function readConversation(filePath: string): StoredConversation | undefined {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as StoredConversation;
    if (!parsed || typeof parsed !== "object" || !parsed.id || !Array.isArray(parsed.messages)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function trimOldConversations(dirPath: string, maxCount: number): void {
  const summaries = readdirSync(dirPath)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => readConversation(path.join(dirPath, fileName)))
    .filter((conversation): conversation is StoredConversation => Boolean(conversation))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  for (const conversation of summaries.slice(maxCount)) {
    try {
      unlinkSync(path.join(dirPath, `${sanitizeId(conversation.id)}.json`));
    } catch {
      // best-effort cleanup
    }
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}
