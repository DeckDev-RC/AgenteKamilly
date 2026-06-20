import { existsSync } from "node:fs";
import path from "node:path";

import { config as loadDotenv } from "dotenv";
import { planAgentTurn } from "./agent/llm-planner.js";
import { createAgentModelProvider } from "./agent/model-provider-factory.js";
import { planOrchestratorTurn, registerHarnessTools } from "./agent/orchestrator.js";
import { parseCliArgs, type CliArgs } from "./cli-args.js";
import { loadHarnessConfig } from "./core/config.js";
import {
  formatOperationSummary,
  summarizeOperationById
} from "./core/operation-summary.js";
import { createToolRegistry, type ToolRegistry } from "./core/tool-registry.js";
import {
  checkContaAzulSessionState,
  loadBrowserState
} from "./core/session-store.js";
import { loadAsaasCookieString, MappedAsaasSessionClient } from "./modules/asaas/client.js";
import { createAsaasMutationTools, createAsaasReadTools } from "./modules/asaas/tools.js";
import { MappedContaAzulSessionClient } from "./modules/contaazul/client.js";
import {
  createContaAzulMutationTools,
  createContaAzulReadTools
} from "./modules/contaazul/tools.js";
import { createContaAzulWorkflowTools } from "./modules/contaazul/workflows.js";

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const configCwd = path.basename(process.cwd()).toLowerCase() === "harness"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();
  loadDotenv({ path: path.resolve(configCwd, ".env"), override: false, quiet: true });
  const config = loadHarnessConfig(
    {
      ...process.env,
      RUNTIME_MODE: args.runtimeModeOverride
    },
    configCwd
  );

  if (args.summaryOperationId) {
    const summary = await summarizeOperationById({
      ledgerPath: config.ledgerPath,
      operationId: args.summaryOperationId,
      includeEntries: args.verbose
    });
    printOutput(summary, args.outputMode ?? "operator", formatOperationSummary);
    return;
  }

  if (args.modelSmoke) {
    const provider = createAgentModelProvider(config);
    const response = await provider.generateText({
      messages: [
        {
          role: "user",
          content: 'Responda apenas JSON valido: {"ok":true}'
        }
      ]
    });
    printOutput(
      {
        status: "model-smoke-ok",
        provider: response.provider,
        model: response.model,
        response: response.text
      },
      args.outputMode ?? "json",
      formatModelSmokeOutput
    );
    return;
  }

  const warnings: string[] = [];
  const registry = await createDefaultMappedToolRegistry(config, warnings);
  if (args.agentMode) {
    const provider = createAgentModelProvider(config);
    const result = await planAgentTurn({
      request: args.request,
      registry,
      provider
    });
    const output = {
      request: args.request,
      runtimeMode: config.runtimeMode,
      allowLiveMutations: config.allowLiveMutations,
      status: "agent-planner-ready",
      warnings,
      result
    };
    printOutput(output, args.outputMode ?? "json", formatAgentTurnOutput);
    return;
  }

  const result = await planOrchestratorTurn({
    request: args.request,
    registry,
    params: args.params,
    approvalText: args.approvalText
  });

  const output = {
    request: args.request,
    runtimeMode: config.runtimeMode,
    allowLiveMutations: config.allowLiveMutations,
    status: "orchestrator-ready",
    warnings,
    result
  };
  printOutput(output, args.outputMode ?? "json", formatOperatorTurnOutput);
}

async function createDefaultMappedToolRegistry(
  config: ReturnType<typeof loadHarnessConfig>,
  warnings: string[]
): Promise<ToolRegistry> {
  const registry = createToolRegistry();

  if (existsSync(config.asaasEnvPath)) {
    try {
      const asaasClient = new MappedAsaasSessionClient({
        cookieString: loadAsaasCookieString(config.asaasEnvPath)
      });
      registerHarnessTools(registry, {
        asaasRead: createAsaasReadTools({
          client: asaasClient,
          ledgerPath: config.ledgerPath,
          runtimeMode: config.runtimeMode
        }),
        asaasMutation: createAsaasMutationTools({
          client: asaasClient,
          ledgerPath: config.ledgerPath,
          artifactsDir: config.artifactsDir,
          runtimeMode: config.runtimeMode,
          allowLiveMutations: config.allowLiveMutations
        })
      });
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Asaas session could not be loaded.");
    }
  } else {
    warnings.push(`Asaas session env not found: ${config.asaasEnvPath}`);
  }

  if (existsSync(config.contaAzulStatePath)) {
    try {
      const state = await loadBrowserState(config.contaAzulStatePath);
      const health = checkContaAzulSessionState(state);
      if (!health.ok) {
        warnings.push(`${health.reason} ${health.recaptureCommand ?? ""}`.trim());
      } else {
        const contaAzulClient = new MappedContaAzulSessionClient({ state });
        const proSessionStore = new Map<string, string>();
        const contaAzulMutationOptions = {
          client: contaAzulClient,
          ledgerPath: config.ledgerPath,
          artifactsDir: config.artifactsDir,
          runtimeMode: config.runtimeMode,
          allowLiveMutations: config.allowLiveMutations,
          config: {
            financialAccountId: config.contaAzulFinancialAccountId,
            defaultReplyToEmail: config.contaAzulDefaultReplyToEmail,
            defaultCompanyDisplayName: config.contaAzulDefaultCompanyDisplayName
          },
          proSessionStore
        };
        registerHarnessTools(registry, {
          contaAzulRead: createContaAzulReadTools({
            client: contaAzulClient,
            ledgerPath: config.ledgerPath,
            runtimeMode: config.runtimeMode,
            proSessionStore
          }),
          contaAzulMutation: {
            ...createContaAzulMutationTools(contaAzulMutationOptions),
            ...createContaAzulWorkflowTools(contaAzulMutationOptions)
          }
        });
      }
    } catch (error) {
      warnings.push(
        error instanceof Error ? error.message : "Conta Azul session could not be loaded."
      );
    }
  } else {
    warnings.push(`Conta Azul state not found: ${config.contaAzulStatePath}`);
  }

  return registry;
}

