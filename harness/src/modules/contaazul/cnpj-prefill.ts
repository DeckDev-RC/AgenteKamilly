/** Normalização de dados retornados pelo lookup de CNPJ/CEP da Conta Azul. */

import { isRedactedPlaceholder } from "../../core/redaction.js";

export type CustomerCnpjPrefill = {
  name?: string;
  companyName?: string;
  email?: string;
  cellPhone?: string;
  commercialPhone?: string;
  billingEmail?: string;
  zipcode?: string;
  numberAddress?: string;
  street?: string;
  neighborhood?: string;
  complement?: string;
  state?: string;
  cityName?: string;
  idCity?: string | number;
};

function usableValue(value: string | undefined): string | undefined {
  if (!value?.trim() || isRedactedPlaceholder(value)) return undefined;
  return value.trim();
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return usableValue(String(value));
}

export function normalizeCnpjCompanyInfo(raw: Record<string, unknown>): CustomerCnpjPrefill {
  const companyName = stringField(raw, "companyName");
  const tradingName = stringField(raw, "tradingName");
  const name = tradingName ?? companyName;
  const email = stringField(raw, "email");
  const phone = stringField(raw, "phoneNumber")?.replace(/\D/g, "");
  const zipcode = stringField(raw, "zipCode")?.replace(/\D/g, "");

  return {
    name,
    companyName,
    email,
    cellPhone: phone,
    commercialPhone: phone,
    billingEmail: email,
    zipcode: zipcode ? formatCepDigits(zipcode) : undefined,
    numberAddress: stringField(raw, "numberAddress") ?? stringField(raw, "addressNumber"),
    street: stringField(raw, "streetName"),
    neighborhood: stringField(raw, "neighborhood"),
    complement: stringField(raw, "addressComplement"),
    state: stringField(raw, "state")
  };
}

export function mergeCepLookupIntoPrefill(
  prefill: CustomerCnpjPrefill,
  raw: Record<string, unknown>
): CustomerCnpjPrefill {
  const idCity = raw.idCidade ?? raw.idCity;
  return {
    ...prefill,
    idCity: typeof idCity === "string" || typeof idCity === "number" ? idCity : prefill.idCity,
    state: prefill.state ?? stringField(raw, "idEstado"),
    neighborhood: prefill.neighborhood ?? stringField(raw, "nmBairro"),
    street: prefill.street ?? stringField(raw, "nmEndereco"),
    cityName: prefill.cityName ?? stringField(raw, "nmCidade")
  };
}

export function prefillToFormDefaults(prefill: CustomerCnpjPrefill): Record<string, string> {
  const output: Record<string, string> = {};
  if (prefill.name) output.name = prefill.name;
  if (prefill.companyName) output.companyName = prefill.companyName;
  if (prefill.email) output.email = prefill.email;
  if (prefill.cellPhone) output.cellPhone = formatPhoneDigits(prefill.cellPhone);
  if (prefill.billingEmail) output.billingEmail = prefill.billingEmail;
  if (prefill.zipcode) output.zipcode = formatCepDigits(prefill.zipcode.replace(/\D/g, ""));
  if (prefill.numberAddress) output.numberAddress = prefill.numberAddress;
  return output;
}

export function prefillToWorkflowSlots(prefill: CustomerCnpjPrefill): Record<string, unknown> {
  return {
    name: prefill.name,
    companyName: prefill.companyName,
    email: prefill.email,
    cellPhone: prefill.cellPhone,
    commercialPhone: prefill.commercialPhone,
    billingEmail: prefill.billingEmail,
    zipcode: prefill.zipcode,
    numberAddress: prefill.numberAddress,
    street: prefill.street,
    neighborhood: prefill.neighborhood,
    complement: prefill.complement,
    state: prefill.state,
    cityName: prefill.cityName,
    idCity: prefill.idCity
  };
}

export function mergePrefillIntoFormDefaults(
  existing: Record<string, string>,
  prefill: Record<string, string>
): Record<string, string> {
  const next = { ...existing };
  for (const [key, value] of Object.entries(prefill)) {
    if (!value.trim() || isRedactedPlaceholder(value)) continue;
    if (!next[key]?.trim() || isRedactedPlaceholder(next[key])) next[key] = value;
  }
  return next;
}

function formatCepDigits(digits: string): string {
  const clean = digits.replace(/\D/g, "").slice(0, 8);
  if (clean.length <= 5) return clean;
  return `${clean.slice(0, 5)}-${clean.slice(5)}`;
}

function formatPhoneDigits(digits: string): string {
  const clean = digits.replace(/\D/g, "").slice(0, 11);
  if (clean.length === 0) return "";
  if (clean.length <= 2) return `(${clean}`;
  if (clean.length <= 6) return `(${clean.slice(0, 2)}) ${clean.slice(2)}`;
  if (clean.length <= 10) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
  }
  return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
}
