import { existsSync } from "node:fs";

import { RECAPTURE_COMMANDS } from "./recapture-commands.js";
import { loadAsaasCookieString, MappedAsaasSessionClient } from "../modules/asaas/client.js";
import { MappedContaAzulSessionClient } from "../modules/contaazul/client.js";
import type { HarnessConfig } from "./config.js";
import { requestWithRetry, SessionExpiredError } from "./http-client.js";
import { checkContaAzulSessionState, loadBrowserState } from "./session-store.js";

export type ConnectionStatus = "healthy" | "expired" | "missing" | "error";

export type ConnectionHealth = {
  provider: "asaas" | "contaazul";
  label: string;
  status: ConnectionStatus;
  detail: string;
  checkedAt: string;
  recaptureCommand: string;
};

export type CheckConnectionsOptions = {
  /** Permite injetar um transporte falso nos testes (sem rede ao vivo). */
  request?: typeof requestWithRetry;
};

const ASAAS_RECAPTURE = RECAPTURE_COMMANDS.asaas;
const CONTAAZUL_RECAPTURE = RECAPTURE_COMMANDS.contaazul;

export async function checkConnections(
  config: HarnessConfig,
  options: CheckConnectionsOptions = {}
): Promise<ConnectionHealth[]> {
  return Promise.all([
    checkAsaasConnection(config, options),
    checkContaAzulConnection(config, options)
  ]);
}

export async function checkAsaasConnection(
  config: HarnessConfig,
  options: CheckConnectionsOptions = {}
): Promise<ConnectionHealth> {
  const base = {
    provider: "asaas" as const,
    label: "Asaas",
    checkedAt: new Date().toISOString(),
    recaptureCommand: ASAAS_RECAPTURE
  };

  if (!existsSync(config.asaasEnvPath)) {
    return { ...base, status: "missing", detail: "Arquivo .env do Asaas não encontrado." };
  }

  let cookieString: string;
  try {
    cookieString = loadAsaasCookieString(config.asaasEnvPath);
  } catch {
    return { ...base, status: "missing", detail: "COOKIE_STRING do Asaas não configurado." };
  }

  try {
    const client = new MappedAsaasSessionClient({ cookieString, request: options.request });
    await client.listCustomersPage(0, 1);
    return { ...base, status: "healthy", detail: "Sessão ativa." };
  } catch (error) {
    return classifyError(base, error);
  }
}

export async function checkContaAzulConnection(
  config: HarnessConfig,
  options: CheckConnectionsOptions = {}
): Promise<ConnectionHealth> {
  const base = {
    provider: "contaazul" as const,
    label: "Conta Azul",
    checkedAt: new Date().toISOString(),
    recaptureCommand: CONTAAZUL_RECAPTURE
  };

  if (!existsSync(config.contaAzulStatePath)) {
    return {
      ...base,
      status: "missing",
      detail: "Sessão do Conta Azul não capturada (state.json ausente)."
    };
  }

  let state;
  try {
    state = await loadBrowserState(config.contaAzulStatePath);
  } catch {
    return { ...base, status: "error", detail: "state.json do Conta Azul é inválido." };
  }

  const cookieHealth = checkContaAzulSessionState(state);
  if (!cookieHealth.ok) {
    return { ...base, status: "expired", detail: cookieHealth.reason };
  }

  try {
    const client = new MappedContaAzulSessionClient({ state, request: options.request });
    await client.listAccountancyClients();
    return { ...base, status: "healthy", detail: "Sessão ativa." };
  } catch (error) {
    return classifyError(base, error);
  }
}

function classifyError(
  base: Omit<ConnectionHealth, "status" | "detail">,
  error: unknown
): ConnectionHealth {
  if (error instanceof SessionExpiredError) {
    return { ...base, status: "expired", detail: "Sessão expirada — renove as credenciais." };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...base,
    status: "error",
    detail: message.length > 160 ? `${message.slice(0, 157)}...` : message
  };
}
