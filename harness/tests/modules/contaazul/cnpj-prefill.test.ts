import { describe, expect, it } from "vitest";

import {
  mergePrefillIntoFormDefaults,
  normalizeCnpjCompanyInfo,
  prefillToFormDefaults
} from "../../../src/modules/contaazul/cnpj-prefill.js";

describe("cnpj-prefill", () => {
  it("normalizes Conta Azul company-info payload into form fields", () => {
    const prefill = normalizeCnpjCompanyInfo({
      companyName: "AZUOS ASSESSORIA CONTABIL LTDA",
      tradingName: "AZUOS ASSESSORIA",
      email: "contato@azuos.com.br",
      phoneNumber: "6233334444",
      zipCode: "74000000",
      streetName: "RUA 10",
      addressNumber: "100",
      neighborhood: "CENTRO",
      state: "GO"
    });

    expect(prefill.name).toBe("AZUOS ASSESSORIA");
    expect(prefill.companyName).toBe("AZUOS ASSESSORIA CONTABIL LTDA");
    expect(prefill.billingEmail).toBe("contato@azuos.com.br");
    expect(prefill.zipcode).toBe("74000-000");
    expect(prefill.numberAddress).toBe("100");

    expect(prefillToFormDefaults(prefill)).toMatchObject({
      name: "AZUOS ASSESSORIA",
      companyName: "AZUOS ASSESSORIA CONTABIL LTDA",
      email: "contato@azuos.com.br",
      billingEmail: "contato@azuos.com.br",
      zipcode: "74000-000",
      numberAddress: "100"
    });
  });

  it("only fills empty form defaults when merging prefill", () => {
    const merged = mergePrefillIntoFormDefaults(
      { name: "Nome manual", document: "12.345.678/0001-90" },
      { name: "Da Receita", companyName: "Empresa LTDA", email: "auto@empresa.com.br" }
    );

    expect(merged.name).toBe("Nome manual");
    expect(merged.companyName).toBe("Empresa LTDA");
    expect(merged.email).toBe("auto@empresa.com.br");
  });

  it("ignores redacted placeholders when merging prefill", () => {
    const merged = mergePrefillIntoFormDefaults(
      { email: "[REDACTED_EMAIL]" },
      { email: "contato@empresa.com.br", billingEmail: "[REDACTED_EMAIL]" }
    );

    expect(merged.email).toBe("contato@empresa.com.br");
    expect(merged.billingEmail).toBeUndefined();
  });
});
