import type { ChargeLinks, CustomerMatch, PendingCharge } from "../../core/tool-types.js";

const ASAAS_BASE_URL = "https://www.asaas.com";

export function parseCustomerTableContent(content: string): CustomerMatch[] {
  const customers: CustomerMatch[] = [];
  const rowRegex = /data-id=["']([^"']+)["']([\s\S]*?)(?=data-id=["']|$)/g;
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(content)) !== null) {
    const [, id, row] = match;
    const name = firstAtlasText(row, /\bbold\b/i);
    if (!name) continue;

    const customer: CustomerMatch = {
      id,
      name
    };

    const email = atlasTextAfterIcon(row, "envelope");
    if (email) customer.email = email;

    const phone = atlasTextAfterIcon(row, "phone");
    if (phone) customer.phone = phone;

    customers.push(customer);
  }

  return customers;
}

export function filterCustomersByQuery(
  customers: CustomerMatch[],
  query: string
): CustomerMatch[] {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return customers;

  return customers.filter((customer) =>
    normalizeForSearch(customer.name).includes(normalizedQuery)
  );
}

export function parsePendingChargesTableContent(
  content: string,
  customerId: string
): PendingCharge[] {
  const charges: PendingCharge[] = [];
  const rowRegex = /data-payment-id=["']([^"']+)["']([\s\S]*?)(?=data-payment-id=["']|$)/g;
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(content)) !== null) {
    const [, id, row] = match;
    const status = extractAttribute(row, "tooltip") ?? extractAttribute(row, "data-original-title");

    if (normalizeForSearch(status ?? "") !== "aguardando pagamento") {
      continue;
    }

    const valueBr = normalizeText(row.match(/R\$\s*[\d.,]+/)?.[0] ?? "R$ 0,00");
    const dueDateBr = normalizeText(row.match(/\b\d{2}\/\d{2}\/\d{4}\b/)?.[0] ?? "");
    const customerName = firstAtlasText(row, /\bellipsis\b/i);
    const description = extractChargeDescription(row);

    const charge: PendingCharge = {
      id,
      customerId,
      valueBr,
      dueDateBr,
      status: status ? normalizeText(status) : "Desconhecido"
    };

    if (customerName) charge.customerName = customerName;
    if (description) charge.description = description;

    charges.push(charge);
  }

  return charges;
}

export function parseChargeLinksFromHtml(html: string, chargeId: string): ChargeLinks {
  const boletoPath = extractBoletoPath(html);
  const invoiceToken = extractInvoiceToken(html);
  const token = boletoPath ? lastPathSegment(boletoPath) : invoiceToken;

  const links: ChargeLinks = { chargeId };

  if (boletoPath) {
    links.boletoUrl = toAsaasUrl(boletoPath);
  } else if (token) {
    links.boletoUrl = `${ASAAS_BASE_URL}/b/pdf/${token}`;
  }

  if (invoiceToken) {
    links.invoiceUrl = `${ASAAS_BASE_URL}/i/${invoiceToken}`;
  } else if (token) {
    links.invoiceUrl = `${ASAAS_BASE_URL}/i/${token}`;
  }

  if (token) {
    links.externalToken = token;
  }

  return links;
}

function firstAtlasText(row: string, attributePattern: RegExp): string | undefined {
  const tagRegex = /<atlas-text\b([^>]*)>([\s\S]*?)<\/atlas-text>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(row)) !== null) {
    if (attributePattern.test(match[1])) {
      return normalizeText(match[2]);
    }
  }
  return undefined;
}

function atlasTextAfterIcon(row: string, iconName: string): string | undefined {
  const escapedIconName = escapeRegExp(iconName);
  const regex = new RegExp(
    `<atlas-icon\\b[^>]*name=["']${escapedIconName}["'][^>]*>[\\s\\S]*?<atlas-text\\b[^>]*>([\\s\\S]*?)<\\/atlas-text>`,
    "i"
  );
  const match = row.match(regex);
  return match ? normalizeText(match[1]) : undefined;
}

function extractAttribute(markup: string, attributeName: string): string | undefined {
  const escaped = escapeRegExp(attributeName);
  const regex = new RegExp(`${escaped}=["']([^"']+)["']`, "i");
  const match = markup.match(regex);
  return match ? decodeHtmlEntities(match[1]) : undefined;
}

function extractChargeDescription(row: string): string | undefined {
  const columnRegex = /<atlas-table-col\b[^>]*>([\s\S]*?)<\/atlas-table-col>/gi;
  let match: RegExpExecArray | null;

  while ((match = columnRegex.exec(row)) !== null) {
    const text = normalizeText(match[1]);
    if (/(MENSAL|ANUAL|SERVI[CÇ]O|PRODUTO|HONOR[ÁA]RIO)/i.test(text)) {
      return text;
    }
  }

  return undefined;
}

function extractBoletoPath(html: string): string | undefined {
  const tagMatch = html.match(/<[^>]*class=["'][^"']*\bjs-boleto-link\b[^"']*["'][^>]*>/i);
  if (tagMatch) {
    const value = extractAttribute(tagMatch[0], "value");
    if (value) return value;
  }

  const reverseMatch =
    html.match(/value=["']([^"']+)["'][^>]*class=["'][^"']*\bjs-boleto-link\b[^"']*["']/i) ??
    html.match(/class=["'][^"']*\bjs-boleto-link\b[^"']*["'][^>]*value=["']([^"']+)["']/i);

  return reverseMatch?.[1] ? decodeHtmlEntities(reverseMatch[1]) : undefined;
}

function extractInvoiceToken(html: string): string | undefined {
  const match = html.match(/href=["']\/i\/([^"'?#]+)(?:[?#][^"']*)?["']/i);
  return match ? decodeHtmlEntities(match[1]) : undefined;
}

function lastPathSegment(pathOrUrl: string): string | undefined {
  const clean = pathOrUrl.split("?")[0].split("#")[0];
  const match = clean.match(/\/([^/]+)$/);
  return match ? decodeHtmlEntities(match[1]) : undefined;
}

function toAsaasUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${ASAAS_BASE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function normalizeForSearch(value: string): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeText(value: string): string {
  return stripTags(decodeHtmlEntities(value)).replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCharCode(Number(decimal)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
