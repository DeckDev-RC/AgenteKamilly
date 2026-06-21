import { afterEach, describe, expect, it, vi } from "vitest";

import { createGeminiModelProvider } from "../../src/agent/gemini-provider.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Gemini model provider", () => {
  it("calls generateContent and extracts the first text part", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "OK" }]
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = createGeminiModelProvider({
      apiKey: "test-api-key",
      model: "gemini-3-flash-preview"
    });

    const response = await provider.generateText({
      messages: [{ role: "user", content: "Responda OK" }]
    });

    expect(response).toEqual({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      text: "OK"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchCalls[0]?.url).toContain("/models/gemini-3-flash-preview:generateContent");
    expect(JSON.stringify(JSON.parse(String(fetchCalls[0]?.init?.body)))).not.toContain(
      "test-api-key"
    );
  });

  it("passes a response schema to Gemini when requested", async () => {
    const fetchCalls: Array<{ init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ init });
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "{}" }] } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = createGeminiModelProvider({
      apiKey: "test-api-key",
      model: "gemini-3-flash-preview"
    });

    await provider.generateText({
      messages: [{ role: "user", content: "planeje" }],
      responseSchema: {
        type: "object",
        properties: {
          toolName: { type: "string" }
        },
        required: ["toolName"]
      }
    });

    const body = JSON.parse(String(fetchCalls[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            toolName: { type: "string" }
          },
          required: ["toolName"]
        }
      }
    });
  });

  it("reports Gemini API errors without leaking the API key", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            status: "RESOURCE_EXHAUSTED",
            message: "quota exceeded for project"
          }
        }),
        { status: 429, headers: { "content-type": "application/json" } }
      )
    ) as typeof fetch;

    const provider = createGeminiModelProvider({
      apiKey: "test-api-key",
      model: "gemini-3-flash-preview"
    });

    await expect(
      provider.generateText({
        messages: [{ role: "user", content: "teste" }]
      })
    ).rejects.toThrow(/Gemini API request failed: 429 RESOURCE_EXHAUSTED quota exceeded/);

    await expect(
      provider.generateText({
        messages: [{ role: "user", content: "teste" }]
      })
    ).rejects.not.toThrow("test-api-key");
  });
});
