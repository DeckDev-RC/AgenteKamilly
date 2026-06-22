import { z } from "zod";

import type { ToolRegistry } from "../core/tool-registry.js";
import type { JsonSchema, ModelProvider, ModelMessage } from "./model-provider.js";

const RiskSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = normalize(value);
  if (normalized === "baixo" || normalized === "baixa") return "low";
  if (normalized === "medio" || normalized === "media" || normalized === "moderado") {
    return "medium";
  }
  if (normalized === "alto" || normalized === "alta") return "high";
  return value;
}, z.enum(["low", "medium", "high"]));

const AgentPlanSchema = z.object({
  intent: z.string().min(1),
  toolName: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  missingFields: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
  risk: RiskSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1)
});

export type AgentPlan = z.output<typeof AgentPlanSchema>;

export const AGENT_PLAN_RESPONSE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    intent: { type: "string" },
    toolName: { type: "string" },
    params: {
      type: "object",
      properties: {
        customerName: { type: "string" },
        customerId: { type: "string" },
        valueBr: { type: "string" },
        dueDateBr: { type: "string" },
        description: { type: "string" },
        tenantId: { type: "number" },
        categoryName: { type: "string" },
        itemName: { type: "string" },
        serviceDescription: { type: "string" },
        unitValueBr: { type: "string" },
        previousOperationId: { type: "string" },
        orphanedSaleId: { type: "string" },
        cleanupAction: { type: "string" },
        // Customer creation workflow fields
        personType: { type: "string" },
        document: { type: "string" },
        name: { type: "string" },
        companyName: { type: "string" },
        email: { type: "string" },
        commercialPhone: { type: "string" },
        cellPhone: { type: "string" },
        zipcode: { type: "string" },
        street: { type: "string" },
        numberAddress: { type: "string" },
        neighborhood: { type: "string" },
        complement: { type: "string" },
        billingEmail: { type: "string" },
        billingPhone: { type: "string" },
        createBoleto: { type: "boolean" },
        // Reissue / update due date fields
        relationId: { type: "string" },
        financialEventId: { type: "string" },
        installmentId: { type: "string" },
        dueDateIso: { type: "string" },
        value: { type: "number" },
        originalDescription: { type: "string" },
        installmentVersion: { type: "number" },
        installmentIndex: { type: "number" },
        financialAccountId: { type: "string" },
        notification: {
          type: "object",
          properties: {
            email: { type: "string" },
            phone: { type: "string" },
            replyTo: { type: "string" },
            companyDisplayName: { type: "string" }
          }
        }
      }
    },
    missingFields: {
      type: "array",
      items: { type: "string" }
    },
    questions: {
      type: "array",
      items: { type: "string" }
    },
    risk: {
      type: "string",
      enum: ["low", "medium", "high"]
    },
    confidence: { type: "number" },
    reason: { type: "string" }
  },
  required: ["intent", "toolName", "params", "missingFields", "questions", "risk", "confidence", "reason"]
};

export type AgentTurnInput = {
  request: string;
  registry: ToolRegistry;
  provider: ModelProvider;
  knownParams?: Record<string, unknown>;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
};

export type AgentTurnResult =
  | {
      status: "planned";
      provider: "gemini";
      model: string;
      plan: AgentPlan;
    }
  | {
      status: "needs_input";
      provider: "gemini";
      model: string;
      intent: string;
      toolName: string;
      params: Record<string, unknown>;
      missingFields: string[];
      questions: string[];
      risk: "low" | "medium" | "high";
      confidence: number;
      reason: string;
    }
  | {
      status: "blocked";
      reason: string;
      toolName?: string;
    };

