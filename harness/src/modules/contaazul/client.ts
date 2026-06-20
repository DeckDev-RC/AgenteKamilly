import {
  buildCookieString,
  getCookieValue,
  type BrowserState
} from "../../core/session-store.js";
import { requestWithRetry } from "../../core/http-client.js";

const SERVICES_BASE_URL = "https://services.contaazul.com";
const ACCOUNTANCY_BASE_URL = "https://accountancy.contaazul.com";
const APP_BASE_URL = "https://app.contaazul.com";

export type ContaAzulProSession = {
  relationId: string;
  authToken: string;
};

export type SearchFinancialStatementParams = {
  authToken: string;
  query?: string;
  pageSize?: number;
};

export type CancelChargeRequestsParams = {
  authToken: string;
  chargeRequests: unknown[];
};

export type UpdateInstallmentDueDateParams = {
  authToken: string;
  installmentId: string;
  dueDate: string;
  expectedPaymentDate: string;
  isCaPaymentType: boolean;
  version: number;
};

export type CreateChargeRequestParams = {
  authToken: string;
  payload: Record<string, unknown>;
};

export type CreateCustomerParams = {
  authToken: string;
  payload: Record<string, unknown>;
};

export type CreateServiceSaleParams = {
  authToken: string;
  payload: Record<string, unknown>;
};

export type SendChargeNotificationParams = {
  authToken: string;
  payload: Record<string, unknown>;
};

export type GetFinancialEventsByReferenceParams = {
  authToken: string;
  saleId: string;
};

export type GetFinancialEventSummaryParams = {
  authToken: string;
  financialEventId: string;
};

export type DownloadBoletoPdfParams = {
  authToken: string;
  customerName: string;
  chargeRequestId: string;
  chargeUrl: string;
};

export type SearchSaleCustomersParams = {
  authToken: string;
  searchTerm: string;
};

export type SearchFinancialCategoriesParams = {
  authToken: string;
  searchTerm: string;
};

export type SearchServiceItemsParams = {
  authToken: string;
  searchTerm: string;
};

export type ListOperationNaturesParams = {
  authToken: string;
};

export type GetNextSaleNumberParams = {
  authToken: string;
};

export type ContaAzulReadClient = {
  listAccountancyClients(): Promise<unknown>;
  switchToProSession(relationId: string): Promise<ContaAzulProSession>;
  searchFinancialStatement(params: SearchFinancialStatementParams): Promise<unknown[]>;
};

export type ContaAzulMutationClient = ContaAzulReadClient & {
  searchSaleCustomers(params: SearchSaleCustomersParams): Promise<unknown[]>;
  searchFinancialCategories(params: SearchFinancialCategoriesParams): Promise<unknown[]>;
  searchServiceItems(params: SearchServiceItemsParams): Promise<unknown[]>;
  listOperationNatures(params: ListOperationNaturesParams): Promise<unknown[]>;
  getNextSaleNumber(params: GetNextSaleNumberParams): Promise<number>;
  cancelChargeRequests(params: CancelChargeRequestsParams): Promise<{ ok: boolean; status: number }>;
  updateInstallmentDueDate(params: UpdateInstallmentDueDateParams): Promise<unknown>;
  createChargeRequest(params: CreateChargeRequestParams): Promise<unknown>;
  createCustomer(params: CreateCustomerParams): Promise<unknown>;
  createServiceSale(params: CreateServiceSaleParams): Promise<unknown>;
  sendChargeNotification(params: SendChargeNotificationParams): Promise<unknown>;
  getFinancialEventsByReference(params: GetFinancialEventsByReferenceParams): Promise<unknown[]>;
  getFinancialEventSummary(params: GetFinancialEventSummaryParams): Promise<unknown>;
  downloadBoletoPdf(params: DownloadBoletoPdfParams): Promise<Buffer>;
  verifyProSession?(params: { authToken: string }): Promise<boolean>;
};

export class ContaAzulSessionExpiredError extends Error {
  readonly recaptureCommand = "node contaazul/capture.js";

  constructor(message = "Conta Azul session expired.") {
    super(message);
    this.name = "ContaAzulSessionExpiredError";
  }
}

export type MappedContaAzulSessionClientOptions = {
  state: BrowserState;
  request?: typeof requestWithRetry;
};

export class MappedContaAzulSessionClient implements ContaAzulMutationClient {
  private readonly state: BrowserState;
  private readonly request: typeof requestWithRetry;

  constructor(options: MappedContaAzulSessionClientOptions) {
    this.state = options.state;
    this.request = options.request ?? requestWithRetry;
  }