function printOutput<T>(
  value: T,
  mode: "json" | "operator",
  formatter: (value: T) => string
): void {
  if (mode === "json") {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(formatter(value));
}

function formatModelSmokeOutput(output: {
  status: string;
  provider: string;
  model: string;
  response: string;
}): string {
  return [
    `Status: ${output.status}`,
    `Provider: ${output.provider}`,
    `Modelo: ${output.model}`,
    `Resposta: ${output.response}`
  ].join("\n");
}

function formatAgentTurnOutput(output: {
  request: string;
  runtimeMode: string;
  allowLiveMutations: boolean;
  status: string;
  warnings: string[];
  result: Awaited<ReturnType<typeof planAgentTurn>>;
}): string {
  const lines = [
    `Status: ${output.result.status}`,
    `Modo: ${output.runtimeMode}`,
    `Live habilitado: ${output.allowLiveMutations ? "sim" : "nao"}`
  ];

  if (output.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of output.warnings) lines.push(`- ${warning}`);
  }

  if (output.result.status === "blocked") {
    lines.push(`Motivo: ${output.result.reason}`);
    return lines.join("\n");
  }

  lines.push(`Provider IA: ${output.result.provider}`);
  lines.push(`Modelo: ${output.result.model}`);

  if (output.result.status === "needs_input") {
    lines.push(`Tool: ${output.result.toolName}`);
    lines.push(`Risco: ${output.result.risk}`);
    lines.push(`Confianca: ${output.result.confidence}`);
    lines.push("Campos faltantes:");
    for (const field of output.result.missingFields) lines.push(`- ${field}`);
    lines.push("Perguntas:");
    for (const question of output.result.questions) lines.push(`- ${question}`);
    return lines.join("\n");
  }

  lines.push(`Tool: ${output.result.plan.toolName}`);
  lines.push(`Intent: ${output.result.plan.intent}`);
  lines.push(`Risco: ${output.result.plan.risk}`);
  lines.push(`Confianca: ${output.result.plan.confidence}`);
  lines.push(`Motivo: ${output.result.plan.reason}`);
  lines.push("Execucao: nenhuma; plano dry-run aguardando roteador/workflow seguro.");
  return lines.join("\n");
}

function formatOperatorTurnOutput(output: {
  request: string;
  runtimeMode: string;
  allowLiveMutations: boolean;
  status: string;
  warnings: string[];
  result: Awaited<ReturnType<typeof planOrchestratorTurn>>;
}): string {
  const lines = [
    `Status: ${output.result.status}`,
    `Modo: ${output.runtimeMode}`,
    `Live habilitado: ${output.allowLiveMutations ? "sim" : "nao"}`
  ];

  if (output.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of output.warnings) lines.push(`- ${warning}`);
  }

  if (output.result.status === "needs_input") {
    lines.push(`Tool: ${output.result.toolName}`);
    lines.push("Campos faltantes:");
    for (const field of output.result.missingFields) lines.push(`- ${field}`);
    lines.push("Perguntas:");
    for (const question of output.result.questions) lines.push(`- ${question}`);
    return lines.join("\n");
  }

  if (output.result.status === "blocked" || output.result.status === "unsupported") {
    lines.push(`Motivo: ${output.result.reason}`);
    return lines.join("\n");
  }

  const receipt = output.result.receipt;
  lines.push(`Provider: ${receipt.provider}`);
  lines.push(`Tool: ${receipt.toolName}`);
  lines.push(`Operacao: ${receipt.operationId}`);
  lines.push(`Resultado: ${receipt.status}`);
  lines.push(`Resumo: ${receipt.summary}`);

  const data = asRecord(receipt.data);
  const preview = asRecord(data?.approvalPreview);
  if (receipt.status === "planned") {
    const approvalOperationId =
      typeof preview?.operationId === "string" ? preview.operationId : receipt.operationId;
    lines.push(`Aprovacao: APROVAR ${approvalOperationId}`);
  }

  const result = asRecord(data?.result);
  const chargeUrl = stringValue(result?.chargeUrl) ?? stringValue(data?.chargeUrl);
  if (chargeUrl) lines.push(`Fatura: ${chargeUrl}`);
  const idempotencyKey = stringValue(data?.idempotencyKey);
  if (idempotencyKey) lines.push(`Idempotency: ${idempotencyKey}`);

  if (receipt.artifacts.length > 0) {
    lines.push("Artefatos:");
    for (const artifact of receipt.artifacts) lines.push(`- ${artifact.label}: ${artifact.path}`);
  }
  if (receipt.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of receipt.warnings) lines.push(`- ${warning}`);
  }

  return lines.join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

await main();
