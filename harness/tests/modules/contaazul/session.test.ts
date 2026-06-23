import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildCookieString,
  checkContaAzulSessionState,
  getCookieValue,
  loadBrowserState
} from "../../../src/core/session-store.js";

describe("Conta Azul session state", () => {
  it("loads browser state, builds cookies, and reads accountancy token", async () => {
    const statePath = await writeTempState({
      cookies: [
        { name: "auth-token-accountancy", value: "accountancy-token-test", expires: 4102444800 },
        { name: "ca_session", value: "session-test", expires: 4102444800 }
      ]
    });

    const state = await loadBrowserState(statePath);

    expect(buildCookieString(state)).toBe(
      "auth-token-accountancy=accountancy-token-test; ca_session=session-test"
    );
    expect(getCookieValue(state, "auth-token-accountancy")).toBe("accountancy-token-test");
    expect(checkContaAzulSessionState(state)).toEqual({ ok: true, provider: "contaazul" });
  });

  it("blocks missing accountancy token with recapture instruction", async () => {
    const statePath = await writeTempState({
      cookies: [{ name: "ca_session", value: "session-test", expires: 4102444800 }]
    });
    const state = await loadBrowserState(statePath);

    const health = checkContaAzulSessionState(state);

    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("expected blocked session health");
    expect(health.reason).toContain("auth-token-accountancy");
    expect(health.recaptureCommand).toContain("renew-session.cjs contaazul");
  });

  it("blocks expired cookies with recapture instruction", async () => {
    const statePath = await writeTempState({
      cookies: [{ name: "auth-token-accountancy", value: "expired-token-test", expires: 1 }]
    });
    const state = await loadBrowserState(statePath);

    const health = checkContaAzulSessionState(state, new Date("2026-06-19T12:00:00Z"));

    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("expected blocked session health");
    expect(health.reason).toContain("expired");
    expect(health.recaptureCommand).toBe("node renew-session.cjs contaazul");
  });
});

async function writeTempState(state: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-state-"));
  const statePath = path.join(dir, "state.json");
  await writeFile(statePath, JSON.stringify(state), "utf-8");
  return statePath;
}