export async function planAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  if (mentionsForbiddenOfficialIntegration(input.request)) {
    return {
      status: "blocked",
      reason:
        "Request blocked: official provider APIs, OAuth, webhooks, and provider MCPs are outside this harness boundary."
    };
  }

  const messages: ModelMessage[] = [
    { role: "system", content: buildSystemPrompt(input.registry) }
  ];

  if (input.history && input.history.length > 0) {
    const limitedHistory = input.history.slice(-10);
    for (const turn of limitedHistory) {
      messages.push({
        role: turn.role,
        content: turn.text
      });
    }
  }

  messages.push({
    role: "user",
    content: buildUserPrompt(input.request, input.knownParams)
  });

  let modelResponse;
  try {
    modelResponse = await input.provider.generateText({
      messages,
      responseSchema: AGENT_PLAN_RESPONSE_SCHEMA
    });
  } catch (error) {
    return {
      status: "blocked",
      reason: `Model provider failed: ${error instanceof Error ? error.message : "unknown model error"}`
    };
  }

  const parsedJson = parseModelJson(modelResponse.text);
  if (!parsedJson.ok) {
    return {
      status: "blocked",
      reason: "Model response must be valid JSON matching the agent plan schema."
    };
  }

  const parsedPlan = AgentPlanSchema.safeParse(parsedJson.value);
  if (!parsedPlan.success) {
    return {
      status: "blocked",
      reason: `Model response did not match the agent plan schema: ${parsedPlan.error.issues[0]?.message ?? "invalid plan"}`
    };
  }

  const plan = withKnownRequiredMissingFields(
    withKnownParams(normalizePlanAliases(parsedPlan.data), input.knownParams ?? {})
  );
  const tool = input.registry.list().find((definition) => definition.name === plan.toolName);
  if (!tool) {
    return {
      status: "blocked",
      toolName: plan.toolName,
      reason: capabilitiesMessage(input.registry)
    };
  }

  if (plan.missingFields.length > 0) {
    return {
      status: "needs_input",
      provider: modelResponse.provider,
      model: modelResponse.model,
      intent: plan.intent,
      toolName: plan.toolName,
      params: plan.params,
      missingFields: plan.missingFields,
      questions: plan.questions,
      risk: plan.risk,
      confidence: plan.confidence,
      reason: plan.reason
    };
  }

  const parsedParams = tool.parameters.safeParse(plan.params);
  if (!parsedParams.success) {
    const fields = missingFieldsFromZodError(parsedParams.error);
    return {
      status: "needs_input",
      provider: modelResponse.provider,
      model: modelResponse.model,
      intent: plan.intent,
      toolName: plan.toolName,
      params: plan.params,
      missingFields: fields,
      questions: fields.map((field) => questionForField(field)),
      risk: plan.risk,
      confidence: plan.confidence,
      reason: plan.reason
    };
  }

  return {
    status: "planned",
    provider: modelResponse.provider,
    model: modelResponse.model,
    plan: {
      ...plan,
      params: parsedParams.data as Record<string, unknown>
    }
  };
}

