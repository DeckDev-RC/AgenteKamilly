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
    expect(config.contaAzulFinancialAccountId).toBe("cf6eedce-10e8-4554-b707-9246826b12c6");
    expect(config.contaAzulDefaultReplyToEmail).toBe("sccontabilidadefinanceiro@gmail.com");
    expect(config.contaAzulDefaultCompanyDisplayName).toBe(
      "MAIS NEGOCIOS ASSESSORIA CONTABIL LTDA"
    );
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
        CONTAAZUL_DEFAULT_COMPANY_DISPLAY_NAME: "Empresa Teste"
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
  });
});
