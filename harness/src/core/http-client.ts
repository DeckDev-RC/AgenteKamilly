import { redactHeaders } from "./redaction.js";

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
