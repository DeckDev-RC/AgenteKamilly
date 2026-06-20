import type { ModelProvider, ModelRequest, ModelResponse } from "./model-provider.js";

export type RateLimitOptions = {
  maxRpm: number;
  maxDailyRequests: number;
  maxInputTpm: number;
  now?: () => number;
};

export function createRateLimitedModelProvider(
  wrapped: ModelProvider,
  options: RateLimitOptions
): ModelProvider {
  const now = options.now ?? Date.now;
  const requestTimestamps: number[] = [];
  const inputTokenEvents: Array<{ timestamp: number; tokens: number }> = [];
  let dailyKey = pacificDateKey(now());
  let dailyRequests = 0;

  return {
    name: wrapped.name,
    model: wrapped.model,
    async generateText(input: ModelRequest): Promise<ModelResponse> {
      const currentTime = now();
      const currentDailyKey = pacificDateKey(currentTime);
      if (currentDailyKey !== dailyKey) {
        dailyKey = currentDailyKey;
        dailyRequests = 0;
      }

      pruneOlderThan(requestTimestamps, currentTime - 60_000);
      pruneTokenEventsOlderThan(inputTokenEvents, currentTime - 60_000);

      if (dailyRequests >= options.maxDailyRequests) {
        throw new Error("Agent model daily request limit exceeded.");
      }
      if (requestTimestamps.length >= options.maxRpm) {
        throw new Error("Agent model RPM limit exceeded.");
      }

      const inputTokens = estimateInputTokens(input);
      const currentInputTokens = inputTokenEvents.reduce((sum, event) => sum + event.tokens, 0);
      if (currentInputTokens + inputTokens > options.maxInputTpm) {
        throw new Error("Agent model input TPM limit exceeded.");
      }

      requestTimestamps.push(currentTime);
      inputTokenEvents.push({ timestamp: currentTime, tokens: inputTokens });
      dailyRequests++;

      return wrapped.generateText(input);
    }
  };
}

function estimateInputTokens(input: ModelRequest): number {
  return input.messages.reduce((sum, message) => {
    const tokenCount = message.content.trim().split(/\s+/).filter(Boolean).length;
    return sum + tokenCount;
  }, 0);
}

function pruneOlderThan(timestamps: number[], minTimestamp: number): void {
  while (timestamps[0] !== undefined && timestamps[0] <= minTimestamp) {
    timestamps.shift();
  }
}

function pruneTokenEventsOlderThan(
  events: Array<{ timestamp: number; tokens: number }>,
  minTimestamp: number
): void {
  while (events[0] !== undefined && events[0].timestamp <= minTimestamp) {
    events.shift();
  }
}

function pacificDateKey(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(timestamp));
}
