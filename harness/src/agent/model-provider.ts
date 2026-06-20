export type ModelProviderName = "gemini";

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelRequest = {
  messages: ModelMessage[];
  timeoutMs?: number;
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
