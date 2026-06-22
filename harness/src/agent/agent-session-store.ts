import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { redact } from "../core/redaction.js";

export type AgentSession = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  slots: Record<string, unknown>;
  lastPlan?: unknown;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
};

export type AgentSessionStoreOptions = {
  sessionsDir: string;
  sessionId: string;
};

export async function loadAgentSession(options: AgentSessionStoreOptions): Promise<AgentSession> {
  const sessionPath = resolveSessionPath(options);
  try {
    const raw = await readFile(sessionPath, "utf8");
    const parsed = JSON.parse(raw) as AgentSession;
    return {
      ...parsed,
      slots: parsed.slots && typeof parsed.slots === "object" ? parsed.slots : {}
    };
  } catch (error) {
    if (isMissingFile(error)) {
      const now = new Date().toISOString();
      return {
        sessionId: options.sessionId,
        createdAt: now,
        updatedAt: now,
        slots: {}
      };
    }
    throw error;
  }
}

export async function saveAgentSession(options: {
  sessionsDir: string;
  session: AgentSession;
}): Promise<void> {
  const sessionPath = resolveSessionPath({
    sessionsDir: options.sessionsDir,
    sessionId: options.session.sessionId
  });
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    `${JSON.stringify(redactSessionForStorage(options.session), null, 2)}\n`,
    "utf8"
  );
}

function redactSessionForStorage(session: AgentSession): AgentSession {
  return {
    ...session,
    updatedAt: new Date().toISOString(),
    slots: redact(session.slots) as Record<string, unknown>,
    lastPlan: session.lastPlan === undefined ? undefined : redact(session.lastPlan)
  };
}

function resolveSessionPath(options: AgentSessionStoreOptions): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(options.sessionId)) {
    throw new Error("Invalid agent session id. Use letters, numbers, underscore, or dash.");
  }
  return path.join(options.sessionsDir, `${options.sessionId}.json`);
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
  );
}
