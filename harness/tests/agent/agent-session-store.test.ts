import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadAgentSession,
  saveAgentSession
} from "../../src/agent/agent-session-store.js";

describe("agent session store", () => {
  it("persists short-lived slots by session id", async () => {
    const sessionsDir = await mkdtemp(path.join(os.tmpdir(), "harness-agent-sessions-"));

    const session = await loadAgentSession({ sessionsDir, sessionId: "sess_test" });
    session.slots.customerName = "Cliente Exemplo";
    session.slots.valueBr = "120,00";
    await saveAgentSession({ sessionsDir, session });

    const reloaded = await loadAgentSession({ sessionsDir, sessionId: "sess_test" });

    expect(reloaded).toMatchObject({
      sessionId: "sess_test",
      slots: {
        customerName: "Cliente Exemplo",
        valueBr: "120,00"
      }
    });

    const raw = await readFile(path.join(sessionsDir, "sess_test.json"), "utf8");
    expect(raw).not.toContain("COOKIE_STRING");
  });

  it("rejects unsafe session ids before touching disk", async () => {
    const sessionsDir = await mkdtemp(path.join(os.tmpdir(), "harness-agent-sessions-"));

    await expect(loadAgentSession({ sessionsDir, sessionId: "../escape" })).rejects.toThrow(
      "Invalid agent session id"
    );
  });
});
