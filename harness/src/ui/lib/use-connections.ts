import { useCallback, useEffect, useRef, useState } from "react";

import type { ConnectionHealth, RenewEvent, RenewProvider } from "../../server/api-types.js";
import { checkConnections, confirmRenew, onRenewEvent, renewConnection } from "../api.js";

export type RenewPhase = "idle" | "starting" | "running" | "ready" | "done" | "error";

export type RenewUiState = {
  phase: RenewPhase;
  logs: string[];
  message?: string;
};

export type ConnectionsApi = {
  connections: ConnectionHealth[];
  loading: boolean;
  refresh: () => Promise<void>;
  renew: (provider: RenewProvider) => Promise<void>;
  confirm: (provider: RenewProvider) => Promise<void>;
  renewState: Record<RenewProvider, RenewUiState>;
};

const IDLE: RenewUiState = { phase: "idle", logs: [] };

function initialRenewState(): Record<RenewProvider, RenewUiState> {
  return { asaas: { ...IDLE }, contaazul: { ...IDLE } };
}

export function useConnections(): ConnectionsApi {
  const [connections, setConnections] = useState<ConnectionHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [renewState, setRenewState] = useState(initialRenewState);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await checkConnections();
      if (mounted.current) setConnections(next);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const patch = useCallback((provider: RenewProvider, update: Partial<RenewUiState>) => {
    setRenewState((current) => ({
      ...current,
      [provider]: { ...current[provider], ...update }
    }));
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();

    const unsubscribe = onRenewEvent((event: RenewEvent) => {
      if (!mounted.current) return;
      if (event.type === "log") {
        setRenewState((current) => ({
          ...current,
          [event.provider]: {
            ...current[event.provider],
            phase: current[event.provider].phase === "ready" ? "ready" : "running",
            logs: [...current[event.provider].logs, event.line].slice(-50)
          }
        }));
        return;
      }
      if (event.type === "ready") {
        patch(event.provider, { phase: "ready" });
        return;
      }
      // done
      if (event.ok) {
        patch(event.provider, { phase: "done", message: "Conexão renovada." });
        void refresh();
      } else {
        patch(event.provider, { phase: "error", message: event.detail ?? "Falha na renovação." });
      }
    });

    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [refresh, patch]);

  const renew = useCallback(
    async (provider: RenewProvider) => {
      setRenewState((current) => ({
        ...current,
        [provider]: { phase: "starting", logs: [], message: undefined }
      }));
      const response = await renewConnection(provider);
      if (response.status === "unavailable") {
        patch(provider, { phase: "error", message: response.reason });
      }
    },
    [patch]
  );

  const confirm = useCallback(
    async (provider: RenewProvider) => {
      patch(provider, { phase: "running" });
      await confirmRenew(provider);
    },
    [patch]
  );

  return { connections, loading, refresh, renew, confirm, renewState };
}
