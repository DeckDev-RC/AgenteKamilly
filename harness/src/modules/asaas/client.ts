import { readFileSync } from "node:fs";

import { parse } from "dotenv";

import { RECAPTURE_COMMANDS } from "../../core/recapture-commands.js";
import { looksLikeHtml, requestWithRetry, SessionExpiredError } from "../../core/http-client.js";

const ASAAS_BASE_URL = "https://www.asaas.com";
const ASAAS_RECAPTURE = RECAPTURE_COMMANDS.asaas;

export type AsaasSessionClient = {
  listCustomersPage(offset?: number, max?: number): Promise<string>;
  listChargesPage(customerId: string, offset?: number, max?: number): Promise<string>;
  getChargeDetailHtml(chargeId: string): Promise<string>;
};

export type CreateBoletoChargeInput = {
  customerId: string;
  valueBr: string;
  dueDateBr: string;
  description: string;
};

export type CreateBoletoChargeResult = {
  paymentId?: string;
  externalToken?: string;
  raw: unknown;
};

export type AsaasMutationClient = AsaasSessionClient & {
  updateChargeDueDate(chargeId: string, dueDateBr: string): Promise<{ ok: boolean; status: number }>;
  createBoletoCharge(input: CreateBoletoChargeInput): Promise<CreateBoletoChargeResult>;
  downloadBoletoPdf(externalToken: string): Promise<Buffer>;
};

export type MappedAsaasSessionClientOptions = {
  cookieString: string;
  baseUrl?: string;
  request?: typeof requestWithRetry;
};

export class MappedAsaasSessionClient implements AsaasSessionClient {
  private readonly cookieString: string;
  private readonly baseUrl: string;
  private readonly request: typeof requestWithRetry;

  constructor(options: MappedAsaasSessionClientOptions) {
    if (!options.cookieString.trim()) {
      throw new Error("Asaas COOKIE_STRING is required.");
    }

    this.cookieString = options.cookieString;
    this.baseUrl = options.baseUrl ?? ASAAS_BASE_URL;
    this.request = options.request ?? requestWithRetry;
  }

  async listCustomersPage(offset = 0, max = 50): Promise<string> {
    const url = `${this.baseUrl}/customerAccount/loadTableContent?offset=${offset}&max=${max}`;
    const response = await this.request(url, { headers: this.headers() });
    return await readJsonContent(response, "customers");
  }

  async listChargesPage(customerId: string, offset = 0, max = 100): Promise<string> {
    const url = `${this.baseUrl}/paymentList/loadTableContent?customerAccountId=${encodeURIComponent(
      customerId
    )}&offset=${offset}&max=${max}`;
    const response = await this.request(url, { headers: this.headers() });
    return await readJsonContent(response, "charges");
  }

  async getChargeDetailHtml(chargeId: string): Promise<string> {
    const url = `${this.baseUrl}/payment/show/${encodeURIComponent(chargeId)}`;
    const response = await this.request(url, { headers: this.headers() });

    if (!response.ok) {
      throw new Error(`Asaas charge detail request failed with HTTP ${response.status}.`);
    }

    return response.text();
  }

  async updateChargeDueDate(
    chargeId: string,
    dueDateBr: string
  ): Promise<{ ok: boolean; status: number }> {
    const formData = new URLSearchParams();
    formData.append("id", chargeId);
    formData.append("dueDate", dueDateBr);

    const response = await this.request(`${this.baseUrl}/payment/update`, {
      method: "POST",
      headers: {
        ...this.headers(),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: formData.toString(),
      redirect: "manual"
    });

    return { ok: response.status === 200 || response.status === 302, status: response.status };
  }

  async createBoletoCharge(input: CreateBoletoChargeInput): Promise<CreateBoletoChargeResult> {
    const formData = new URLSearchParams();
    formData.append("customerAccountId", input.customerId);
    formData.append("chargeType", "DETACHED");
    formData.append("chargeTarget", "individual");
    formData.append("billingType", "BOLETO");
    formData.append("totalValue", input.valueBr);
    formData.append("value", input.valueBr);
    formData.append("dueDate", input.dueDateBr);
    formData.append("interest.value", "2,00");
    formData.append("fine.fineType", "PERCENTAGE");
    formData.append("fine.value", "1,00");
    formData.append("description", input.description);

    const response = await this.request(`${this.baseUrl}/payment/save`, {
      method: "POST",
      headers: {
        ...this.headers(),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: formData.toString(),
      redirect: "manual"
    });

    if (!response.ok) {
      throw new Error(`Asaas boleto creation failed with HTTP ${response.status}.`);
    }

    const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      paymentId: stringValue(raw.pid) ?? stringValue(raw.id),
      externalToken: stringValue(raw.externalTokens) ?? stringValue(raw.externalToken),
      raw
    };
  }

  async downloadBoletoPdf(externalToken: string): Promise<Buffer> {
    const response = await this.request(
      `${this.baseUrl}/b/pdf/${encodeURIComponent(externalToken)}`,
      { headers: this.headers() }
    );

    if (!response.ok) {
      throw new Error(`Asaas boleto PDF download failed with HTTP ${response.status}.`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private headers(): Record<string, string> {
    return {
      Cookie: this.cookieString,
      Accept: "application/json, text/html, */*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari"
    };
  }
}

export function loadAsaasCookieString(envPath: string): string {
  const parsed = parse(readFileSync(envPath, "utf-8"));
  const cookie = parsed.COOKIE_STRING;
  if (!cookie?.trim()) {
    throw new Error(`COOKIE_STRING not found in ${envPath}.`);
  }
  return cookie;
}

async function readJsonContent(response: Response, label: string): Promise<string> {
  if (response.status === 401 || response.status === 403) {
    throw new SessionExpiredError(
      "asaas",
      `Sessão do Asaas rejeitada (HTTP ${response.status}).`,
      ASAAS_RECAPTURE
    );
  }
  if (!response.ok) {
    throw new Error(`Asaas ${label} request failed with HTTP ${response.status}.`);
  }

  // Sessão expirada costuma vir como 200 + HTML de login: tratamos como expiração
  // limpa em vez de deixar JSON.parse estourar com "Unexpected token '<'".
  const text = await response.text();
  if (looksLikeHtml(response.headers.get("content-type"), text)) {
    throw new SessionExpiredError(
      "asaas",
      "Sessão do Asaas expirada (o provedor devolveu uma página de login).",
      ASAAS_RECAPTURE
    );
  }

  let json: { content?: unknown };
  try {
    json = JSON.parse(text) as { content?: unknown };
  } catch {
    throw new SessionExpiredError(
      "asaas",
      "Resposta inesperada do Asaas (não-JSON); a sessão pode ter expirado.",
      ASAAS_RECAPTURE
    );
  }
  return typeof json.content === "string" ? json.content : "";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}