function buildSystemPrompt(registry: ToolRegistry): string {
  const tools = registry.list().map((tool) => ({
    name: tool.name,
    description: tool.description
  }));

  return [
    "Você é a Kamilly, a assistente virtual inteligente e amigável do harness de contabilidade e finanças Confere.",
    "Seu papel é planejar operações de dry-run para o usuário de forma conversacional, clara e prestativa.",
    "Você NUNCA executa operações diretamente. Você apenas preenche a estrutura de saída JSON e delega para as ferramentas registradas.",
    "Qualquer uso de APIs oficiais, OAuth, webhooks oficiais ou MCPs do Asaas/Conta Azul é proibido.",
    "",
    "INSTRUÇÕES DE COMUNICAÇÃO (ESSENCIAL PARA A UX):",
    "1. Seu campo `reason` é a MENSAGEM PRINCIPAL que o usuário lerá no balão de chat. Escreva-a sempre em português natural, caloroso, profissional e de forma conversacional.",
    "   - Se o usuário estiver confuso (ex: perguntar 'como assim?'), explique quem você é e como pode ajudá-lo de forma humana.",
    "   - Se algum dado acabou de ser preenchido (ex: uma empresa foi selecionada), comemore ou reconheça isso de forma natural (ex: 'Perfeito, empresa X selecionada! Agora só preciso do tipo de pessoa e do CPF/CNPJ para cadastrar o cliente.') em vez de repetir a mesma mensagem mecânica.",
    "   - Seja direto e diga claramente quais campos ainda faltam e por que eles são necessários.",
    "2. Seu campo `questions` deve conter APENAS perguntas diretas e curtas de 1 linha correspondentes a cada item de `missingFields` (ex: 'O cliente é Pessoa Física ou Jurídica?' ou 'Qual o CPF/CNPJ?').",
    "   - NUNCA coloque saudações, explicações gerais ou parágrafos longos dentro do array `questions`.",
    "",
    "IMPORTANTE SOBRE OS FLUXOS DE TRABALHO:",
    "- Para cadastrar cliente (contaazul.create_customer_workflow), NÃO pergunte endereço, CEP, telefone, e-mail de cobrança ou nome. O sistema busca automaticamente via Receita Federal/CNPJ/CEP lookup. Pergunte apenas os 3 campos essenciais: tenantId (Empresa), personType (Tipo de pessoa) e document (CPF ou CNPJ).",
    "- Para criar venda e boleto de serviço (contaazul.create_service_sale_boleto_workflow), você precisa de: tenantId, customerName, categoryName, itemName, serviceDescription, unitValueBr, dueDateBr e notification.email.",
    "",
    "Schema de saída obrigatório (JSON puro):",
    "{",
    "  \"intent\": \"a intenção detectada\",",
    "  \"toolName\": \"o nome da ferramenta selecionada (ou string vazia se nenhuma couber)\",",
    "  \"params\": { ... os parâmetros já coletados ... },",
    "  \"missingFields\": [ ... os campos obrigatórios ainda não fornecidos ... ],",
    "  \"questions\": [ ... perguntas curtas de 1 linha correspondentes a cada missingField ... ],",
    "  \"risk\": \"low\" | \"medium\" | \"high\",",
    "  \"confidence\": 0.0 a 1.0,",
    "  \"reason\": \"sua resposta conversacional e amigável em português natural para o balão de chat\"",
    "}",
    `Ferramentas registradas: ${JSON.stringify(tools)}`
  ].join("\n");
}

function buildUserPrompt(request: string, knownParams: Record<string, unknown> | undefined): string {
  if (!knownParams || Object.keys(knownParams).length === 0) return request;
  return [
    request,
    "",
    "Campos ja coletados nesta conversa. Reutilize apenas a presenca destes campos; os valores permanecem locais no harness:",
    JSON.stringify({ knownFields: collectKnownFieldPaths(knownParams) })
  ].join("\n");
}

function collectKnownFieldPaths(value: Record<string, unknown>): string[] {
  const paths: string[] = [];
  collectPaths(value, "", paths);
  return paths.sort();
}

function collectPaths(value: unknown, prefix: string, paths: string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (prefix) paths.push(prefix);
    return;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 && prefix) paths.push(prefix);
  for (const [key, entryValue] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entryValue && typeof entryValue === "object" && !Array.isArray(entryValue)) {
      collectPaths(entryValue, path, paths);
    } else {
      paths.push(path);
    }
  }
}

function normalizePlanAliases(plan: AgentPlan): AgentPlan {
  return {
    ...plan,
    params: normalizeParamAliases(plan.toolName, plan.params),
    missingFields: uniqueStrings(
      plan.missingFields.map((field) => normalizeFieldAlias(plan.toolName, field))
    )
  };
}

function withKnownParams(plan: AgentPlan, knownParams: Record<string, unknown>): AgentPlan {
  const normalizedKnownParams = removeRedactedPlaceholders(
    normalizeParamAliases(plan.toolName, knownParams)
  );
  const params = {
    ...normalizedKnownParams,
    ...plan.params
  };
  return {
    ...plan,
    params,
    missingFields: uniqueStrings(plan.missingFields.filter((field) => !hasParam(params, field)))
  };
}

function hasParam(params: Record<string, unknown>, field: string): boolean {
  const value = getParamByPath(params, field);
  if (isRedactedPlaceholder(value)) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== undefined && value !== null;
}

