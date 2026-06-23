/**
 * NLU determinística do Confere.
 *
 * Converte linguagem natural ("emite um boleto de 250 pra AZUOS vencendo 30/06")
 * em uma intenção + entidades, SEM depender de LLM. É o cérebro que garante o
 * roteamento dos fluxos e o preenchimento de lacunas (slot-filling).
 */

export type NluIntent =
  | "create_service_sale_boleto"
  | "create_asaas_boleto"
  | "create_customer"
  | "update_due_date_contaazul"
  | "update_due_date_asaas"
  | "download_boleto_asaas"
  | "list_charges"
  | "boleto_provider_choice";

export type NluProvider = "asaas" | "contaazul";
export type PersonType = "Física" | "Jurídica";

export type NluEntities = {
  valueBr?: string;
  dueDateBr?: string;
  dueDateIso?: string;
  document?: string;
  personType?: PersonType;
  customerHint?: string;
  /** Vários clientes citados ("boletos de X, Y e Z") — usado em consultas. */
  customerHints?: string[];
  provider?: NluProvider;
  onlyOverdue?: boolean;
};

export type NluResult = {
  intent?: NluIntent;
  /** Ação de âncora equivalente, quando a intenção inicia um fluxo existente. */
  anchorAction?: string;
  entities: NluEntities;
};

const ANCHOR_BY_INTENT: Partial<Record<NluIntent, string>> = {
  create_service_sale_boleto: "start_contaazul_service_sale",
  create_asaas_boleto: "start_asaas_boleto",
  create_customer: "start_contaazul_create_customer",
  update_due_date_contaazul: "start_contaazul_update_due_date",
  update_due_date_asaas: "start_asaas_update_due_date",
  download_boleto_asaas: "start_asaas_download_boleto"
};

export function understand(request: string, now: Date = new Date()): NluResult {
  const intent = detectIntent(request);
  return {
    intent,
    anchorAction: intent ? ANCHOR_BY_INTENT[intent] : undefined,
    entities: extractEntities(request, now)
  };
}

export function detectIntent(request: string): NluIntent | undefined {
  const n = normalize(request);
  if (!n.trim()) return undefined;

  const asaas = mentionsAsaas(n);
  const contaazul = mentionsContaAzul(n);
  const billingNoun = /(boleto|cobranc|fatura)/.test(n);
  const saleWords = /(venda|servico)/.test(n);
  const dueWords = /vencimento/.test(n);
  const overdue = /(vencid|atrasad|em atraso)/.test(n);

  const queryVerb =
    /(lista|listar|liste|mostr|exib|ver |quais|me entregue|me de |me da |me mostr|traz|trazer|consult|relatorio|extrato|quanto)/.test(
      n
    );
  const customerVerb = /(cadastr|criar|adicionar|registrar|inserir|incluir|abrir|novo|nova)/.test(n);
  const downloadVerb = /(baixar|baixa|download|segunda via|2 via|2a via|pdf)/.test(n);
  const changeVerb =
    /(mudar|muda|alterar|altera|trocar|troca|atualizar|atualiza|reagendar|adiar|prorrogar|remarcar|corrigir|edita|posterga|antecipa)/.test(
      n
    );
  const emitVerb = /(emitir|emite|gerar|gera|criar|cria|fazer|faz|lancar|lanca|abrir|cobrar|novo|nova)/.test(n);

  // 1) Cadastro de cliente (sem indício de boleto/venda/vencimento)
  if (/\bcliente\b/.test(n) && customerVerb && !billingNoun && !saleWords && !dueWords) {
    return "create_customer";
  }

  // 2) Baixar/segunda via de boleto (antes de "mudar", para "2ª via")
  if (downloadVerb && (billingNoun || /pdf/.test(n))) {
    return "download_boleto_asaas";
  }

  // 3) Mudar/alterar vencimento de um boleto/cobrança
  if (changeVerb && (dueWords || billingNoun)) {
    return asaas ? "update_due_date_asaas" : "update_due_date_contaazul";
  }

  // 4) Consulta/entrega ("me entregue os boletos de X", "boletos vencidos", "extrato")
  const looksLikeQuery =
    (queryVerb && (billingNoun || dueWords || /extrato/.test(n))) ||
    /extrato/.test(n) ||
    (overdue && billingNoun);
  if (looksLikeQuery) {
    return "list_charges";
  }

  // 5) Emitir/gerar boleto, cobrança ou venda de serviço
  if ((emitVerb && (billingNoun || saleWords)) || billingNoun || saleWords) {
    if (asaas) return "create_asaas_boleto";
    if (contaazul || saleWords) return "create_service_sale_boleto";
    return "boleto_provider_choice";
  }

  return undefined;
}

export function extractEntities(request: string, now: Date = new Date()): NluEntities {
  const entities: NluEntities = {};
  const provider = detectProvider(request);
  if (provider) entities.provider = provider;

  const document = parseDocument(request);
  if (document) {
    entities.document = document;
    entities.personType = document.length === 14 ? "Jurídica" : "Física";
  }

  const due = parseDueDate(request, now);
  if (due) {
    entities.dueDateBr = due.br;
    entities.dueDateIso = due.iso;
  }

  const valueBr = parseMoneyBr(request, document);
  if (valueBr) entities.valueBr = valueBr;

  const hints = parseCustomerHints(request);
  if (hints.length > 0) {
    entities.customerHint = hints[0];
    if (hints.length > 1) entities.customerHints = hints;
  }

  if (/(vencid|atrasad|em atraso|venceu)/.test(normalize(request))) {
    entities.onlyOverdue = true;
  }

  return entities;
}

// --- Helpers de extração ---------------------------------------------------

export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function mentionsAsaas(normalized: string): boolean {
  return normalized.includes("asaas");
}

