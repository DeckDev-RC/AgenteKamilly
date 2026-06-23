import path from "node:path";

import { resolveProjectRoot } from "./project-root.js";
import { parseRuntimeMode } from "./dry-run.js";
import type { RuntimeMode } from "./tool-types.js";

export type HarnessConfig = {
  asaasEnvPath: string;
  contaAzulEnvPath: string;
  contaAzulStatePath: string;
  contaAzulFinancialAccountId: string;
  contaAzulDefaultReplyToEmail: string;
  contaAzulDefaultCompanyDisplayName: string;
  artifactsDir: string;
  ledgerPath: string;
  runtimeMode: RuntimeMode;
  allowLiveMutations: boolean;
  agentModelProvider: "gemini";
  agentModelName: string;
  geminiApiKey: string;
  agentModelMaxRpm: number;
  agentModelMaxDailyRequests: number;
  agentModelMaxInputTpm: number;
  agentSessionsDir: string;
  agentModelUsagePath: string;
};

type Env = Record<string, string | undefined>;

export function loadHarnessConfig(env: Env = process.env, cwd = process.cwd()): HarnessConfig {
  const root = resolveProjectRoot(cwd);
  const artifactsDir = resolveHarnessPath(root, env.ARTIFACTS_DIR ?? "artifacts");

  return {
    asaasEnvPath: resolveHarnessPath(root, env.ASAAS_ENV_PATH ?? ".env"),
    contaAzulEnvPath: resolveHarnessPath(root, env.CONTAAZUL_ENV_PATH ?? "contaazul/.env"),
    contaAzulStatePath: resolveHarnessPath(root, env.CONTAAZUL_STATE_PATH ?? "contaazul/state.json"),
    contaAzulFinancialAccountId: env.CONTAAZUL_FINANCIAL_ACCOUNT_ID ?? "",
    contaAzulDefaultReplyToEmail: env.CONTAAZUL_DEFAULT_REPLY_TO_EMAIL ?? "",
    contaAzulDefaultCompanyDisplayName: env.CONTAAZUL_DEFAULT_COMPANY_DISPLAY_NAME ?? "",
    artifactsDir,
    ledgerPath: resolveHarnessPath(
      root,
      env.LEDGER_PATH ?? path.join("artifacts", "ledger", "operations.jsonl")
    ),
    runtimeMode: parseRuntimeMode(env.RUNTIME_MODE),
    allowLiveMutations: parseBoolean(env.ALLOW_LIVE_MUTATIONS),
    agentModelProvider: parseAgentModelProvider(env.AGENT_MODEL_PROVIDER),
    agentModelName: env.AGENT_MODEL_NAME ?? "gemini-3-flash-preview",
    geminiApiKey: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? "",
    agentModelMaxRpm: parsePositiveInteger(env.AGENT_MODEL_MAX_RPM, 4),
    agentModelMaxDailyRequests: parsePositiveInteger(env.AGENT_MODEL_MAX_DAILY_REQUESTS, 100),
    agentModelMaxInputTpm: parsePositiveInteger(env.AGENT_MODEL_MAX_INPUT_TPM, 100000),
    agentSessionsDir: resolveHarnessPath(
      root,
      env.AGENT_SESSIONS_DIR ?? path.join(artifactsDir, "agent", "sessions")
    ),
    agentModelUsagePath: resolveHarnessPath(
      root,
      env.AGENT_MODEL_USAGE_PATH ?? path.join(artifactsDir, "agent", "model-usage.json")
    )
  };
}

function parseBoolean(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

function parseAgentModelProvider(value: string | undefined): "gemini" {
  if (!value || value === "gemini") return "gemini";
  throw new Error("AGENT_MODEL_PROVIDER must be gemini.");
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Agent model limits must be positive integers.");
  }
  return parsed;
}

function resolveHarnessPath(cwd: string, value: string): string {
  return path.resolve(cwd, value).replace(/\\/g, "/");
}
