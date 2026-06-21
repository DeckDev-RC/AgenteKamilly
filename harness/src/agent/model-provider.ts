export type ModelProviderName = "gemini";

export type JsonSchema = {
  [key: string]: unknown;
};

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelRequest = {
  messages: ModelMessage[];
  timeoutMs?: number;
  responseSchema?: JsonSchema;
};

export type ModelResponse = {
  provider: ModelProviderName;
  model: string;
  text: string;
};

export type ModelProvider = {
  name: ModelProviderName;
  model: string;
  generateText(input: ModelRequest): Promise<ModelResponse>;
};