function getParamByPath(params: Record<string, unknown>, field: string): unknown {
  if (!field.includes(".")) return params[field];
  let current: unknown = params;
  for (const segment of field.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function withKnownRequiredMissingFields(plan: AgentPlan): AgentPlan {
  const missingFields = [...plan.missingFields];
  for (const requirement of requiredFieldGroupsForTool(plan.toolName)) {
    if (requirement.fields.some((field) => hasParam(plan.params, field))) continue;
    const missingField = requirement.preferredField;
    if (!missingFields.includes(missingField)) missingFields.push(missingField);
  }

  const uniqueMissing = uniqueStrings(missingFields);
  const alignedQuestions = uniqueMissing.map((field, idx) => {
    const originalField = plan.missingFields[idx];
    if (originalField === field && plan.questions[idx]) {
      return plan.questions[idx];
    }
    return questionForField(field);
  });

  return {
    ...plan,
    missingFields: uniqueMissing,
    questions: alignedQuestions
  };
}

function requiredFieldGroupsForTool(
  toolName: string
): Array<{ preferredField: string; fields: string[] }> {
  if (toolName === "asaas.create_boleto_charge_workflow") {
    return [
      { preferredField: "customerName", fields: ["customerName"] },
      { preferredField: "valueBr", fields: ["valueBr"] },
      { preferredField: "dueDateBr", fields: ["dueDateBr"] },
      { preferredField: "description", fields: ["description"] }
    ];
  }

  if (toolName === "contaazul.create_service_sale_boleto_workflow") {
    return [
      { preferredField: "tenantId", fields: ["tenantId"] },
      { preferredField: "customerName", fields: ["customerName"] },
      { preferredField: "categoryName", fields: ["categoryName"] },
      { preferredField: "itemName", fields: ["itemName"] },
      { preferredField: "serviceDescription", fields: ["serviceDescription"] },
      { preferredField: "unitValueBr", fields: ["unitValueBr", "unitValue"] },
      { preferredField: "dueDateBr", fields: ["dueDateBr", "dueDateIso"] },
      { preferredField: "notification.email", fields: ["notification.email"] }
    ];
  }

  if (toolName === "contaazul.create_customer_workflow") {
    return [
      { preferredField: "tenantId", fields: ["tenantId"] },
      { preferredField: "personType", fields: ["personType"] },
      { preferredField: "document", fields: ["document"] }
    ];
  }

  if (toolName === "contaazul.update_due_date_reissue_boleto_workflow") {
    return [
      { preferredField: "tenantId", fields: ["tenantId"] },
      { preferredField: "financialEventId", fields: ["financialEventId"] },
      { preferredField: "installmentId", fields: ["installmentId"] },
      { preferredField: "dueDateIso", fields: ["dueDateIso", "dueDateBr"] }
    ];
  }

  return [];
}

export function questionForField(field: string): string {
  const questions: Record<string, string> = {
    customerName: "Qual o nome do cliente?",
    valueBr: "Qual o valor?",
    dueDateBr: "Qual a data de vencimento em DD/MM/AAAA?",
    description: "Qual a descrição?",
    tenantId: "Qual o tenantId da empresa no Conta Azul Mais?",
    categoryName: "Qual a categoria financeira?",
    itemName: "Qual o item de serviço?",
    serviceDescription: "Qual a descrição do serviço?",
    unitValueBr: "Qual o valor unitário?",
    "notification.email": "Qual o e-mail de cobrança do cliente?",
    personType: "O cliente é Pessoa Física ou Jurídica?",
    document: "Qual o CPF ou CNPJ do cliente?",
    name: "Qual o nome completo do cliente?",
    companyName: "Qual a razão social da empresa?",
    email: "Qual o e-mail?",
    commercialPhone: "Qual o telefone comercial?",
    cellPhone: "Qual o celular?",
    zipcode: "Qual o CEP?",
    street: "Qual a rua/avenida?",
    numberAddress: "Qual o número do endereço?",
    neighborhood: "Qual o bairro?",
    complement: "Qual o complemento?",
    billingEmail: "Qual o e-mail de cobrança?",
    billingPhone: "Qual o telefone de cobrança?",
    createBoleto: "Deseja emitir boleto para este cliente?",
    dueDateIso: "Qual a data de vencimento (AAAA-MM-DD)?",
    financialEventId: "Qual o ID do evento financeiro?",
    installmentId: "Qual o ID da parcela?",
    operatorConfirmation: "Por favor, confirme a execução de segurança."
  };
  return questions[field] ?? `Por favor, informe o campo ${field}.`;
}

const CAPABILITY_LABELS: Record<string, string> = {
  "asaas.create_boleto_charge_workflow": "criar boleto no Asaas",
  "contaazul.create_service_sale_boleto_workflow": "criar venda de serviço e boleto no Conta Azul",
  "contaazul.create_customer_workflow": "cadastrar cliente no Conta Azul"
};

function capabilitiesMessage(registry: ToolRegistry): string {
  const labels = registry
    .list()
    .map((tool) => CAPABILITY_LABELS[tool.name])
    .filter((label): label is string => Boolean(label));
  const list = labels.length > 0 ? labels.join(", ") : "as operações configuradas";
  return `Isso eu ainda não sei fazer. Hoje eu consigo: ${list}. O que você quer fazer?`;
}

function missingFieldsFromZodError(error: z.ZodError): string[] {
  const fields = uniqueStrings(
    error.issues
      .map((issue) => issue.path.map(String).join("."))
      .filter((path) => path.length > 0)
  );
  return fields.length > 0 ? fields : ["dados"];
}

function removeRedactedPlaceholders(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const output: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (isRedactedPlaceholder(entryValue)) continue;
    if (entryValue && typeof entryValue === "object" && !Array.isArray(entryValue)) {
      output[key] = removeRedactedPlaceholders(entryValue);
      continue;
    }
    output[key] = entryValue;
  }
  return output;
}

function isRedactedPlaceholder(value: unknown): boolean {
  return typeof value === "string" && /^\[REDACTED_[A-Z_]+\]$/.test(value);
}

function normalizeParamAliases(
  toolName: string,
  params: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...params };
  for (const [source, value] of Object.entries(params)) {
    const target = normalizeFieldAlias(toolName, source);
    if (target !== source && normalized[target] === undefined) {
      normalized[target] = value;
    }
  }
  return normalized;
}

