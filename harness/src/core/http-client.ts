import { redactHeaders } from "./redaction.js";

export type SessionProvider = "asaas" | "contaazul";

/**
 * Sessão de provedor rejeitada/expirada. Quando o cookie vence, o provedor
 * frequentemente responde 200 com uma página HTML de login — fazer
 * `response.json()` nisso estoura com "Unexpected token '<'". Esta classe dá um
 * erro de domínio limpo, que a UI traduz em "renove as credenciais".
 */
export class SessionExpiredError extends Error {
  readonly provider: SessionProvider;
  readonly recaptureCommand?: string;

  constructor(provider: SessionProvider, message?: string, recaptureCommand?: string) {
    super(message ?? `Sessão do ${provider} expirada ou inválida.`);
    this.name = "SessionExpiredError";
    this.provider = provider;
    this.recaptureCommand = recaptureCommand;
  }
}

/** Detecta corpo/headers de página HTML (página de login no lugar de JSON). */
export function looksLikeHtml(contentType: string | null, body: string): boolean {
  if (contentType && contentType.toLowerCase().includes("text/html")) return true;
  const head = body.trimStart().slice(0, 64).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<");
}

/**
 * Lê JSON tratando o caso de sessão expirada como `SessionExpiredError` em vez de
 * deixar `response.json()` quebrar com SyntaxError em HTML.
 */
export async function readJsonOrExpired<T = unknown>(
  response: Response,
  provider: SessionProvider,
  recaptureCommand?: string
): Promise<T> {
  if (response.status === 401 || response.status === 403) {
    throw new SessionExpiredError(
      provider,
      `Sessão do ${provider} rejeitada (HTTP ${response.status}).`,
      recaptureCommand
    );
  }

  const text = await response.text();
  const contentType = response.headers.get("content-type");
  if (looksLikeHtml(contentType, text)) {
    throw new SessionExpiredError(
      provider,
      `Sessão do ${provider} expirada (o provedor devolveu uma página de login).`,
      recaptureCommand
    );
  }

  if (!text) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SessionExpiredError(
      provider,
      `Resposta inesperada do ${provider} (não-JSON); a sessão pode ter expirado.`,
      recaptureCommand
    );
  }
}

export type RequestWithRetryOptions = RequestInit & {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
};

export async function requestWithRetry(
  url: string,
  options: RequestWithRetryOptions = {}
): Promise<Response> {
  const { retries = 2, retryDelayMs = 500, timeoutMs = 30_000, ...fetchOptions } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal
      });

      if (response.status !== 429 || attempt === retries) {
        return response;
      }

      await sleep(retryDelayMs * (attempt + 1));
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await sleep(retryDelayMs * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

export function summarizeRequest(url: string, options: RequestInit = {}): Record<string, unknown> {
  return {
    url,
    method: options.method ?? "GET",
    headers: redactHeaders(Object.fromEntries(new Headers(options.headers).entries()))
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
