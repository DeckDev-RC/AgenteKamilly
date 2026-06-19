import { describe, expect, it } from "vitest";

import { redact, redactHeaders, redactString } from "../../src/core/redaction.js";

describe("redaction", () => {
  it("redacts sensitive headers while keeping harmless headers", () => {
    const redacted = redactHeaders({
      Cookie: "sid=secret-session",
      Authorization: "Bearer secret-token",
      "x-authorization": "private-pro-token",
      "accountancy-token": "private-accountancy-token",
      "Content-Type": "application/json"
    });

    expect(redacted).toEqual({
      Cookie: "[REDACTED_SECRET]",
      Authorization: "[REDACTED_SECRET]",
      "x-authorization": "[REDACTED_SECRET]",
      "accountancy-token": "[REDACTED_SECRET]",
      "Content-Type": "application/json"
    });
  });

  it("redacts credentials and personal identifiers deeply", () => {
    const redacted = redact({
      LOGIN: "operator@example.com",
      SENHA: "plain-password",
      customer: {
        email: "client@example.com",
        phone: "(62) 99151-4384",
        cpf: "123.456.789-09",
        cnpj: "12.345.678/0001-90",
        note: "visible note"
      }
    });

    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain("operator@example.com");
    expect(serialized).not.toContain("plain-password");
    expect(serialized).not.toContain("client@example.com");
    expect(serialized).not.toContain("99151-4384");
    expect(serialized).not.toContain("123.456.789-09");
    expect(serialized).not.toContain("12.345.678/0001-90");
    expect(serialized).toContain("visible note");
  });

  it("redacts sensitive tokens embedded in strings", () => {
    const text = redactString("Cookie: sid=abc; auth-token=secret; email a@b.com");

    expect(text).not.toContain("sid=abc");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("a@b.com");
    expect(text).toContain("[REDACTED_SECRET]");
    expect(text).toContain("[REDACTED_EMAIL]");
  });

  it("preserves audit identifiers containing long numeric runs", () => {
    const redacted = redact({
      operationId: "op_controlled_contaazul_sale_20260619201113142",
      approvalText: "APROVAR op_contaazul_sale_1781903486089_6092b931",
      idempotencyKey: "contaazul-sale-boleto:8614c01bfda7d75296250df7fa29d4c5",
      sha256: "705b153b3c3412fce97947f3d9897227fde489be37000a4812ab535f799a15c7"
    });

    expect(redacted).toEqual({
      operationId: "op_controlled_contaazul_sale_20260619201113142",
      approvalText: "APROVAR op_contaazul_sale_1781903486089_6092b931",
      idempotencyKey: "contaazul-sale-boleto:8614c01bfda7d75296250df7fa29d4c5",
      sha256: "705b153b3c3412fce97947f3d9897227fde489be37000a4812ab535f799a15c7"
    });
  });

  it("still masks a formatted phone inside a free-text string", () => {
    const text = redactString("Ligar para (62) 99151-4384 hoje");
    expect(text).not.toContain("99151-4384");
    expect(text).toContain("[REDACTED_PHONE]");
  });
});