  async listAccountancyClients(): Promise<unknown> {
    const response = await this.request(
      `${SERVICES_BASE_URL}/camais-acc-customers/v2/customers?search=&page=1&pageSize=150&tabFilter=ALL`,
      { headers: this.maisHeaders() }
    );
    assertNotExpired(response);
    if (!response.ok) {
      throw new Error(`Conta Azul client list failed with HTTP ${response.status}.`);
    }
    return response.json();
  }

  async switchToProSession(relationId: string): Promise<ContaAzulProSession> {
    const loginResponse = await this.request(
      `${ACCOUNTANCY_BASE_URL}/rest/relation/${encodeURIComponent(
        relationId
      )}/login?isCaMaisPlan=false`,
      {
        headers: this.maisHeaders(),
        redirect: "manual"
      }
    );
    assertNotExpired(loginResponse);
    if (loginResponse.status !== 302) {
      throw new Error(`Conta Azul relation login failed with HTTP ${loginResponse.status}.`);
    }

    const redirectToken = extractCookieValue(loginResponse.headers, "redirect_token");
    if (!redirectToken) {
      throw new Error("redirect_token not found in Conta Azul relation login response.");
    }

    const heimdallResponse = await this.request(`${APP_BASE_URL}/rest/login/heimdall`, {
      headers: {
        ...this.maisHeaders(),
        Cookie: `${buildCookieString(this.state)}; redirect_token=${redirectToken}`
      },
      redirect: "manual"
    });
    assertNotExpired(heimdallResponse);
    if (heimdallResponse.status !== 303) {
      throw new Error(`Conta Azul heimdall login failed with HTTP ${heimdallResponse.status}.`);
    }

    const authToken = extractCookieValue(heimdallResponse.headers, "auth-token");
    if (!authToken) {
      throw new Error("auth-token not found in Conta Azul heimdall response.");
    }

    return { relationId, authToken };
  }

  async searchFinancialStatement(params: SearchFinancialStatementParams): Promise<unknown[]> {
    const pageSize = params.pageSize ?? 100;
    const allItems: unknown[] = [];
    let page = 1;

    while (true) {
      const response = await this.request(
        `${SERVICES_BASE_URL}/finance-pro-reader/v1/financial-statement-view?page=${page}&page_size=${pageSize}`,
        {
          method: "POST",
          headers: {
            "x-authorization": params.authToken,
            "Content-Type": "application/json",
            Accept: "application/json, text/plain, */*",
            Origin: "https://pro.contaazul.com",
            Referer: "https://pro.contaazul.com/",
            "User-Agent": defaultUserAgent()
          },
          body: JSON.stringify(params.query ? { search: params.query } : {})
        }
      );
      assertNotExpired(response);

      if (!response.ok) {
        throw new Error(`Conta Azul financial statement failed with HTTP ${response.status}.`);
      }

      const json = (await response.json()) as { items?: unknown[] };
      const items = Array.isArray(json.items) ? json.items : [];
      if (items.length === 0) break;

      allItems.push(...items);
      if (items.length < pageSize) break;
      page++;
    }

    return allItems;
  }

  async searchSaleCustomers(params: SearchSaleCustomersParams): Promise<unknown[]> {
    const response = await this.request(
      `${SERVICES_BASE_URL}/contaazul-bff/person-registration/v2/persons?search_term=${encodeURIComponent(
        params.searchTerm
      )}&page=1&page_size=20&profile_type=CUSTOMER&person_status=active&recover_legacy_id=true&textual_search_only=true`,
      {
        headers: proReadHeaders(params.authToken)
      }
    );
    assertNotExpired(response);
    if (!response.ok) {
      throw new Error(`Conta Azul customer search failed with HTTP ${response.status}.`);
    }
    const json = (await response.json()) as { items?: unknown[] };
    return Array.isArray(json.items) ? json.items : [];
  }

  async searchFinancialCategories(params: SearchFinancialCategoriesParams): Promise<unknown[]> {
    const response = await this.request(
      `${SERVICES_BASE_URL}/app/financialCategory/autocomplete?page=0&pageSize=20&textualSearch=${encodeURIComponent(
        params.searchTerm
      )}&type=RECEITA&financeOrigin=SALES`,
      {
        headers: proReadHeaders(params.authToken)
      }
    );
    assertNotExpired(response);
    if (!response.ok) {
      throw new Error(`Conta Azul financial category search failed with HTTP ${response.status}.`);
    }
    const json = (await response.json()) as { data?: unknown[] };
    return Array.isArray(json.data) ? json.data : [];
  }

