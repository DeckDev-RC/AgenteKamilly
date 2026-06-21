import { describe, expect, it } from "vitest";

import { loadHarnessConfig } from "../../src/core/config.js";

describe("harness config", () => {
  it("loads fail-closed defaults", () => {
    const config = loadHarnessConfig({}, "C:/Kamilly/harness");

    expect(config.runtimeMode).toBe("dry-run");
    expect(config.allowLiveMutations).toBe(false);
    expect(config.asaasEnvPath).toBe("C:/Kamilly/harness/.env");
    expect(config.contaAzulEnvPath).toBe("C:/Kamilly/harness/contaazul/.env");
    expect(config.contaAzulStatePath).toBe("C:/Kamilly/harness/contaazul/state.json");
    expect(config.ledgerPath).toBe("C:/Kamilly/harness/artifacts/ledger/operations.jsonl");
    expect(config.contaAzulFinancialAccountId).toBe("");
    expect(config.contaAzulDefaultReplyToEmail).toBe("");
    expect(config.contaAzulDefaultCompanyDisplayName).toBe("");
    expect(config.agentModelProvider).toBe("gemini");
    expect(config.agentModelName).toBe("gemini-3-flash-preview");
    expect(config.geminiApiKey).toBe("");
    expect(config.agentModelMaxRpm).toBe(4);
    expect(config.agentModelMaxDailyRequests).toBe(100);
    expect(config.agentModelMaxInputTpm).toBe(100000);
    expect(config.agentSessionsDir).toBe("C:/Kamilly/harness/artifacts/agent/sessions");
    expect(config.agentModelUsagePath).toBe("C:/Kamilly/harness/artifacts/agent/model-usage.json");
  });

  it("honors explicit paths and live gates", () => {
    const config = loadHarnessConfig(
      {
        ASAAS_ENV_PATH: "../.env",
        CONTAAZUL_ENV_PATH: "../contaazul/.env",
        CONTAAZUL_STATE_PATH: "../contaazul/state.json",
        ARTIFACTS_DIR: "../artifacts",
        LEDGER_PATH: "../artifacts/ops.jsonl",
        RUNTIME_MODE: "live",
        ALLOW_LIVE_MUTATIONS: "true",
        CONTAAZUL_FINANCIAL_ACCOUNT_ID: "account_test",
        CONTAAZUL_DEFAULT_REPLY_TO_EMAIL: "reply@example.test",
        CONTAAZUL_DEFAULT_COMPANY_DISPLAY_NAME: "Empresa Teste",
        AGENT_MODEL_PROVIDER: "gemini",
        AGENT_MODEL_NAME: "gemini-3.1-flash-lite",
        GEMINI_API_KEY: "test-api-key",
        AGENT_MODEL_MAX_RPM: "7",
        AGENT_MODEL_MAX_DAILY_REQUESTS: "250",
        AGENT_MODEL_MAX_INPUT_TPM: "200000",
        AGENT_SESSIONS_DIR: "../artifacts/test-agent/sessions",
        AGENT_MODEL_USAGE_PATH: "../artifacts/test-agent/model-usage.json"
      },
      "C:/Kamilly/harness"
    );

    expect(config.runtimeMode).toBe("live");
    expect(config.allowLiveMutations).toBe(true);
    expect(config.asaasEnvPath).toBe("C:/Kamilly/.env");
    expect(config.contaAzulEnvPath).toBe("C:/Kamilly/contaazul/.env");
    expect(config.contaAzulStatePath).toBe("C:/Kamilly/contaazul/state.json");
    expect(config.ledgerPath).toBe("C:/Kamilly/artifacts/ops.jsonl");
    expect(config.contaAzulFinancialAccountId).toBe("account_test");
    expect(config.contaAzulDefaultReplyToEmail).toBe("reply@example.test");
    expect(config.contaAzulDefaultCompanyDisplayName).toBe("Empresa Teste");
    expect(config.agentModelProvider).toBe("gemini");
    expect(config.agentModelName).toBe("gemini-3.1-flash-lite");
    expect(config.geminiApiKey).toBe("test-api-key");
    expect(config.agentModelMaxRpm).toBe(7);
    expect(config.agentModelMaxDailyRequests).toBe(250);
    expect(config.agentModelMaxInputTpm).toBe(200000);
    expect(config.agentSessionsDir).toBe("C:/Kamilly/artifacts/test-agent/sessions");
    expect(config.agentModelUsagePath).toBe("C:/Kamilly/artifacts/test-agent/model-usage.json");
  });
});
