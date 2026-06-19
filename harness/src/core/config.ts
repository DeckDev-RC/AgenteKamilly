import path from "node:path";

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
};

type Env = Record<string, string | undefined>;

export function loadHarnessConfig(env: Env = process.env, cwd = process.cwd()): HarnessConfig {
  const artifactsDir = resolveHarnessPath(cwd, env.ARTIFACTS_DIR ?? "artifacts");

  return {
    asaasEnvPath: resolveHarnessPath(cwd, env.ASAAS_ENV_PATH ?? ".env"),
    contaAzulEnvPath: resolveHarnessPath(cwd, env.CONTAAZUL_ENV_PATH ?? "contaazul/.env"),
    contaAzulStatePath: resolveHarnessPath(cwd, env.CONTAAZUL_STATE_PATH ?? "contaazul/state.json"),
    contaAzulFinancialAccountId:
      env.CONTAAZUL_FINANCIAL_ACCOUNT_ID ?? "cf6eedce-10e8-4554-b707-9246826b12c6",
    contaAzulDefaultReplyToEmail:
      env.CONTAAZUL_DEFAULT_REPLY_TO_EMAIL ?? "sccontabilidadefinanceiro@gmail.com",
    contaAzulDefaultCompanyDisplayName:
      env.CONTAAZUL_DEFAULT_COMPANY_DISPLAY_NAME ?? "MAIS NEGOCIOS ASSESSORIA CONTABIL LTDA",
    artifactsDir,
    ledgerPath: resolveHarnessPath(
      cwd,
      env.LEDGER_PATH ?? path.join("artifacts", "ledger", "operations.jsonl")
    ),
    runtimeMode: parseRuntimeMode(env.RUNTIME_MODE),
    allowLiveMutations: parseBoolean(env.ALLOW_LIVE_MUTATIONS)
  };
}

function parseBoolean(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

function resolveHarnessPath(cwd: string, value: string): string {
  return path.resolve(cwd, value).replace(/\\/g, "/");
}
