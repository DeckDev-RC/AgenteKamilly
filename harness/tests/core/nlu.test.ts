import { describe, expect, it } from "vitest";

import { detectIntent, extractEntities, understand } from "../../src/core/nlu.js";

// Data fixa para tornar o parsing de datas determinístico (23/06/2026).
const NOW = new Date(2026, 5, 23, 12, 0, 0);

describe("nlu.detectIntent", () => {
  it("roteia cadastro de cliente", () => {
    expect(detectIntent("quero cadastrar um novo cliente")).toBe("create_customer");
    expect(detectIntent("criar cliente João da Silva")).toBe("create_customer");
  });

  it("não confunde 'emitir boleto para um cliente' com cadastro", () => {
    expect(detectIntent("emitir um boleto para o cliente João")).not.toBe("create_customer");
  });

  it("roteia venda de serviço / boleto Conta Azul", () => {
    expect(detectIntent("fazer uma venda de serviço")).toBe("create_service_sale_boleto");
    expect(detectIntent("emitir boleto na conta azul")).toBe("create_service_sale_boleto");
  });

  it("roteia boleto no Asaas", () => {
    expect(detectIntent("emitir um boleto no asaas")).toBe("create_asaas_boleto");
  });

  it("pede provedor quando o boleto é genérico", () => {
    expect(detectIntent("quero gerar um boleto")).toBe("boleto_provider_choice");
  });

  it("roteia mudança de vencimento por provedor", () => {
    expect(detectIntent("mudar o vencimento do boleto")).toBe("update_due_date_contaazul");
    expect(detectIntent("alterar vencimento no asaas")).toBe("update_due_date_asaas");
  });

  it("roteia download / segunda via", () => {
    expect(detectIntent("baixar o boleto do cliente X")).toBe("download_boleto_asaas");
    expect(detectIntent("preciso da segunda via do boleto")).toBe("download_boleto_asaas");
  });

  it("roteia consulta/entrega de boletos", () => {
    expect(detectIntent("me entregue todos os boletos do cliente AZUOS")).toBe("list_charges");
    expect(detectIntent("boletos vencidos")).toBe("list_charges");
    expect(detectIntent("extrato de junho")).toBe("list_charges");
  });

  it("não trata 'mudar boleto vencido' como consulta", () => {
    expect(detectIntent("mudar o boleto vencido")).toBe("update_due_date_contaazul");
  });

  it("retorna undefined para texto fora do domínio", () => {
    expect(detectIntent("bom dia, tudo bem?")).toBeUndefined();
    expect(detectIntent("")).toBeUndefined();
  });

  it("detecta provedor sem operação concreta", () => {
    const result = understand("Quero fazer outra operação no conta azul", NOW);
    expect(result.intent).toBeUndefined();
    expect(result.entities.provider).toBe("contaazul");
  });
});

describe("nlu.extractEntities", () => {
  it("extrai valor em vários formatos", () => {
    expect(extractEntities("boleto de R$ 250", NOW).valueBr).toBe("250,00");
    expect(extractEntities("valor 1.250,50", NOW).valueBr).toBe("1.250,50");
    expect(extractEntities("cobrança de 90,00", NOW).valueBr).toBe("90,00");
  });

  it("extrai data dd/mm assumindo o ano e rolando para o futuro", () => {
    const e = extractEntities("vencendo 30/06", NOW);
    expect(e.dueDateBr).toBe("30/06/2026");
    expect(e.dueDateIso).toBe("2026-06-30");
  });

  it("entende 'amanhã' e 'dia N'", () => {
    expect(extractEntities("vence amanhã", NOW).dueDateBr).toBe("24/06/2026");
    expect(extractEntities("para o dia 30", NOW).dueDateBr).toBe("30/06/2026");
  });

  it("detecta CPF/CNPJ e infere o tipo de pessoa", () => {
    const cpf = extractEntities("cliente com CPF 123.456.789-09", NOW);
    expect(cpf.document).toBe("12345678909");
    expect(cpf.personType).toBe("Física");
    const cnpj = extractEntities("empresa CNPJ 12.345.678/0001-95", NOW);
    expect(cnpj.document).toBe("12345678000195");
    expect(cnpj.personType).toBe("Jurídica");
  });

  it("não confunde CPF com valor", () => {
    expect(extractEntities("cliente CPF 123.456.789-09 valor 250,00", NOW).valueBr).toBe("250,00");
  });

  it("extrai o nome aproximado do cliente", () => {
    expect(extractEntities("emite um boleto pra AZUOS vencendo 30/06", NOW).customerHint).toBe("AZUOS");
    expect(extractEntities("boletos do cliente Maria Silva", NOW).customerHint).toBe("Maria Silva");
  });

  it("extrai múltiplos clientes em consultas", () => {
    const e = extractEntities("me entregue os boletos dos clientes AZUOS e MAIS NEGOCIOS", NOW);
    expect(e.customerHints).toEqual(["AZUOS", "MAIS NEGOCIOS"]);
    expect(e.customerHint).toBe("AZUOS");
  });

  it("detecta provedor e 'vencidos'", () => {
    expect(extractEntities("boleto no asaas", NOW).provider).toBe("asaas");
    expect(extractEntities("boletos vencidos da empresa X", NOW).onlyOverdue).toBe(true);
  });
});

describe("nlu.understand (frase completa)", () => {
  it("extrai intenção + entidades de uma frase rica", () => {
    const result = understand("emite um boleto de 250 pra AZUOS na conta azul vencendo 30/06", NOW);
    expect(result.intent).toBe("create_service_sale_boleto");
    expect(result.anchorAction).toBe("start_contaazul_service_sale");
    expect(result.entities.valueBr).toBe("250,00");
    expect(result.entities.dueDateBr).toBe("30/06/2026");
    expect(result.entities.customerHint).toBe("AZUOS");
  });
});
