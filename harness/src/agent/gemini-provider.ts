import type { ModelMessage, ModelProvider, ModelRequest, ModelResponse } from "./model-provider.js";

export type GeminiModelProviderOptions = {
  apiKey: string;
  model: string;
  endpointBaseUrl?: string;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
};

type GeminiPart = { text?: string };
type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
};

type GeminiErrorResponse = {
  error?: {
    status?: string;
    message?: string;
  };
};

export function createGeminiModelProvider(options: GeminiModelProviderOptions): ModelProvider {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for the Gemini model provider.");

  const model = options.model.trim();
  if (!model) throw new Error("Gemini model name is required.");

  const endpointBaseUrl = options.endpointBaseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 30000;

  return {
    name: "gemini",
    model,
    async generateText(input: ModelRequest): Promise<ModelResponse> {
      let attempts = 0;
      const maxAttempts = 3;
      const baseDelayMs = 500;

      while (true) {
        attempts++;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? defaultTimeoutMs);

        try {
          const response = await fetchImpl(`${endpointBaseUrl}/models/${model}:generateContent`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
              contents: toGeminiContents(input.messages),
              generationConfig: {
                temperature: 0.2,
                responseMimeType: "application/json",
                ...(input.responseSchema ? { responseSchema: input.responseSchema } : {})
              }
            }),
            signal: controller.signal
          });

          const rawText = await response.text();
          if (!response.ok) {
            const isTransient = [429, 502, 503, 504].includes(response.status);
            if (isTransient && attempts < maxAttempts) {
              const delay = baseDelayMs * Math.pow(2, attempts - 1);
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }
            throw new Error(formatGeminiError(response.status, rawText));
          }

          const parsed = parseJson<GeminiResponse>(rawText);
          const text = parsed.candidates?.[0]?.content?.parts
            ?.map((part) => part.text ?? "")
            .join("")
            .trim();

          if (!text) throw new Error("Gemini API response did not include text content.");

          return { provider: "gemini", model, text };
        } catch (error) {
          const isAbort = error instanceof Error && error.name === "AbortError";
          if (!isAbort && attempts < maxAttempts) {
            const delay = baseDelayMs * Math.pow(2, attempts - 1);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      }
    }
  };
}

function toGeminiContents(messages: ModelMessage[]): Array<{
  role: "user" | "model";
  parts: Array<{ text: string }>;
}> {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [
      {
        text: message.role === "system"
          ? `System instructions:\n${message.content}`
          : message.content
      }
    ]
  }));
}

function formatGeminiError(status: number, rawText: string): string {
  const parsed = parseJson<GeminiErrorResponse>(rawText);
  const apiStatus = parsed.error?.status ? ` ${parsed.error.status}` : "";
  const message = parsed.error?.message ? ` ${parsed.error.message}` : "";
  return `Gemini API request failed: ${status}${apiStatus}${message}`.trim();
}

function parseJson<T>(rawText: string): T {
  try {
    return JSON.parse(rawText) as T;
  } catch {
    return {} as T;
  }
}
