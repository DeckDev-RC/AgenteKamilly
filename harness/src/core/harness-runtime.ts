import { existsSync } from "node:fs";
import path from "node:path";

import { registerHarnessTools } from "../agent/orchestrator.js";
import { loadAsaasCookieString, MappedAsaasSessionClient } from "../modules/asaas/client.js";
import { createAsaasMutationTools, createAsaasReadTools } from "../modules/asaas/tools.js";
import { MappedContaAzulSessionClient } from "../modules/contaazul/client.js";
import {
  createContaAzulMutationTools,
  createContaAzulReadTools
} from "../modules/contaazul/tools.js";
import { createContaAzulWorkflowTools } from "../modules/contaazul/workflows.js";
import type { HarnessConfig } from "./config.js";
import {
  checkContaAzulSessionState,
  loadBrowserState
} from "./session-store.js";
import { createToolRegistry, type ToolRegistry } from "./tool-registry.js";

export type RuntimeRegistryResult = {
  registry: ToolRegistry;
  warnings: string[];
};

export function resolveConfigCwd(cwd = process.cwd()): string {
  const configCwd = path.basename(cwd).toLowerCase() === "harness"
    ? path.resolve(cwd, "..")
    : cwd;
  return configCwd.replace(/\\/g, "/");
}

export async function createDefaultMappedToolRegistry(
  config: HarnessConfig
): Promise<RuntimeRegistryResult> {
  const warnings: string[] = [];
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

  return { registry, warnings };
}