  async searchServiceItems(params: SearchServiceItemsParams): Promise<unknown[]> {
    const response = await this.request(
      `${SERVICES_BASE_URL}/inventory/v1/products?page=1&page_size=20&search=${encodeURIComponent(
        params.searchTerm
      )}&serviceType=PROVIDED&searchProductKitEnabled=true`,
      {
        headers: proReadHeaders(params.authToken)
      }
    );
    assertNotExpired(response);
    if (!response.ok) {
      throw new Error(`Conta Azul service item search failed with HTTP ${response.status}.`);
    }
    const json = (await response.json()) as { items?: unknown[] };
    return Array.isArray(json.items) ? json.items : [];
  }

  async listOperationNatures(params: ListOperationNaturesParams): Promise<unknown[]> {
    const response = await this.request(
      `${SERVICES_BASE_URL}/contaazul-bff/sale/v1/sales-operation-natures`,
      {
        headers: proReadHeaders(params.authToken)
      }
    );
    assertNotExpired(response);
    if (!response.ok) {
      throw new Error(`Conta Azul operation nature list failed with HTTP ${response.status}.`);
    }
    const json = (await response.json()) as { items?: unknown[] };
    return Array.isArray(json.items) ? json.items : [];
  }

  async getNextSaleNumber(params: GetNextSaleNumberParams): Promise<number> {
    const response = await this.request(`${SERVICES_BASE_URL}/app/v1/negotiations/next-number`, {
      headers: proReadHeaders(params.authToken)
    });
    assertNotExpired(response);
    if (!response.ok) {
      throw new Error(`Conta Azul next sale number failed with HTTP ${response.status}.`);
    }
    const json = (await response.json()) as { data?: unknown };
    const data = json.data;
    if (typeof data === "number" && Number.isFinite(data)) return data;
    if (typeof data === "string" && data.trim()) {
      const parsed = Number(data);
      if (Number.isFinite(parsed)) return parsed;
    }
    throw new Error("Conta Azul next sale number response did not contain a number.");
  }

  async cancelChargeRequests(
    params: CancelChargeRequestsParams
  ): Promise<{ ok: boolean; status: number }> {
    const response = await this.request(
      `${SERVICES_BASE_URL}/finance-pro/v1/charge-requests/batch-cancel`,
      {
        method: "POST",
        headers: proJsonHeaders(params.authToken),
        body: JSON.stringify({ chargeRequests: params.chargeRequests })
      }
    );
    assertNotExpired(response);
    if (response.status !== 204 && !response.ok) {
      throw new Error(`Conta Azul charge cancel failed with HTTP ${response.status}.`);
    }
    return { ok: response.ok || response.status === 204, status: response.status };
  }

  async updateInstallmentDueDate(params: UpdateInstallmentDueDateParams): Promise<unknown> {
    const response = await this.request(
      `${SERVICES_BASE_URL}/finance-pro/v1/installments/${encodeURIComponent(params.installmentId)}`,
      {
        method: "PATCH",
        headers: proJsonHeaders(params.authToken),
        body: JSON.stringify({
          dueDate: params.dueDate,
          expectedPaymentDate: params.expectedPaymentDate,
          isCaPaymentType: params.isCaPaymentType,
          version: params.version
        })
      }
    );
    assertNotExpired(response);
    if (!response.ok) {
      throw new Error(`Conta Azul installment update failed with HTTP ${response.status}.`);
    }
    return readJsonOrText(response);
  }

  async createChargeRequest(params: CreateChargeRequestParams): Promise<unknown> {
    const response = await this.request(
      `${SERVICES_BASE_URL}/finance-pro/v2/charge-requests/batch-create`,
      {
        method: "POST",
        headers: proJsonHeaders(params.authToken),
        body: JSON.stringify(params.payload)
      }
    );
    assertNotExpired(response);
    if (!response.ok) {
      throw new Error(`Conta Azul charge request create failed with HTTP ${response.status}.`);
    }
    return readJsonOrText(response);
  }

  async createCustomer(params: CreateCustomerParams): Promise<unknown> {
    const response = await this.request(
      `${SERVICES_BASE_URL}/contaazul-bff/person-registration/v1/persons`,
      {
        method: "POST",
        headers: proJsonHeaders(params.authToken),
        body: JSON.stringify(params.payload)
      }
    );
    assertNotExpired(response);
    if (!response.ok) {
      throw new Error(`Conta Azul customer create failed with HTTP ${response.status}.`);
    }
    return readJsonOrText(response);
  }

  async createServiceSale(params: CreateServiceSaleParams): Promise<unknown> {
    const response = await this.request(`${SERVICES_BASE_URL}/app/v1/sales/`, {
      method: "POST",
      headers: proJsonHeaders(params.authToken),
      body: JSON.stringify(params.payload)
    });
    assertNotExpired(response);
    if (!response.ok) {
      throw new Error(`Conta Azul service sale create failed with HTTP ${response.status}.`);
    }
    return readJsonOrText(response);
  }