function normalizeFieldAlias(toolName: string, field: string): string {
  const normalized = normalize(field);

  if (toolName.startsWith("asaas.")) {
    if (["value", "amount", "valor"].includes(normalized)) return "valueBr";
    if (["duedate", "vencimento", "data vencimento"].includes(normalized)) return "dueDateBr";
    if (["descricao", "description"].includes(normalized)) return "description";
  }

  if (toolName === "contaazul.create_service_sale_boleto_workflow") {
    if (
      ["value", "valuebr", "amount", "valor", "unitvalue", "unitvaluebr", "valor unitario"]
        .includes(normalized)
    ) {
      return "unitValueBr";
    }
    if (["duedate", "vencimento", "data vencimento"].includes(normalized)) return "dueDateBr";
    if (["description", "descricao", "servicedescription"].includes(normalized)) {
      return "serviceDescription";
    }
  }

  if (toolName === "contaazul.create_service_sale_and_issue_boleto") {
    if (
      ["value", "valuebr", "amount", "valor", "unitvalue", "unitvaluebr", "valor unitario"]
        .includes(normalized)
    ) {
      return "unitValue";
    }
    if (["duedate", "vencimento", "data vencimento"].includes(normalized)) return "dueDateIso";
    if (["description", "descricao", "servicedescription"].includes(normalized)) {
      return "serviceDescription";
    }
  }

  if (toolName === "contaazul.update_due_date_reissue_boleto_workflow") {
    if (["duedate", "vencimento", "data vencimento", "duedateiso", "duedatebr"].includes(normalized)) {
      return "dueDateIso";
    }
  }

  return field;
}

function parseModelJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return { ok: true, value: JSON.parse(unfenced) as unknown };
  } catch {
    return { ok: false };
  }
}

function mentionsForbiddenOfficialIntegration(request: string): boolean {
  const normalized = normalize(request);
  return (
    normalized.includes("oauth") ||
    normalized.includes("asaas_mcp") ||
    normalized.includes("contaazul_mcp") ||
    normalized.includes("official") ||
    (normalized.includes("oficial") &&
      hasAny(normalized, ["api", "webhook", "mcp", "oauth"]))
  );
}

function hasAny(request: string, terms: string[]): boolean {
  return terms.some((term) => request.includes(normalize(term)));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}
