import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createInMemoryPreferencesStore,
  createPreferencesStore
} from "../../src/core/preferences-store.js";

describe("preferences-store", () => {
  it("lembra a última empresa usada", () => {
    const store = createInMemoryPreferencesStore();
    store.recordTenant({ tenantId: 101, relationId: "rel_a", tenantName: "Empresa A" });
    expect(store.get().lastTenant).toEqual({
      tenantId: 101,
      relationId: "rel_a",
      tenantName: "Empresa A"
    });
  });

  it("mantém clientes recentes por empresa, sem duplicar e com mais recente primeiro", () => {
    const store = createInMemoryPreferencesStore();
    store.recordCustomer(101, { id: "c1", name: "Cliente 1" });
    store.recordCustomer(101, { id: "c2", name: "Cliente 2" });
    store.recordCustomer(101, { id: "c1", name: "Cliente 1" }); // repete c1

    const recent = store.get().recentCustomersByTenant?.["101"] ?? [];
    expect(recent.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("limita a 8 clientes recentes por empresa", () => {
    const store = createInMemoryPreferencesStore();
    for (let i = 0; i < 12; i++) {
      store.recordCustomer(101, { id: `c${i}`, name: `Cliente ${i}` });
    }
    const recent = store.get().recentCustomersByTenant?.["101"] ?? [];
    expect(recent).toHaveLength(8);
    expect(recent[0]?.id).toBe("c11");
  });

  it("persiste em arquivo e relê", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "confere-prefs-"));
    const file = path.join(dir, "preferences.json");

    const store = createPreferencesStore(file);
    store.recordTenant({ tenantId: 202, tenantName: "Empresa B" });

    const onDisk = JSON.parse(readFileSync(file, "utf-8"));
    expect(onDisk.lastTenant.tenantId).toBe(202);

    const reopened = createPreferencesStore(file);
    expect(reopened.get().lastTenant?.tenantName).toBe("Empresa B");
  });
});
