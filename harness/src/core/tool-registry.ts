import type { z } from "zod";

const FORBIDDEN_PROVIDER_OFFICIAL_KEYWORDS = [
  "official",
  "oauth",
  "webhook",
  "asaas_mcp",
  "contaazul_mcp"
];

export type ToolDefinition<TParams extends z.ZodType = z.ZodType, TResult = unknown> = {
  name: string;
  description: string;
  parameters: TParams;
  execute: (params: z.infer<TParams>) => Promise<TResult>;
};

export type ToolRegistry = {
  register<TParams extends z.ZodType, TResult>(definition: ToolDefinition<TParams, TResult>): void;
  list(): Array<ToolDefinition<z.ZodType, unknown>>;
};

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDefinition<z.ZodType, unknown>>();

  return {
    register(definition) {
      assertAllowedToolName(definition.name);
      if (tools.has(definition.name)) {
        throw new Error(`Tool already registered: ${definition.name}`);
      }
      tools.set(definition.name, definition as ToolDefinition<z.ZodType, unknown>);
    },
    list() {
      return Array.from(tools.values());
    }
  };
}

function assertAllowedToolName(name: string): void {
  const lowered = name.toLowerCase();
  if (FORBIDDEN_PROVIDER_OFFICIAL_KEYWORDS.some((keyword) => lowered.includes(keyword))) {
    throw new Error(`Tool name is blocked because official provider integrations are forbidden: ${name}`);
  }
}
