import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { RECAPTURE_COMMANDS } from "./recapture-commands.js";

export type SessionHealth =
  | { ok: true; provider: "asaas" | "contaazul" }
  | {
      ok: false;
      provider: "asaas" | "contaazul";
      reason: string;
      recaptureCommand?: string;
    };

export type BrowserCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
};

export type BrowserState = {
  cookies: BrowserCookie[];
};

export function checkSessionFile(provider: "asaas" | "contaazul", filePath: string): SessionHealth {
  if (!existsSync(filePath)) {
    return {
      ok: false,
      provider,
      reason: `Session file not found: ${filePath}`,
      recaptureCommand: provider === "contaazul" ? RECAPTURE_COMMANDS.contaazul : undefined
    };
  }
  return { ok: true, provider };
}

export async function loadBrowserState(statePath: string): Promise<BrowserState> {
  const raw = await readFile(statePath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<BrowserState>;

  if (!Array.isArray(parsed.cookies)) {
    throw new Error(`Invalid browser state file: ${statePath}`);
  }

  return {
    cookies: parsed.cookies
      .filter((cookie): cookie is BrowserCookie => Boolean(cookie?.name && cookie?.value))
      .map((cookie) => ({
        name: String(cookie.name),
        value: String(cookie.value),
        domain: cookie.domain,
        path: cookie.path,
        expires: typeof cookie.expires === "number" ? cookie.expires : undefined
      }))
  };
}

export function buildCookieString(state: BrowserState): string {
  return state.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

export function getCookieValue(state: BrowserState, cookieName: string): string | undefined {
  return state.cookies.find((cookie) => cookie.name === cookieName)?.value;
}

export function checkContaAzulSessionState(
  state: BrowserState,
  now: Date = new Date()
): SessionHealth {
  const accountancyCookie = state.cookies.find((cookie) => cookie.name === "auth-token-accountancy");

  if (!accountancyCookie?.value) {
    return {
      ok: false,
      provider: "contaazul",
      reason: "Conta Azul session is missing auth-token-accountancy.",
      recaptureCommand: RECAPTURE_COMMANDS.contaazul
    };
  }

  if (isExpired(accountancyCookie, now)) {
    return {
      ok: false,
      provider: "contaazul",
      reason: "Conta Azul session cookie is expired.",
      recaptureCommand: RECAPTURE_COMMANDS.contaazul
    };
  }

  return { ok: true, provider: "contaazul" };
}

function isExpired(cookie: BrowserCookie, now: Date): boolean {
  if (cookie.expires === undefined || cookie.expires < 0) return false;
  return cookie.expires * 1000 <= now.getTime();
}
