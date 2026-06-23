import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Memória leve de preferências do operador (persistida em arquivo): lembra a
 * última empresa usada e os clientes recentes por empresa, para o assistente
 * oferecer "como da última vez" e ordenar escolhas.
 */
export type RememberedTenant = {
  tenantId: string | number;
  relationId?: string;
  tenantName?: string;
};

export type RememberedCustomer = {
  id: string;
  name: string;
};

export type ConferePreferences = {
  lastTenant?: RememberedTenant;
  recentCustomersByTenant?: Record<string, RememberedCustomer[]>;
};

export type PreferencesStore = {
  get(): ConferePreferences;
  recordTenant(tenant: RememberedTenant): void;
  recordCustomer(tenantKey: string | number, customer: RememberedCustomer): void;
};

const MAX_RECENT_CUSTOMERS = 8;

export function createInMemoryPreferencesStore(
  initial: ConferePreferences = {},
  persist: (prefs: ConferePreferences) => void = () => undefined
): PreferencesStore {
  let prefs: ConferePreferences = clone(initial);

  return {
    get() {
      return clone(prefs);
    },
    recordTenant(tenant) {
      if (tenant.tenantId === undefined || tenant.tenantId === null) return;
      prefs = { ...prefs, lastTenant: { ...tenant } };
      persist(prefs);
    },
    recordCustomer(tenantKey, customer) {
      if (!customer.id) return;
      const key = String(tenantKey);
      const byTenant = { ...(prefs.recentCustomersByTenant ?? {}) };
      const current = byTenant[key] ?? [];
      const deduped = current.filter((entry) => entry.id !== customer.id);
      byTenant[key] = [{ id: customer.id, name: customer.name }, ...deduped].slice(
        0,
        MAX_RECENT_CUSTOMERS
      );
      prefs = { ...prefs, recentCustomersByTenant: byTenant };
      persist(prefs);
    }
  };
}

export function createPreferencesStore(filePath: string): PreferencesStore {
  const initial = readPreferences(filePath);
  return createInMemoryPreferencesStore(initial, (prefs) => writePreferences(filePath, prefs));
}

function readPreferences(filePath: string): ConferePreferences {
  try {
    if (!existsSync(filePath)) return {};
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as ConferePreferences;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePreferences(filePath: string, prefs: ConferePreferences): void {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(prefs, null, 2), "utf-8");
  } catch {
    // Memória é best-effort: falha de escrita não pode quebrar o fluxo.
  }
}

function clone(prefs: ConferePreferences): ConferePreferences {
  return JSON.parse(JSON.stringify(prefs)) as ConferePreferences;
}
