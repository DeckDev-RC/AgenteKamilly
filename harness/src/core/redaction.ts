export const REDACTED_PLACEHOLDERS = [
  "[REDACTED_SECRET]",
  "[REDACTED_EMAIL]",
  "[REDACTED_PHONE]",
  "[REDACTED_DOCUMENT]"
] as const;

const SECRET_PLACEHOLDER = REDACTED_PLACEHOLDERS[0];
const EMAIL_PLACEHOLDER = REDACTED_PLACEHOLDERS[1];
const PHONE_PLACEHOLDER = REDACTED_PLACEHOLDERS[2];
const DOCUMENT_PLACEHOLDER = REDACTED_PLACEHOLDERS[3];

export function isRedactedPlaceholder(value: string | undefined | null): boolean {
  if (!value) return false;
  return (REDACTED_PLACEHOLDERS as readonly string[]).includes(value);
}

export function sanitizeFormDefaultValues(
  values: Record<string, string | undefined>
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!value?.trim() || isRedactedPlaceholder(value)) continue;
    output[key] = value.trim();
  }
  return output;
}

const SENSITIVE_HEADER_NAMES = new Set([
  "cookie",
  "authorization",
  "x-authorization",
  "x-goog-api-key",
  "x-auth-token",
  "accountancy-token",
  "auth-token",
  "redirect_token"
]);

const SECRET_KEY_PATTERN =
  /(^|[_-])(senha|password|passwd|secret|token|cookie|authorization|auth|login)([_-]|$)/i;
const EMAIL_KEY_PATTERN = /(^|[_-])e?mail([_-]|$)|email/i;
const PHONE_KEY_PATTERN = /(phone|telefone|celular|whatsapp|mobile)/i;
const DOCUMENT_KEY_PATTERN = /(cpf|cnpj|document|legalDocument|naturalDocument)/i;
const PRESERVE_KEY_PATTERN =
  /^(operationId|previousOperationId|cleanupForOperationId|duplicateOperationId|idempotencyKey|saleId|orphanedSaleId|sha256|timestamp)$/;

export function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    output[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? SECRET_PLACEHOLDER : value;
  }
  return output;
}

export function redactString(value: string): string {
  return value
    .replace(/\bCookie:\s*[^;\n\r]+/gi, `Cookie: ${SECRET_PLACEHOLDER}`)
    .replace(
      /\b(auth-token|redirect_token|accountancy-token|authorization|x-authorization)=([^;\s]+)/gi,
      `$1=${SECRET_PLACEHOLDER}`
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, EMAIL_PLACEHOLDER)
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, DOCUMENT_PLACEHOLDER)
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, DOCUMENT_PLACEHOLDER)
    .replace(/(?<!\d)(?:\+55[\s-]?)?\(?\d{2}\)?[\s-]?9?\d{4}-\d{4}(?!\d)/g, PHONE_PLACEHOLDER);
}

export function redact<T>(value: T): T {
  return redactUnknown(value) as T;
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    output[key] = redactValueForKey(key, nestedValue);
  }
  return output;
}

function redactValueForKey(key: string, value: unknown): unknown {
  if (PRESERVE_KEY_PATTERN.test(key) && (typeof value === "string" || typeof value === "number")) {
    return value;
  }
  if (EMAIL_KEY_PATTERN.test(key)) return EMAIL_PLACEHOLDER;
  if (PHONE_KEY_PATTERN.test(key)) return PHONE_PLACEHOLDER;
  if (DOCUMENT_KEY_PATTERN.test(key)) return DOCUMENT_PLACEHOLDER;
  if (SECRET_KEY_PATTERN.test(key)) return SECRET_PLACEHOLDER;
  return redactUnknown(value);
}