function mentionsContaAzul(normalized: string): boolean {
  return normalized.includes("conta azul") || normalized.includes("contaazul");
}

function detectProvider(request: string): NluProvider | undefined {
  const n = normalize(request);
  if (mentionsAsaas(n)) return "asaas";
  if (mentionsContaAzul(n)) return "contaazul";
  return undefined;
}

/** CPF (11) ou CNPJ (14) com ou sem máscara. Retorna só dígitos. */
function parseDocument(request: string): string | undefined {
  const candidates = request.match(/\d[\d.\-/\s]{9,18}\d/g) ?? [];
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length === 11 || digits.length === 14) return digits;
  }
  return undefined;
}

type ParsedDate = { br: string; iso: string };

function parseDueDate(request: string, now: Date): ParsedDate | undefined {
  const n = normalize(request);

  if (/\b(hoje)\b/.test(n)) return fromDate(now);
  if (/(depois de amanha|depois d amanha)/.test(n)) return fromDate(addDays(now, 2));
  if (/\b(amanha)\b/.test(n)) return fromDate(addDays(now, 1));

  // dd/mm or dd/mm/yyyy (também aceita dd-mm-yyyy)
  const slash = request.match(/\b(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\b/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    let year = slash[3] ? Number(slash[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    if (isValidYmd(year, month, day)) {
      // Sem ano explícito e data já passada → assume próximo ano.
      if (!slash[3] && isPast(year, month, day, now)) year += 1;
      return makeDate(year, month, day);
    }
  }

  // "dia 30" → dia do mês atual (ou próximo mês se já passou)
  const diaMatch = n.match(/\bdia\s+(\d{1,2})\b/);
  if (diaMatch) {
    const day = Number(diaMatch[1]);
    if (day >= 1 && day <= 31) {
      let year = now.getFullYear();
      let month = now.getMonth() + 1;
      if (isPast(year, month, day, now)) {
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
      if (isValidYmd(year, month, day)) return makeDate(year, month, day);
    }
  }

  return undefined;
}

function parseMoneyBr(request: string, document?: string): string | undefined {
  let text = request;
  // Remove o documento detectado para não confundir com valor.
  if (document) {
    const masked = request.match(/\d[\d.\-/\s]{9,18}\d/g) ?? [];
    for (const candidate of masked) {
      if (candidate.replace(/\D/g, "") === document) {
        text = text.replace(candidate, " ");
      }
    }
  }

  // Prioridade 1: valor com R$ ou com centavos (1.234,56 / 250,00 / R$ 250)
  const explicit = text.match(/r\$\s*([\d.]+(?:,\d{1,2})?)/i);
  if (explicit) return cleanMoney(explicit[1]);

  const withCents = text.match(/\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/);
  if (withCents) return cleanMoney(withCents[1]);

  // Prioridade 2: número "solto" perto de palavras de valor — evita datas/dias.
  const valueCtx = text.match(/(?:valor\s+(?:de\s+)?|de\s+|por\s+)(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\b/i);
  if (valueCtx) {
    const candidate = valueCtx[1];
    if (!looksLikeDayOrYear(candidate, text)) return cleanMoney(candidate);
  }

  return undefined;
}

function looksLikeDayOrYear(candidate: string, text: string): boolean {
  const n = normalize(text);
  const num = Number(candidate.replace(/\./g, "").replace(",", "."));
  // "dia 30" já é tratado como data; se o número aparece após "dia", ignore.
  if (new RegExp(`dia\\s+${candidate}\\b`).test(n)) return true;
  // Anos plausíveis (2024..2099) sem centavos.
  if (!candidate.includes(",") && num >= 2024 && num <= 2099) return true;
  return false;
}

function cleanMoney(value: string): string {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) return value;
  return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const HINT_STOP = new Set([
  "de",
  "do",
  "da",
  "no",
  "na",
  "com",
  "dia",
  "vencendo",
  "vence",
  "valor",
  "vencimento",
  "ate",
  "para",
  "pra",
  "pro",
  "e",
  "em",
  "boleto",
  "boletos",
  "cobranca",
  "cobrancas",
  "fatura",
  "r$"
]);

function parseCustomerHints(request: string): string[] {
  // Gatilhos específicos primeiro; "pra/para" por último (mais abrangente).
  const triggers = [
    /\bcliente[s]?\s+(.+)$/i,
    /\bda\s+empresa\s+(.+)$/i,
    /\bboletos?\s+d[oae]s?\s+(.+)$/i,
    /\b(?:pra|para|pro)\s+(?:o\s+|a\s+)?(.+)$/i
  ];
  for (const trigger of triggers) {
    const match = request.match(trigger);
    if (!match?.[1]) continue;
    const names: string[] = [];
    for (const segment of match[1].split(/\s*,\s*|\s+e\s+/i)) {
      const words: string[] = [];
      for (const raw of segment.trim().split(/\s+/)) {
        const clean = raw.replace(/[.,;:]+$/, "");
        const token = normalize(clean);
        if (!token || HINT_STOP.has(token) || /\d/.test(token)) break;
        words.push(clean);
        if (words.length >= 5) break;
      }
      const name = words.join(" ").trim();
      if (name.length >= 2) names.push(name);
    }
    if (names.length > 0) return names;
  }
  return [];
}

// --- Datas -----------------------------------------------------------------

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function fromDate(date: Date): ParsedDate {
  return makeDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function makeDate(year: number, month: number, day: number): ParsedDate {
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return { br: `${dd}/${mm}/${year}`, iso: `${year}-${mm}-${dd}` };
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function isPast(year: number, month: number, day: number, now: Date): boolean {
  const candidate = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return candidate.getTime() < today.getTime();
}
