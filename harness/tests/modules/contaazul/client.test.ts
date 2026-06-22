import { describe, expect, it } from "vitest";

import type { BrowserState } from "../../../src/core/session-store.js";
import type { requestWithRetry } from "../../../src/core/http-client.js";
import { MappedContaAzulSessionClient } from "../../../src/modules/contaazul/client.js";

const state: BrowserState = {
  cookies: [
    { name: "auth-token-accountancy", value: "accountancy-token-test", expires: 4102444800 },
    { name: "ca_session", value: "session-test", expires: 4102444800 }
  ]
};

describe("MappedContaAzulSessionClient", () => {
  it("lists accountancy clients with captured Mais session headers", async () => {
    const requests: Array<{ url: string; options: RequestInit }> = [];
    const client = new MappedContaAzulSessionClient({
      state,
      request: fakeRequestSequence(requests, [
        jsonResponse({ items: [{ id: "rel_001", tenantId: 101, name: "Cliente Exemplo Ltda" }] })
      ])
    });

    await client.listAccountancyClients();

    expect(requests[0]?.url).toBe(
      "https://services.contaazul.com/camais-acc-customers/v2/customers?search=&page=1&pageSize=150&tabFilter=ALL"
    );
    expect(new Headers(requests[0]?.options.headers).get("Cookie")).toContain(
      "ca_session=session-test"
    );
    expect(new Headers(requests[0]?.options.headers).get("accountancy-token")).toBe(
      "accountancy-token-test"
    );
  });

  it("switches relation session and extracts the Pro auth token from mapped redirects", async () => {
    const requests: Array<{ url: string; options: RequestInit }> = [];
    const client = new MappedContaAzulSessionClient({
      state,
      request: fakeRequestSequence(requests, [
        textResponse("", 302, "redirect_token=redirect-token-test; Path=/"),
        textResponse("", 303, "auth-token=pro-token-test; Path=/")
      ])
    });

    const proSession = await client.switchToProSession("rel_001");

    expect(proSession).toEqual({ relationId: "rel_001", authToken: "pro-token-test" });
    expect(requests[0]?.url).toBe(
      "https://accountancy.contaazul.com/rest/relation/rel_001/login?isCaMaisPlan=false"
    );
    expect(requests[1]?.url).toBe("https://app.contaazul.com/rest/login/heimdall");
    expect(new Headers(requests[1]?.options.headers).get("Cookie")).toContain(
      "redirect_token=redirect-token-test"
    );
  });

  it("searches financial statement pages with Pro auth token", async () => {
    const requests: Array<{ url: string; options: RequestInit }> = [];
    const client = new MappedContaAzulSessionClient({
      state,
      request: fakeRequestSequence(requests, [
        jsonResponse({ items: [{ id: "inst_001", financialEventId: "event_001" }] })
      ])
    });

    const items = await client.searchFinancialStatement({
      authToken: "pro-token-test",
      query: "honorarios",
      pageSize: 100
    });

    expect(items).toEqual([{ id: "inst_001", financialEventId: "event_001" }]);
    expect(requests[0]?.url).toBe(
      "https://services.contaazul.com/finance-pro-reader/v1/financial-statement-view?page=1&page_size=100"
    );
    expect(new Headers(requests[0]?.options.headers).get("x-authorization")).toBe(
      "pro-token-test"
    );
    expect(requests[0]?.options.body).toBe(JSON.stringify({ search: "honorarios" }));
  });

  it("loads sale financial events by reference with Pro auth token", async () => {
    const requests: Array<{ url: string; options: RequestInit }> = [];
    const client = new MappedContaAzulSessionClient({
      state,
      request: fakeRequestSequence(requests, [
        jsonResponse({ items: [{ id: "event_sale" }] })
      ])
    });

    const events = await client.getFinancialEventsByReference({
      authToken: "pro-token-test",
      saleId: "sale_uuid"
    });

    expect(events).toEqual([{ id: "event_sale" }]);
    expect(requests[0]?.url).toBe(
      "https://services.contaazul.com/finance-pro/v1/financial-events?reference_id=sale_uuid"
    );
    expect(new Headers(requests[0]?.options.headers).get("x-authorization")).toBe(
      "pro-token-test"
    );
  });

  it("loads financial event summary for charge request polling", async () => {
    const requests: Array<{ url: string; options: RequestInit }> = [];
    const summary = { paymentCondition: { installments: [] } };
    const client = new MappedContaAzulSessionClient({
      state,
      request: fakeRequestSequence(requests, [jsonResponse(summary)])
    });

    await expect(
      client.getFinancialEventSummary({
        authToken: "pro-token-test",
        financialEventId: "event_sale"
      })
    ).resolves.toEqual(summary);
    expect(requests[0]?.url).toBe(
      "https://services.contaazul.com/contaazul-bff/finance/v1/financial-events/event_sale/summary"
    );
  });

  it("downloads an aggregated boleto PDF by charge request", async () => {
    const requests: Array<{ url: string; options: RequestInit }> = [];
    const client = new MappedContaAzulSessionClient({
      state,
      request: fakeRequestSequence(requests, [binaryResponse("%PDF-test")])
    });

    const pdf = await client.downloadBoletoPdf({
      authToken: "pro-token-test",
      customerName: "Cliente Exemplo",
      chargeRequestId: "charge_new",
      chargeUrl: "https://boleto.example.test/fatura"
    });

    expect(pdf.toString()).toBe("%PDF-test");
    expect(requests[0]?.url).toBe(
      "https://services.contaazul.com/finance-pro-reports/v3/aggregate-pdfs-by-customer"
    );
    expect(requests[0]?.options.body).toBe(
      JSON.stringify([
        {
          name: "Cliente Exemplo",
          chargeRequests: [{ id: "charge_new", url: "https://boleto.example.test/fatura" }]
        }
      ])
    );
  });

  it("throws a technical error when Pro session verification receives a non-auth HTTP failure", async () => {
    const requests: Array<{ url: string; options: RequestInit }> = [];
    const client = new MappedContaAzulSessionClient({
      state,
      request: fakeRequestSequence(requests, [textResponse("temporary failure", 500, "")])
    });

    await expect(client.verifyProSession({ authToken: "pro-token-test" })).rejects.toThrow(
      "Conta Azul Pro session health check failed with HTTP 500."
    );
    expect(requests[0]?.url).toBe(
      "https://services.contaazul.com/app/v1/negotiations/next-number"
    );
  });

  it("resolves sale setup data through mapped read endpoints", async () => {
    const requests: Array<{ url: string; options: RequestInit }> = [];
    const client = new MappedContaAzulSessionClient({
      state,
      request: fakeRequestSequence(requests, [
        jsonResponse({ items: [{ uuid: "person_uuid", name: "Cliente Exemplo" }] }),
        jsonResponse({ data: [{ uuid: "cat_uuid", dsNaturezaFinanceira: "Honorario" }] }),
        jsonResponse({ items: [{ id: "item_uuid", name: "Honorario Contabil" }] }),
        jsonResponse({ items: [{ uuid: "nature_uuid", operationTemplate: "PRESTACAO_SERVICO" }] }),
        jsonResponse({ data: 123 })
      ])
    });

    await expect(
      client.searchSaleCustomers({ authToken: "pro-token-test", searchTerm: "Cliente" })
    ).resolves.toEqual([{ uuid: "person_uuid", name: "Cliente Exemplo" }]);
    await expect(
      client.searchFinancialCategories({ authToken: "pro-token-test", searchTerm: "Honorario" })
    ).resolves.toEqual([{ uuid: "cat_uuid", dsNaturezaFinanceira: "Honorario" }]);
    await expect(
      client.searchServiceItems({ authToken: "pro-token-test", searchTerm: "Honorario" })
    ).resolves.toEqual([{ id: "item_uuid", name: "Honorario Contabil" }]);
    await expect(
      client.listOperationNatures({ authToken: "pro-token-test" })
    ).resolves.toEqual([{ uuid: "nature_uuid", operationTemplate: "PRESTACAO_SERVICO" }]);
    await expect(client.getNextSaleNumber({ authToken: "pro-token-test" })).resolves.toBe(123);

    expect(requests.map((request) => request.url)).toEqual([
      "https://services.contaazul.com/contaazul-bff/person-registration/v2/persons?search_term=Cliente&page=1&page_size=20&profile_type=CUSTOMER&person_status=active&recover_legacy_id=true&textual_search_only=true",
      "https://services.contaazul.com/app/financialCategory/autocomplete?page=0&pageSize=20&textualSearch=Honorario&type=RECEITA&financeOrigin=SALES",
      "https://services.contaazul.com/inventory/v1/products?page=1&page_size=20&search=Honorario&serviceType=PROVIDED&searchProductKitEnabled=true",
      "https://services.contaazul.com/contaazul-bff/sale/v1/sales-operation-natures",
      "https://services.contaazul.com/app/v1/negotiations/next-number"
    ]);
  });

  it("calls lookupCnpj, lookupCep, calculateTaxes, getPersonDetails, getCompanyDetails, getBillingContact", async () => {
    const requests: Array<{ url: string; options: RequestInit }> = [];
    const client = new MappedContaAzulSessionClient({
      state,
      request: fakeRequestSequence(requests, [
        jsonResponse({ name: "Empresa CNPJ" }),
        jsonResponse({ idCidade: 1234 }),
        jsonResponse({ calculated: true }),
        jsonResponse({ name: "Pessoa Detalhada" }),
        jsonResponse({ name: "Empresa Conta Azul" }),
        jsonResponse({ email: "billing@cobranca.com" })
      ])
    });

    await expect(client.lookupCnpj({ authToken: "token", cnpj: "05.570.714/0001-59" })).resolves.toEqual({ name: "Empresa CNPJ" });
    await expect(client.lookupCep({ cep: "01001-000" })).resolves.toEqual({ idCidade: 1234 });
    await expect(client.calculateTaxes({ authToken: "token", payload: { some: "data" } })).resolves.toEqual({ calculated: true });
    await expect(client.getPersonDetails({ authToken: "token", personUuid: "some-uuid" })).resolves.toEqual({ name: "Pessoa Detalhada" });
    await expect(client.getCompanyDetails({ authToken: "token" })).resolves.toEqual({ name: "Empresa Conta Azul" });
    await expect(client.getBillingContact({ authToken: "token", personId: "some-id" })).resolves.toEqual({ email: "billing@cobranca.com" });

    expect(requests.map((request) => request.url)).toEqual([
      "https://services.contaazul.com/contaazul-bff/account/v1/company-info/05570714000159",
      "https://app.contaazul.com/buscaCep.action?cep=01001000",
      "https://services.contaazul.com/invoice-tax-management/v1/calculate-taxes",
      "https://services.contaazul.com/contaazul-bff/person-registration/v1/persons/some-uuid",
      "https://services.contaazul.com/contaazul-bff/account/v1/company-details-edit",
      "https://services.contaazul.com/contaazul-bff/person-registration/v1/persons/some-id/billing-contact"
    ]);
  });
});

function fakeRequestSequence(
  requests: Array<{ url: string; options: RequestInit }>,
  responses: Response[]
): typeof requestWithRetry {
  return (async (url: string, options: RequestInit = {}) => {
    requests.push({ url, options });
    return responses.shift() ?? jsonResponse({ items: [] });
  }) as typeof requestWithRetry;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function textResponse(body: string, status: number, setCookie: string): Response {
  return new Response(body, {
    status,
    headers: { "set-cookie": setCookie }
  });
}

function binaryResponse(body: string): Response {
  return new Response(Buffer.from(body), {
    status: 200,
    headers: { "content-type": "application/pdf" }
  });
}
