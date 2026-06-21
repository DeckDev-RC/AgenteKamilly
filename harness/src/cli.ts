import path from "node:path";

import { config as loadDotenv } from "dotenv";
import { runAgentTurn } from "./agent/agent-runner.js";
import { createAgentModelProvider } from "./agent/model-provider-factory.js";
import { planOrchestratorTurn } from "./agent/orchestrator.js";
import { parseCliArgs, type CliArgs } from "./cli-args.js";
import { loadHarnessConfig } from "./core/config.js";
import {
  createDefaultMappedToolRegistry,
  resolveConfigCwd
} from "./core/harness-runtime.js";
import {
  formatOperationSummary,
  summarizeOperationById
} from "./core/operation-summary.js";

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const configCwd = resolveConfigCwd(process.cwd());
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

  const { registry, warnings } = await createDefaultMappedToolRegistry(config);
  if (args.agentMode) {
    const result = config.runtimeMode === "dry-run"
      ? await runAgentTurn({
          request: args.request,
          registry,
          provider: createAgentModelProvider(config),
          runtimeMode: config.runtimeMode,
          params: args.params,
          sessionId: args.agentSessionId,
          sessionsDir: config.agentSessionsDir
        })
      : {
          status: "blocked" as const,
          reason:
            "Agent mode currently supports dry-run only. Use the normal harness approval flow for live execution."
        };
    const output = {
      request: args.request,
      runtimeMode: config.runtimeMode,
      allowLiveMutations: config.allowLiveMutations,
      status: "agent-runner-ready",
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
  result: Awaited<ReturnType<typeof runAgentTurn>>;
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

  if (output.result.status === "executed") {
    const receipt = output.result.receipt;
    lines.push(`Tool: ${receipt.toolName}`);
    lines.push(`Operacao: ${receipt.operationId}`);
    lines.push(`Resultado: ${receipt.status}`);
    lines.push(`Resumo: ${receipt.summary}`);
    if (receipt.status === "planned") {
      const data = asRecord(receipt.data);
      const preview = asRecord(data?.approvalPreview);
      const approvalOperationId =
        typeof preview?.operationId === "string" ? preview.operationId : receipt.operationId;
      lines.push(`Aprovacao: APROVAR ${approvalOperationId}`);
    }
    if (receipt.warnings.length > 0) {
      lines.push("Warnings:");
      for (const warning of receipt.warnings) lines.push(`- ${warning}`);
    }
    return lines.join("\n");
  }

  lines.push(`Tool: ${output.result.plan.toolName}`);
  lines.push(`Intent: ${output.result.plan.intent}`);
  lines.push(`Risco: ${output.result.plan.risk}`);
  lines.push(`Confianca: ${output.result.plan.confidence}`);
  lines.push(`Motivo: ${output.result.plan.reason}`);
  lines.push("Execucao: nenhuma; plano dry-run aguardando workflow seguro.");
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