  async sendChargeNotification(params: SendChargeNotificationParams): Promise<unknown> {
    const response = await this.request(
      `${SERVICES_BASE_URL}/finance-pro/v1/charge-notifications`,
      {
        method: "POST",
        headers: proJsonHeaders(params.authToken),
        body: JSON.stringify(params.payload)
      }
    );
    assertNotExpired(response);
    if (!response.ok) {
      throw new Error(`Conta Azul charge notification failed with HTTP ${response.status}.`);
    }
    return readJsonOrText(response);
  }

  async getFinancialEventsByReference(
    params: GetFinancialEventsByReferenceParams
  ): Promise<unknown[]> {
    const response = await this.request(
      `${SERVICES_BASE_URL}/finance-pro/v1/financial-events?reference_id=${encodeURIComponent(
        params.saleId
      )}`,
      {
        headers: proReadHeaders(params.authToken)
      }
    );
    assertNotExpired(response);
    if (!response.ok) {
      throw new Error(`Conta Azul financial event lookup failed with HTTP ${response.status}.`);
    }
    const json = (await response.json()) as { items?: unknown[] };
    return Array.isArray(json.items) ? json.items : [];
  }

  async getFinancialEventSummary(params: GetFinancialEventSummaryParams): Promise<unknown> {
    const response = await this.request(
      `${SERVICES_BASE_URL}/contaazul-bff/finance/v1/financial-events/${encodeURIComponent(
        params.financialEventId
      )}/summary`,
      {
        headers: proReadHeaders(params.authToken)
      }
    );
    assertNotExpired(response);
    if (!response.ok) {
      throw new Error(`Conta Azul financial event summary failed with HTTP ${response.status}.`);
    }
    return response.json();
  }

  async downloadBoletoPdf(params: DownloadBoletoPdfParams): Promise<Buffer> {
    const response = await this.request(
      `${SERVICES_BASE_URL}/finance-pro-reports/v3/aggregate-pdfs-by-customer`,
      {
        method: "POST",
        headers: proJsonHeaders(params.authToken),
        body: JSON.stringify([
          {
            name: params.customerName,
            chargeRequests: [{ id: params.chargeRequestId, url: params.chargeUrl }]
          }
        ])
      }
    );
    assertNotExpired(response);
    if (!response.ok) {
      throw new Error(`Conta Azul boleto PDF download failed with HTTP ${response.status}.`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async verifyProSession(params: { authToken: string }): Promise<boolean> {
    const response = await this.request(`${SERVICES_BASE_URL}/app/v1/negotiations/next-number`, {
      headers: proReadHeaders(params.authToken)
    });
    assertNotExpired(response);
    if (!response.ok) {
      throw new Error(`Conta Azul Pro session health check failed with HTTP ${response.status}.`);
    }
    return true;
  }

  private maisHeaders(): Record<string, string> {
    return {
      Cookie: buildCookieString(this.state),
      "accountancy-token": getCookieValue(this.state, "auth-token-accountancy") ?? "",
      Accept: "application/json, text/plain, */*",
      Referer: "https://mais.contaazul.com/",
      Origin: "https://mais.contaazul.com",
      "User-Agent": defaultUserAgent()
    };
  }
}

function proJsonHeaders(authToken: string): Record<string, string> {
  return {
    "x-authorization": authToken,
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    Origin: "https://pro.contaazul.com",
    Referer: "https://pro.contaazul.com/",
    "User-Agent": defaultUserAgent()
  };
}

function proReadHeaders(authToken: string): Record<string, string> {
  return {
    "x-authorization": authToken,
    Accept: "application/json, text/plain, */*",
    Origin: "https://pro.contaazul.com",
    Referer: "https://pro.contaazul.com/",
    "User-Agent": defaultUserAgent()
  };
}

async function readJsonOrText(response: Response): Promise<unknown> {
  if (response.status === 204) return {};

  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function assertNotExpired(response: Response): void {
  if (response.status === 401 || response.status === 403) {
    throw new ContaAzulSessionExpiredError(
      `Conta Azul session was rejected with HTTP ${response.status}.`
    );
  }
}

function extractCookieValue(headers: Headers, cookieName: string): string | undefined {
  const maybeGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = maybeGetSetCookie.getSetCookie?.() ?? splitCombinedSetCookie(headers.get("set-cookie"));

  for (const cookie of setCookies) {
    const match = cookie.match(new RegExp(`(?:^|;\\s*)${escapeRegExp(cookieName)}=([^;]+)`));
    if (match?.[1]) return match[1];
  }

  return undefined;
}

function splitCombinedSetCookie(value: string | null): string[] {
  if (!value) return [];
  return value.split(/,\s*(?=[^;,]+=)/);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function defaultUserAgent(): string {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari";
}
