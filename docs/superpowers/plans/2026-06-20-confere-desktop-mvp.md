# Confere Desktop MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Confere local desktop MVP on top of the existing harness, with a real Electron interface, local API, agent dry-run planning, contextual live approval, operation history, and session/quota status.

**Architecture:** Extract harness bootstrapping from the CLI into a reusable runtime factory, then add a local HTTP API consumed by an Electron + React renderer. The UI only calls product-level workflow endpoints; provider/session HTTP clients and low-level tools remain behind the harness registry and safe workflow router.

**Tech Stack:** Node.js, TypeScript, Zod, Vitest, Electron, electron-vite, React, Vite, lucide-react, native Node HTTP server, existing harness ledger/artifact/session modules.

---

## Source Spec

Approved spec: `docs/superpowers/specs/2026-06-20-confere-desktop-mvp-design.md`

## File Structure

Create or modify these files:

- Modify `harness/package.json`: rename package identity, add Electron/React/Vite dependencies and scripts.
- Modify `harness/package-lock.json`: npm dependency lock update.
- Modify `harness/.gitignore`: ignore local `.superpowers/` scratch data and desktop build output.
- Modify `harness/tsconfig.json`: include Electron/UI/server TypeScript files.
- Create `harness/electron.vite.config.ts`: Electron main/preload/renderer build config.
- Create `harness/index.html`: Vite renderer entry.
- Create `harness/src/core/harness-runtime.ts`: shared runtime bootstrap for CLI and Confere API.
- Modify `harness/src/cli.ts`: use `createDefaultMappedToolRegistry()` from runtime instead of private duplicate code.
- Create `harness/tests/core/harness-runtime.test.ts`: runtime bootstrap tests with missing sessions and forbidden official tool names preserved.
- Modify `harness/src/core/operation-summary.ts`: add operation-list summary support.
- Modify `harness/tests/core/operation-summary.test.ts`: operation list grouping tests.
- Create `harness/src/server/api-types.ts`: request/response contracts for UI and local API.
- Create `harness/src/server/draft-store.ts`: in-memory exact-params handoff store for active dry-run plans.
- Create `harness/tests/server/draft-store.test.ts`: draft store behavior tests.
- Create `harness/src/server/confere-service.ts`: application service used by HTTP API and tests.
- Create `harness/tests/server/confere-service.test.ts`: agent turn, status, operation summary, and approval handoff tests.
- Create `harness/src/server/local-api.ts`: native HTTP server routes.
- Create `harness/tests/server/local-api.test.ts`: HTTP route contract tests.
- Create `harness/src/server/dev-server.ts`: starts local API without Electron for smoke/debug.
- Create `harness/src/desktop/main.ts`: Electron main process, starts local API, opens renderer.
- Create `harness/src/desktop/preload.ts`: safe bridge exposing API base URL and shell actions.
- Create `harness/src/desktop/types.d.ts`: renderer global type declarations.
- Create `harness/src/ui/main.tsx`: React entrypoint.
- Create `harness/src/ui/App.tsx`: app shell and screen routing.
- Create `harness/src/ui/api.ts`: typed fetch client for local API.
- Create `harness/src/ui/types.ts`: UI state types derived from API contracts.
- Create `harness/src/ui/styles.css`: Finance OS claro visual system.
- Create `harness/src/ui/components/AppShell.tsx`: sidebar/top status layout.
- Create `harness/src/ui/components/StatusPill.tsx`: compact status indicator.
- Create `harness/src/ui/components/ActionButton.tsx`: contextual buttons with icons.
- Create `harness/src/ui/components/OperationSummaryPanel.tsx`: reusable operation details panel.
- Create `harness/src/ui/screens/HomeScreen.tsx`: module chooser and quick status.
- Create `harness/src/ui/screens/WorkflowScreen.tsx`: shared Conta Azul/Asaas conversational workflow screen.
- Create `harness/src/ui/screens/OperationsScreen.tsx`: ledger operation list and summary.
- Create `harness/src/ui/screens/SessionsScreen.tsx`: session/quota/local state panel.
- Create `harness/tests/ui/confere-ui.test.tsx`: renderer smoke tests for routing and approval button states.
- Create `harness/vitest.ui.config.ts`: jsdom test config for React UI tests.
- Modify `harness/docs/runbook.md`: add Confere desktop demo runbook and controlled live checklist.

Implementation rule: the renderer must never import provider modules under `harness/src/modules/**`. It may import shared API types from `harness/src/server/api-types.ts` only.

## Task 1: Package Identity, Scripts, and Dependencies

**Files:**
- Modify: `harness/package.json`
- Modify: `harness/package-lock.json`
- Modify: `harness/.gitignore`
- Create: `harness/electron.vite.config.ts`
- Create: `harness/index.html`

- [ ] **Step 1: Update package metadata and scripts**

In `harness/package.json`, change the package name and scripts to this shape:

```json
{
  "name": "confere-harness",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/cli.ts",
    "server:dev": "tsx src/server/dev-server.ts",
    "desktop:dev": "electron-vite dev",
    "desktop:build": "electron-vite build",
    "contaazul:controlled-sale": "tsx scripts/contaazul-controlled-sale-test.ts",
    "test": "vitest run",
    "test:ui": "vitest run --config vitest.ui.config.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "dotenv": "^17.4.2",
    "lucide-react": "^0.468.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^4.2.0"
  },
  "devDependencies": {
    "@types/node": "^24.10.1",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "electron": "^39.0.0",
    "electron-vite": "^4.0.0",
    "jsdom": "^27.0.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "vite": "^7.0.0",
    "vitest": "^4.0.15"
  }
}
```

If npm resolves newer compatible versions, keep the lockfile versions npm writes. The product identity must be `Confere` in UI text and `confere-harness` in package metadata.

- [ ] **Step 2: Install dependencies**

Run:

```powershell
cd harness
npm install
```

Expected: `package-lock.json` updates and npm exits with code 0.

- [ ] **Step 3: Ignore scratch and desktop build output**

Append these lines to `harness/.gitignore`:

```gitignore
.superpowers/
dist/
dist-electron/
out/
```

If `.superpowers/` exists at repo root, do not move or commit it. Add a separate root `.gitignore` entry only if root `.superpowers/` still appears in `git status --short` after this task.

- [ ] **Step 4: Add Electron Vite config**

Create `harness/electron.vite.config.ts`:

```ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/desktop/main.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/desktop/preload.ts")
      }
    }
  },
  renderer: {
    root: ".",
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "index.html")
      }
    },
    server: {
      host: "127.0.0.1",
      port: 5173
    }
  }
});
```

- [ ] **Step 5: Add renderer HTML entry**

Create `harness/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Confere</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/ui/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Verify package setup**

Run:

```powershell
cd harness
npm run typecheck
```

Expected now: it may fail because referenced desktop/UI files do not exist yet. The failure should mention missing files from this plan, not existing harness regressions.

- [ ] **Step 7: Commit package setup**

Run:

```powershell
git add harness/package.json harness/package-lock.json harness/.gitignore harness/electron.vite.config.ts harness/index.html
git commit -m "chore: add confere desktop toolchain"
```

Expected: commit contains only package/config/HTML setup.

## Task 2: Extract Shared Harness Runtime

**Files:**
- Create: `harness/src/core/harness-runtime.ts`
- Modify: `harness/src/cli.ts`
- Test: `harness/tests/core/harness-runtime.test.ts`

- [ ] **Step 1: Write failing runtime bootstrap tests**

Create `harness/tests/core/harness-runtime.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createDefaultMappedToolRegistry,
  resolveConfigCwd
} from "../../src/core/harness-runtime.js";
import { loadHarnessConfig } from "../../src/core/config.js";

describe("harness runtime", () => {
  it("resolves the repo root when executed inside harness", () => {
    const cwd = path.join("C:", "repo", "harness");
    expect(resolveConfigCwd(cwd).replace(/\\/g, "/")).toBe("C:/repo");
  });

  it("returns warnings instead of throwing when provider sessions are absent", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "confere-runtime-"));
    const config = loadHarnessConfig(
      {
        RUNTIME_MODE: "dry-run",
        ASAAS_ENV_PATH: "missing.env",
        CONTAAZUL_STATE_PATH: "missing-state.json"
      },
      cwd
    );

    const { registry, warnings } = await createDefaultMappedToolRegistry(config);

    expect(registry.list()).toEqual([]);
    expect(warnings).toEqual([
      expect.stringContaining("Asaas session env not found"),
      expect.stringContaining("Conta Azul state not found")
    ]);
  });

  it("loads an Asaas workflow tool when a session env is present", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "confere-runtime-"));
    const asaasEnv = path.join(cwd, "asaas.env");
    await writeFile(asaasEnv, "COOKIE_STRING=session=test\n", "utf8");
    const config = loadHarnessConfig(
      {
        RUNTIME_MODE: "dry-run",
        ASAAS_ENV_PATH: asaasEnv,
        CONTAAZUL_STATE_PATH: "missing-state.json"
      },
      cwd
    );

    const { registry } = await createDefaultMappedToolRegistry(config);

    expect(registry.list().map((tool) => tool.name)).toContain(
      "asaas.create_boleto_charge_workflow"
    );
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
cd harness
npm test -- tests/core/harness-runtime.test.ts
```

Expected: FAIL because `src/core/harness-runtime.ts` does not exist.

- [ ] **Step 3: Create runtime bootstrap module**

Create `harness/src/core/harness-runtime.ts` by moving the registry setup logic out of `src/cli.ts`:

```ts
import { existsSync } from "node:fs";
import path from "node:path";

import type { HarnessConfig } from "./config.js";
import { createToolRegistry, type ToolRegistry } from "./tool-registry.js";
import { checkContaAzulSessionState, loadBrowserState } from "./session-store.js";
import { registerHarnessTools } from "../agent/orchestrator.js";
import {
  loadAsaasCookieString,
  MappedAsaasSessionClient
} from "../modules/asaas/client.js";
import {
  createAsaasMutationTools,
  createAsaasReadTools
} from "../modules/asaas/tools.js";
import { MappedContaAzulSessionClient } from "../modules/contaazul/client.js";
import {
  createContaAzulMutationTools,
  createContaAzulReadTools
} from "../modules/contaazul/tools.js";
import { createContaAzulWorkflowTools } from "../modules/contaazul/workflows.js";

export type RuntimeRegistryResult = {
  registry: ToolRegistry;
  warnings: string[];
};

export function resolveConfigCwd(cwd = process.cwd()): string {
  return path.basename(cwd).toLowerCase() === "harness"
    ? path.resolve(cwd, "..")
    : cwd;
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
      warnings.push(error instanceof Error ? error.message : "Conta Azul session could not be loaded.");
    }
  } else {
    warnings.push(`Conta Azul state not found: ${config.contaAzulStatePath}`);
  }

  return { registry, warnings };
}
```

- [ ] **Step 4: Update CLI to use shared runtime**

In `harness/src/cli.ts`, remove the private `createDefaultMappedToolRegistry()` function and these imports:

```ts
import { existsSync } from "node:fs";
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
```

Add:

```ts
import {
  createDefaultMappedToolRegistry,
  resolveConfigCwd
} from "./core/harness-runtime.js";
```

Replace config cwd resolution with:

```ts
const configCwd = resolveConfigCwd(process.cwd());
```

Replace registry setup with:

```ts
const { registry, warnings } = await createDefaultMappedToolRegistry(config);
```

- [ ] **Step 5: Verify runtime tests pass**

Run:

```powershell
cd harness
npm test -- tests/core/harness-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Verify existing CLI tests still pass**

Run:

```powershell
cd harness
npm test -- tests/cli-args.test.ts tests/agent/orchestrator.test.ts tests/agent/agent-runner.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit runtime extraction**

Run:

```powershell
git add harness/src/core/harness-runtime.ts harness/src/cli.ts harness/tests/core/harness-runtime.test.ts
git commit -m "refactor: share harness runtime bootstrap"
```

Expected: commit contains runtime extraction and tests only.

## Task 3: Operation Listing for UI History

**Files:**
- Modify: `harness/src/core/operation-summary.ts`
- Test: `harness/tests/core/operation-summary.test.ts`

- [ ] **Step 1: Add failing operation-list test**

Append this test to `harness/tests/core/operation-summary.test.ts`:

```ts
import { listOperationSummaries } from "../../src/core/operation-summary.js";

it("lists operation summaries newest first", async () => {
  const ledgerPath = await tempLedgerPath();
  await appendLedgerEntry(ledgerPath, {
    operationId: "op_old",
    provider: "asaas",
    toolName: "asaas.create_boleto_charge_workflow",
    status: "planned",
    responseSummary: { summary: "old", customerName: "Cliente Antigo" },
    artifacts: [],
    warnings: []
  });
  await appendLedgerEntry(ledgerPath, {
    operationId: "op_new",
    provider: "contaazul",
    toolName: "contaazul.create_service_sale_boleto_workflow",
    status: "succeeded",
    responseSummary: { summary: "new", saleNumber: 926 },
    artifacts: [{ kind: "pdf", path: "boleto.pdf", label: "boleto" }],
    warnings: ["demo warning"]
  });

  const summaries = await listOperationSummaries({ ledgerPath, limit: 10 });

  expect(summaries.map((summary) => summary.operationId)).toEqual(["op_new", "op_old"]);
  expect(summaries[0]).toMatchObject({
    latestStatus: "succeeded",
    saleNumber: 926,
    warnings: ["demo warning"]
  });
});
```

Move the new import into the existing grouped import at the top of the file instead of adding a second duplicate import.

- [ ] **Step 2: Run failing test**

Run:

```powershell
cd harness
npm test -- tests/core/operation-summary.test.ts
```

Expected: FAIL because `listOperationSummaries` is not exported.

- [ ] **Step 3: Implement operation list**

Add this export to `harness/src/core/operation-summary.ts`:

```ts
export async function listOperationSummaries(input: {
  ledgerPath: string;
  limit?: number;
}): Promise<OperationSummary[]> {
  const entries = await safeReadLedgerEntries(input.ledgerPath);
  const byOperation = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const group = byOperation.get(entry.operationId) ?? [];
    group.push(entry);
    byOperation.set(entry.operationId, group);
  }

  return Array.from(byOperation.entries())
    .map(([operationId, groupedEntries]) => summaryFromEntries(operationId, groupedEntries, false))
    .sort((a, b) => (b.latestTimestamp ?? "").localeCompare(a.latestTimestamp ?? ""))
    .slice(0, input.limit ?? 50);
}
```

Extract the object-building logic from `summarizeOperationById()` into:

```ts
function summaryFromEntries(
  operationId: string,
  entries: LedgerEntry[],
  includeEntries: boolean
): OperationSummary {
  const latest = entries[entries.length - 1]!;
  const summary = asRecord(latest.responseSummary);
  const artifacts = latest.artifacts.length > 0
    ? latest.artifacts
    : lastNonEmptyArtifacts(entries);

  return {
    operationId,
    found: true,
    provider: latest.provider,
    toolName: latest.toolName,
    latestStatus: latest.status,
    firstTimestamp: entries[0]?.timestamp,
    latestTimestamp: latest.timestamp,
    entryCount: entries.length,
    summary: stringValue(summary?.summary),
    idempotencyKey: stringValue(summary?.idempotencyKey),
    duplicateOperationId: stringValue(summary?.duplicateOperationId),
    orphanedSaleId: stringValue(summary?.orphanedSaleId),
    failedStep: stringValue(summary?.failedStep),
    saleNumber: stringOrNumber(summary?.saleNumber),
    chargeUrl: stringValue(summary?.chargeUrl),
    customerName: stringValue(summary?.customerName),
    dueDateIso: stringValue(summary?.dueDateIso),
    unitValue: stringOrNumber(summary?.unitValue),
    artifacts,
    warnings: unique(entries.flatMap((entry) => entry.warnings)),
    entries: includeEntries ? entries : undefined
  };
}
```

Change `summarizeOperationById()` to call `summaryFromEntries(input.operationId, entries, input.includeEntries === true)`.

- [ ] **Step 4: Run operation summary tests**

Run:

```powershell
cd harness
npm test -- tests/core/operation-summary.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit operation listing**

Run:

```powershell
git add harness/src/core/operation-summary.ts harness/tests/core/operation-summary.test.ts
git commit -m "feat: list operation summaries"
```

Expected: commit contains operation summary support only.

## Task 4: Draft Store for Agent-to-Live Handoff

**Files:**
- Create: `harness/src/server/api-types.ts`
- Create: `harness/src/server/draft-store.ts`
- Test: `harness/tests/server/draft-store.test.ts`

- [ ] **Step 1: Write failing draft store tests**

Create `harness/tests/server/draft-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createDraftStore } from "../../src/server/draft-store.js";

describe("draft store", () => {
  it("stores exact workflow params by operation id", () => {
    const store = createDraftStore();
    store.save({
      operationId: "op_1",
      toolName: "asaas.create_boleto_charge_workflow",
      request: "criar boleto",
      params: {
        customerName: "Cliente Exemplo",
        valueBr: "120,00",
        dueDateBr: "30/06/2026",
        description: "Honorarios"
      },
      createdAt: "2026-06-20T12:00:00.000Z"
    });

    expect(store.get("op_1")).toMatchObject({
      operationId: "op_1",
      toolName: "asaas.create_boleto_charge_workflow",
      params: { customerName: "Cliente Exemplo" }
    });
  });

  it("does not invent drafts for unknown operation ids", () => {
    const store = createDraftStore();

    expect(store.get("missing")).toBeUndefined();
  });

  it("removes a draft after successful handoff", () => {
    const store = createDraftStore();
    store.save({
      operationId: "op_1",
      toolName: "contaazul.create_service_sale_boleto_workflow",
      request: "criar venda",
      params: { tenantId: 3047702 },
      createdAt: "2026-06-20T12:00:00.000Z"
    });

    expect(store.consume("op_1")).toMatchObject({ operationId: "op_1" });
    expect(store.get("op_1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run failing draft tests**

Run:

```powershell
cd harness
npm test -- tests/server/draft-store.test.ts
```

Expected: FAIL because server files do not exist.

- [ ] **Step 3: Add shared API contracts**

Create `harness/src/server/api-types.ts`:

```ts
import type { AgentRunResult } from "../agent/agent-runner.js";
import type { OperationSummary } from "../core/operation-summary.js";
import type { RuntimeMode, ToolReceipt } from "../core/tool-types.js";

export type ConfereModule = "home" | "contaazul" | "asaas" | "operacoes" | "sessoes";

export type ConfereStatus = {
  appName: "Confere";
  runtimeMode: RuntimeMode;
  allowLiveMutations: boolean;
  sessions: {
    asaas: "available" | "missing" | "invalid";
    contaazul: "available" | "missing" | "invalid";
  };
  model: {
    provider: "gemini";
    model: string;
    dailyLimit: number;
    usagePath: string;
  };
  warnings: string[];
  artifactsDir: string;
  ledgerPath: string;
};

export type AgentTurnApiRequest = {
  request: string;
  module?: "contaazul" | "asaas";
  sessionId?: string;
  params?: Record<string, unknown>;
  operatorConfirmation?: boolean;
};

export type AgentTurnApiResponse = {
  status: "ok";
  result: AgentRunResult;
  draftOperationId?: string;
  warnings: string[];
};

export type ExecuteOperationApiRequest = {
  operationId: string;
};

export type ExecuteOperationApiResponse =
  | {
      status: "executed";
      receipt: ToolReceipt;
      summary?: OperationSummary;
    }
  | {
      status: "blocked";
      reason: string;
    };

export type OperationListApiResponse = {
  status: "ok";
  operations: OperationSummary[];
};

export type OperationSummaryApiResponse = {
  status: "ok";
  operation: OperationSummary;
};
```

- [ ] **Step 4: Add in-memory draft store**

Create `harness/src/server/draft-store.ts`:

```ts
export type OperationDraft = {
  operationId: string;
  toolName: string;
  request: string;
  params: Record<string, unknown>;
  createdAt: string;
};

export type DraftStore = {
  save(draft: OperationDraft): void;
  get(operationId: string): OperationDraft | undefined;
  consume(operationId: string): OperationDraft | undefined;
  list(): OperationDraft[];
};

export function createDraftStore(): DraftStore {
  const drafts = new Map<string, OperationDraft>();

  return {
    save(draft) {
      drafts.set(draft.operationId, structuredClone(draft));
    },
    get(operationId) {
      const draft = drafts.get(operationId);
      return draft ? structuredClone(draft) : undefined;
    },
    consume(operationId) {
      const draft = drafts.get(operationId);
      if (!draft) return undefined;
      drafts.delete(operationId);
      return structuredClone(draft);
    },
    list() {
      return Array.from(drafts.values()).map((draft) => structuredClone(draft));
    }
  };
}
```

- [ ] **Step 5: Run draft tests**

Run:

```powershell
cd harness
npm test -- tests/server/draft-store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit draft store**

Run:

```powershell
git add harness/src/server/api-types.ts harness/src/server/draft-store.ts harness/tests/server/draft-store.test.ts
git commit -m "feat: add confere draft handoff store"
```

Expected: commit contains API contracts and in-memory draft store.

## Task 5: Confere Service Layer

**Files:**
- Create: `harness/src/server/confere-service.ts`
- Test: `harness/tests/server/confere-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `harness/tests/server/confere-service.test.ts`:

```ts
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createFakeModelProvider } from "../support/fake-model-provider.js";
import { createConfereService } from "../../src/server/confere-service.js";
import { createToolRegistry } from "../../src/core/tool-registry.js";
import type { ToolReceipt } from "../../src/core/tool-types.js";

describe("confere service", () => {
  it("returns status without exposing secrets", async () => {
    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: {
        RUNTIME_MODE: "dry-run",
        GEMINI_API_KEY: "secret_value",
        ASAAS_ENV_PATH: "missing.env",
        CONTAAZUL_STATE_PATH: "missing.json"
      },
      registryFactory: async () => ({ registry: createToolRegistry(), warnings: ["missing sessions"] }),
      modelProvider: createFakeModelProvider({})
    });

    const status = await service.getStatus();

    expect(status.appName).toBe("Confere");
    expect(JSON.stringify(status)).not.toContain("secret_value");
    expect(status.warnings).toContain("missing sessions");
  });

  it("saves a draft when agent dry-run plans a workflow", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "asaas.create_boleto_charge_workflow",
      description: "workflow",
      parameters: z.object({
        customerName: z.string(),
        valueBr: z.string(),
        dueDateBr: z.string(),
        description: z.string()
      }),
      execute: async () => plannedReceipt("asaas.create_boleto_charge_workflow", "op_agent")
    });

    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: { RUNTIME_MODE: "dry-run" },
      registryFactory: async () => ({ registry, warnings: [] }),
      modelProvider: createFakeModelProvider({
        intent: "create_boleto_charge_workflow",
        toolName: "asaas.create_boleto_charge_workflow",
        params: {
          customerName: "Cliente Exemplo",
          valueBr: "120,00",
          dueDateBr: "30/06/2026",
          description: "Honorarios"
        },
        missingFields: [],
        questions: [],
        risk: "low",
        confidence: 0.95,
        reason: "Dados completos."
      })
    });

    const response = await service.runAgentTurn({
      request: "criar boleto no Asaas",
      sessionId: "sess_demo"
    });

    expect(response.draftOperationId).toBe("op_agent");
    expect(service.getDraft("op_agent")).toMatchObject({
      operationId: "op_agent",
      params: { customerName: "Cliente Exemplo" }
    });
  });

  it("executes a saved draft in live mode with APROVAR token", async () => {
    const calls: unknown[] = [];
    const registry = createToolRegistry();
    registry.register({
      name: "asaas.create_boleto_charge_workflow",
      description: "workflow",
      parameters: z.object({
        operationId: z.string().optional(),
        approvalText: z.string().optional(),
        customerName: z.string(),
        valueBr: z.string(),
        dueDateBr: z.string(),
        description: z.string()
      }),
      execute: async (params) => {
        calls.push(params);
        return {
          ...plannedReceipt("asaas.create_boleto_charge_workflow", "op_agent"),
          status: "succeeded",
          dryRun: false
        } satisfies ToolReceipt;
      }
    });

    const service = await createConfereService({
      cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
      env: {
        RUNTIME_MODE: "dry-run",
        ALLOW_LIVE_MUTATIONS: "true"
      },
      registryFactory: async (config) => {
        expect(config.runtimeMode).toBe("live");
        return { registry, warnings: [] };
      },
      modelProvider: createFakeModelProvider({})
    });
    service.saveDraftForTest({
      operationId: "op_agent",
      toolName: "asaas.create_boleto_charge_workflow",
      request: "criar boleto",
      params: {
        customerName: "Cliente Exemplo",
        valueBr: "120,00",
        dueDateBr: "30/06/2026",
        description: "Honorarios"
      },
      createdAt: "2026-06-20T12:00:00.000Z"
    });

    const response = await service.executeApprovedOperation({ operationId: "op_agent" });

    expect(response.status).toBe("executed");
    expect(calls).toEqual([
      {
        operationId: "op_agent",
        approvalText: "APROVAR op_agent",
        customerName: "Cliente Exemplo",
        valueBr: "120,00",
        dueDateBr: "30/06/2026",
        description: "Honorarios"
      }
    ]);
  });
});

function plannedReceipt(toolName: string, operationId: string): ToolReceipt {
  return {
    operationId,
    provider: toolName.startsWith("asaas.") ? "asaas" : "contaazul",
    toolName,
    status: "planned",
    dryRun: true,
    summary: "planned",
    data: { approvalPreview: { operationId } },
    artifacts: [],
    warnings: []
  };
}
```

Also create `harness/tests/support/fake-model-provider.ts`:

```ts
import type { ModelProvider, ModelRequest, ModelResponse } from "../../src/agent/model-provider.js";

export function createFakeModelProvider(plan: unknown): ModelProvider & { calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  return {
    name: "gemini",
    model: "fake-model",
    calls,
    async generateText(input: ModelRequest): Promise<ModelResponse> {
      calls.push(input);
      return { provider: "gemini", model: "fake-model", text: JSON.stringify(plan) };
    }
  };
}
```

- [ ] **Step 2: Run failing service tests**

Run:

```powershell
cd harness
npm test -- tests/server/confere-service.test.ts
```

Expected: FAIL because `confere-service.ts` does not exist.

- [ ] **Step 3: Implement Confere service**

Create `harness/src/server/confere-service.ts`:

```ts
import { config as loadDotenv } from "dotenv";
import path from "node:path";

import { runAgentTurn } from "../agent/agent-runner.js";
import { createAgentModelProvider } from "../agent/model-provider-factory.js";
import type { ModelProvider } from "../agent/model-provider.js";
import { loadHarnessConfig, type HarnessConfig } from "../core/config.js";
import {
  createDefaultMappedToolRegistry,
  resolveConfigCwd,
  type RuntimeRegistryResult
} from "../core/harness-runtime.js";
import {
  listOperationSummaries,
  summarizeOperationById
} from "../core/operation-summary.js";
import type { ToolRegistry } from "../core/tool-registry.js";
import type {
  AgentTurnApiRequest,
  AgentTurnApiResponse,
  ConfereStatus,
  ExecuteOperationApiRequest,
  ExecuteOperationApiResponse
} from "./api-types.js";
import {
  createDraftStore,
  type DraftStore,
  type OperationDraft
} from "./draft-store.js";

export type ConfereService = {
  getStatus(): Promise<ConfereStatus>;
  runAgentTurn(input: AgentTurnApiRequest): Promise<AgentTurnApiResponse>;
  executeApprovedOperation(input: ExecuteOperationApiRequest): Promise<ExecuteOperationApiResponse>;
  listOperations(limit?: number): Promise<Awaited<ReturnType<typeof listOperationSummaries>>>;
  summarizeOperation(operationId: string): Promise<Awaited<ReturnType<typeof summarizeOperationById>>>;
  getDraft(operationId: string): OperationDraft | undefined;
  saveDraftForTest(draft: OperationDraft): void;
};

export type CreateConfereServiceOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  registryFactory?: (config: HarnessConfig) => Promise<RuntimeRegistryResult>;
  modelProvider?: ModelProvider;
  draftStore?: DraftStore;
};

export async function createConfereService(
  options: CreateConfereServiceOptions = {}
): Promise<ConfereService> {
  const cwd = resolveConfigCwd(options.cwd ?? process.cwd());
  loadDotenv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });
  const baseEnv = { ...process.env, ...(options.env ?? {}) };
  const registryFactory = options.registryFactory ?? createDefaultMappedToolRegistry;
  const draftStore = options.draftStore ?? createDraftStore();

  function loadConfig(runtimeMode?: "dry-run" | "live"): HarnessConfig {
    return loadHarnessConfig(
      {
        ...baseEnv,
        RUNTIME_MODE: runtimeMode ?? baseEnv.RUNTIME_MODE
      },
      cwd
    );
  }

  async function runtime(runtimeMode?: "dry-run" | "live"): Promise<{
    config: HarnessConfig;
    registry: ToolRegistry;
    warnings: string[];
  }> {
    const config = loadConfig(runtimeMode);
    const { registry, warnings } = await registryFactory(config);
    return { config, registry, warnings };
  }

  return {
    async getStatus() {
      const { config, warnings } = await runtime("dry-run");
      return {
        appName: "Confere",
        runtimeMode: config.runtimeMode,
        allowLiveMutations: config.allowLiveMutations,
        sessions: {
          asaas: warnings.some((warning) => warning.includes("Asaas session env not found"))
            ? "missing"
            : "available",
          contaazul: warnings.some((warning) => warning.includes("Conta Azul state not found"))
            ? "missing"
            : "available"
        },
        model: {
          provider: config.agentModelProvider,
          model: config.agentModelName,
          dailyLimit: config.agentModelMaxDailyRequests,
          usagePath: config.agentModelUsagePath
        },
        warnings,
        artifactsDir: config.artifactsDir,
        ledgerPath: config.ledgerPath
      };
    },

    async runAgentTurn(input) {
      const { config, registry, warnings } = await runtime("dry-run");
      const provider = options.modelProvider ?? createAgentModelProvider(config);
      const params = {
        ...(input.params ?? {}),
        ...(input.operatorConfirmation ? { operatorConfirmation: true } : {})
      };
      const result = await runAgentTurn({
        request: input.request,
        registry,
        provider,
        runtimeMode: "dry-run",
        params,
        sessionId: input.sessionId,
        sessionsDir: config.agentSessionsDir
      });
      const draftOperationId = saveDraftFromAgentResult({
        draftStore,
        request: input.request,
        result
      });
      return { status: "ok", result, draftOperationId, warnings };
    },

    async executeApprovedOperation(input) {
      const draft = draftStore.consume(input.operationId);
      if (!draft) {
        return {
          status: "blocked",
          reason: `No active dry-run draft found for operation: ${input.operationId}`
        };
      }
      const { config, registry } = await runtime("live");
      if (!config.allowLiveMutations) {
        draftStore.save(draft);
        return {
          status: "blocked",
          reason: "Live mutations are disabled. Set ALLOW_LIVE_MUTATIONS=true for controlled execution."
        };
      }
      const tool = registry.list().find((definition) => definition.name === draft.toolName);
      if (!tool) {
        draftStore.save(draft);
        return { status: "blocked", reason: `Mapped tool is not registered: ${draft.toolName}` };
      }
      const params = tool.parameters.parse({
        ...draft.params,
        operationId: input.operationId,
        approvalText: `APROVAR ${input.operationId}`
      });
      const receipt = await tool.execute(params);
      const summary = await summarizeOperationById({
        ledgerPath: config.ledgerPath,
        operationId: input.operationId
      });
      return { status: "executed", receipt, summary };
    },

    async listOperations(limit) {
      const config = loadConfig("dry-run");
      return listOperationSummaries({ ledgerPath: config.ledgerPath, limit });
    },

    async summarizeOperation(operationId) {
      const config = loadConfig("dry-run");
      return summarizeOperationById({ ledgerPath: config.ledgerPath, operationId });
    },

    getDraft(operationId) {
      return draftStore.get(operationId);
    },

    saveDraftForTest(draft) {
      draftStore.save(draft);
    }
  };
}

function saveDraftFromAgentResult(input: {
  draftStore: DraftStore;
  request: string;
  result: Awaited<ReturnType<typeof runAgentTurn>>;
}): string | undefined {
  if (input.result.status !== "executed") return undefined;
  if (input.result.receipt.status !== "planned") return undefined;

  const data = input.result.receipt.data;
  const approvalPreview = data && typeof data === "object" && "approvalPreview" in data
    ? (data as { approvalPreview?: { operationId?: string } }).approvalPreview
    : undefined;
  const operationId = approvalPreview?.operationId ?? input.result.receipt.operationId;

  input.draftStore.save({
    operationId,
    toolName: input.result.receipt.toolName,
    request: input.request,
    params: input.result.plan.params,
    createdAt: new Date().toISOString()
  });
  return operationId;
}
```

- [ ] **Step 4: Run service tests**

Run:

```powershell
cd harness
npm test -- tests/server/confere-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run agent tests to verify no regression**

Run:

```powershell
cd harness
npm test -- tests/agent/agent-runner.test.ts tests/agent/safe-workflow-registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit service layer**

Run:

```powershell
git add harness/src/server/confere-service.ts harness/tests/server/confere-service.test.ts harness/tests/support/fake-model-provider.ts
git commit -m "feat: add confere service layer"
```

Expected: commit contains service and tests.

## Task 6: Local HTTP API

**Files:**
- Create: `harness/src/server/local-api.ts`
- Create: `harness/src/server/dev-server.ts`
- Test: `harness/tests/server/local-api.test.ts`

- [ ] **Step 1: Write failing HTTP API tests**

Create `harness/tests/server/local-api.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";

import { startConfereLocalApi } from "../../src/server/local-api.js";
import type { ConfereService } from "../../src/server/confere-service.js";

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers.length = 0;
});

describe("local api", () => {
  it("serves status", async () => {
    const server = await startConfereLocalApi({ service: fakeService() });
    servers.push(server);

    const response = await fetch(`${server.url}/api/status`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      appName: "Confere",
      runtimeMode: "dry-run"
    });
  });

  it("runs an agent turn", async () => {
    const server = await startConfereLocalApi({ service: fakeService() });
    servers.push(server);

    const response = await fetch(`${server.url}/api/agent/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "criar boleto", sessionId: "sess_1" })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      draftOperationId: "op_1"
    });
  });

  it("returns 400 for invalid json", async () => {
    const server = await startConfereLocalApi({ service: fakeService() });
    servers.push(server);

    const response = await fetch(`${server.url}/api/agent/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: "error" });
  });
});

function fakeService(): ConfereService {
  return {
    async getStatus() {
      return {
        appName: "Confere",
        runtimeMode: "dry-run",
        allowLiveMutations: false,
        sessions: { asaas: "missing", contaazul: "missing" },
        model: {
          provider: "gemini",
          model: "fake",
          dailyLimit: 100,
          usagePath: "usage.json"
        },
        warnings: [],
        artifactsDir: "artifacts",
        ledgerPath: "ledger.jsonl"
      };
    },
    async runAgentTurn() {
      return {
        status: "ok",
        draftOperationId: "op_1",
        warnings: [],
        result: {
          status: "blocked",
          reason: "fake"
        }
      };
    },
    async executeApprovedOperation() {
      return { status: "blocked", reason: "fake" };
    },
    async listOperations() {
      return [];
    },
    async summarizeOperation(operationId) {
      return { operationId, found: false, entryCount: 0, artifacts: [], warnings: [] };
    },
    getDraft() {
      return undefined;
    },
    saveDraftForTest() {}
  };
}
```

- [ ] **Step 2: Run failing HTTP API tests**

Run:

```powershell
cd harness
npm test -- tests/server/local-api.test.ts
```

Expected: FAIL because `local-api.ts` does not exist.

- [ ] **Step 3: Implement native HTTP API**

Create `harness/src/server/local-api.ts`:

```ts
import http from "node:http";
import { URL } from "node:url";

import { createConfereService, type ConfereService } from "./confere-service.js";

export type ConfereLocalApi = {
  url: string;
  port: number;
  close(): Promise<void>;
};

export async function startConfereLocalApi(input: {
  service?: ConfereService;
  port?: number;
} = {}): Promise<ConfereLocalApi> {
  const service = input.service ?? await createConfereService();
  const server = http.createServer(async (request, response) => {
    try {
      await routeRequest(service, request, response);
    } catch (error) {
      writeJson(response, 500, {
        status: "error",
        message: error instanceof Error ? error.message : "Unexpected server error"
      });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(input.port ?? 0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Confere local API did not bind to a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

async function routeRequest(
  service: ConfereService,
  request: http.IncomingMessage,
  response: http.ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/api/status") {
    writeJson(response, 200, await service.getStatus());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/operations") {
    const limit = Number(url.searchParams.get("limit") ?? "50");
    writeJson(response, 200, { status: "ok", operations: await service.listOperations(limit) });
    return;
  }

  const operationMatch = url.pathname.match(/^\/api\/operations\/([^/]+)$/);
  if (request.method === "GET" && operationMatch) {
    writeJson(response, 200, {
      status: "ok",
      operation: await service.summarizeOperation(decodeURIComponent(operationMatch[1]!))
    });
    return;
  }

  const executeMatch = url.pathname.match(/^\/api\/operations\/([^/]+)\/execute$/);
  if (request.method === "POST" && executeMatch) {
    writeJson(response, 200, await service.executeApprovedOperation({
      operationId: decodeURIComponent(executeMatch[1]!)
    }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/agent/turn") {
    const body = await readJson(request);
    if (!body.ok) {
      writeJson(response, 400, { status: "error", message: body.message });
      return;
    }
    writeJson(response, 200, await service.runAgentTurn(body.value));
    return;
  }

  writeJson(response, 404, { status: "error", message: "Route not found" });
}

async function readJson(request: http.IncomingMessage): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string }
> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, message: "Request body must be a JSON object." };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, message: "Invalid JSON body." };
  }
}

function writeJson(response: http.ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "http://localhost:5173",
    "access-control-allow-headers": "content-type"
  });
  response.end(JSON.stringify(value));
}
```

- [ ] **Step 4: Add API dev server**

Create `harness/src/server/dev-server.ts`:

```ts
import { startConfereLocalApi } from "./local-api.js";

const server = await startConfereLocalApi({ port: 3737 });

console.log(`Confere local API: ${server.url}`);
console.log("Press Ctrl+C to stop.");
```

- [ ] **Step 5: Run HTTP API tests**

Run:

```powershell
cd harness
npm test -- tests/server/local-api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run focused backend test suite**

Run:

```powershell
cd harness
npm test -- tests/server tests/core/operation-summary.test.ts tests/core/harness-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit local API**

Run:

```powershell
git add harness/src/server/local-api.ts harness/src/server/dev-server.ts harness/tests/server/local-api.test.ts
git commit -m "feat: expose confere local api"
```

Expected: commit contains HTTP API only.

## Task 7: Electron Shell and Preload Bridge

**Files:**
- Create: `harness/src/desktop/main.ts`
- Create: `harness/src/desktop/preload.ts`
- Create: `harness/src/desktop/types.d.ts`
- Modify: `harness/tsconfig.json`

- [ ] **Step 1: Add renderer global type declarations**

Create `harness/src/desktop/types.d.ts`:

```ts
export {};

declare global {
  interface Window {
    confere: {
      getApiBaseUrl(): Promise<string>;
      openExternal(url: string): Promise<void>;
      openPath(path: string): Promise<void>;
    };
  }
}
```

- [ ] **Step 2: Add preload bridge**

Create `harness/src/desktop/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("confere", {
  getApiBaseUrl: () => ipcRenderer.invoke("confere:get-api-base-url"),
  openExternal: (url: string) => ipcRenderer.invoke("confere:open-external", url),
  openPath: (filePath: string) => ipcRenderer.invoke("confere:open-path", filePath)
});
```

- [ ] **Step 3: Add Electron main process**

Create `harness/src/desktop/main.ts`:

```ts
import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";

import { startConfereLocalApi, type ConfereLocalApi } from "../server/local-api.js";

let mainWindow: BrowserWindow | undefined;
let localApi: ConfereLocalApi | undefined;

async function createWindow(): Promise<void> {
  localApi = await startConfereLocalApi();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    title: "Confere",
    backgroundColor: "#f7f8fb",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

ipcMain.handle("confere:get-api-base-url", () => {
  if (!localApi) throw new Error("Confere local API is not running.");
  return localApi.url;
});

ipcMain.handle("confere:open-external", async (_event, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle("confere:open-path", async (_event, filePath: string) => {
  await shell.openPath(filePath);
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await localApi?.close();
});
```

- [ ] **Step 4: Include desktop types in TypeScript**

In `harness/tsconfig.json`, make sure `compilerOptions` includes JSX support:

```json
"jsx": "react-jsx"
```

Also make sure `include` contains UI and desktop files:

```json
"include": [
  "src/**/*.ts",
  "src/**/*.tsx",
  "tests/**/*.ts",
  "tests/**/*.tsx",
  "scripts/**/*.ts",
  "electron.vite.config.ts",
  "vitest.config.ts",
  "vitest.ui.config.ts"
]
```

- [ ] **Step 5: Run typecheck**

Run:

```powershell
cd harness
npm run typecheck
```

Expected: it may fail because UI entry files do not exist yet. It must not fail inside `src/desktop/**`.

- [ ] **Step 6: Commit Electron shell**

Run:

```powershell
git add harness/src/desktop harness/tsconfig.json
git commit -m "feat: add confere electron shell"
```

Expected: commit contains Electron main/preload/type declarations.

## Task 8: React UI Foundation

**Files:**
- Create: `harness/src/ui/main.tsx`
- Create: `harness/src/ui/App.tsx`
- Create: `harness/src/ui/api.ts`
- Create: `harness/src/ui/types.ts`
- Create: `harness/src/ui/styles.css`
- Create: `harness/src/ui/components/AppShell.tsx`
- Create: `harness/src/ui/components/StatusPill.tsx`
- Create: `harness/src/ui/components/ActionButton.tsx`
- Create: `harness/vitest.ui.config.ts`
- Test: `harness/tests/ui/confere-ui.test.tsx`

- [ ] **Step 1: Add UI test config**

Create `harness/vitest.ui.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: false,
    environment: "jsdom",
    setupFiles: ["tests/setup/no-live-network.ts"]
  }
});
```

- [ ] **Step 2: Write failing UI shell test**

Create `harness/tests/ui/confere-ui.test.tsx`:

```tsx
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../../src/ui/App.js";

describe("Confere UI", () => {
  it("renders the product shell and module navigation", () => {
    const html = renderToString(<App />);

    expect(html).toContain("Confere");
    expect(html).toContain("Conta Azul");
    expect(html).toContain("Asaas");
    expect(html).toContain("Operações");
    expect(html).toContain("Sessões");
  });
});
```

- [ ] **Step 3: Run failing UI test**

Run:

```powershell
cd harness
npm run test:ui -- tests/ui/confere-ui.test.tsx
```

Expected: FAIL because `src/ui/App.tsx` does not exist.

- [ ] **Step 4: Add UI API client**

Create `harness/src/ui/types.ts`:

```ts
export type ScreenId = "home" | "contaazul" | "asaas" | "operacoes" | "sessoes";
```

Create `harness/src/ui/api.ts`:

```ts
import type {
  AgentTurnApiRequest,
  AgentTurnApiResponse,
  ConfereStatus,
  ExecuteOperationApiResponse,
  OperationListApiResponse,
  OperationSummaryApiResponse
} from "../server/api-types.js";

let cachedBaseUrl: string | undefined;

export async function getApiBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  cachedBaseUrl = window.confere
    ? await window.confere.getApiBaseUrl()
    : "http://127.0.0.1:3737";
  return cachedBaseUrl;
}

export async function getStatus(): Promise<ConfereStatus> {
  return getJson("/api/status");
}

export async function runAgentTurn(input: AgentTurnApiRequest): Promise<AgentTurnApiResponse> {
  return postJson("/api/agent/turn", input);
}

export async function executeOperation(operationId: string): Promise<ExecuteOperationApiResponse> {
  return postJson(`/api/operations/${encodeURIComponent(operationId)}/execute`, {});
}

export async function listOperations(): Promise<OperationListApiResponse> {
  return getJson("/api/operations?limit=50");
}

export async function getOperation(operationId: string): Promise<OperationSummaryApiResponse> {
  return getJson(`/api/operations/${encodeURIComponent(operationId)}`);
}

async function getJson<T>(path: string): Promise<T> {
  const baseUrl = await getApiBaseUrl();
  const response = await fetch(`${baseUrl}${path}`);
  return parseResponse<T>(response);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = await getApiBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseResponse<T>(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T;
  if (!response.ok) {
    throw new Error(JSON.stringify(body));
  }
  return body;
}
```

- [ ] **Step 5: Add shell components**

Create `harness/src/ui/components/StatusPill.tsx`:

```tsx
import type { ReactNode } from "react";

export function StatusPill(props: {
  tone: "neutral" | "good" | "warn" | "danger";
  children: ReactNode;
}): JSX.Element {
  return <span className={`status-pill status-pill--${props.tone}`}>{props.children}</span>;
}
```

Create `harness/src/ui/components/ActionButton.tsx`:

```tsx
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function ActionButton(props: {
  icon?: LucideIcon;
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  onClick?: () => void;
}): JSX.Element {
  const Icon = props.icon;
  return (
    <button
      className={`action-button action-button--${props.variant ?? "secondary"}`}
      disabled={props.disabled}
      onClick={props.onClick}
      type="button"
    >
      {Icon ? <Icon aria-hidden="true" size={16} /> : null}
      <span>{props.children}</span>
    </button>
  );
}
```

Create `harness/src/ui/components/AppShell.tsx`:

```tsx
import { Building2, ClipboardList, Home, Landmark, RadioTower } from "lucide-react";
import type { ReactNode } from "react";
import type { ScreenId } from "../types.js";

const NAV_ITEMS: Array<{ id: ScreenId; label: string; icon: typeof Home }> = [
  { id: "home", label: "Início", icon: Home },
  { id: "contaazul", label: "Conta Azul", icon: Building2 },
  { id: "asaas", label: "Asaas", icon: Landmark },
  { id: "operacoes", label: "Operações", icon: ClipboardList },
  { id: "sessoes", label: "Sessões", icon: RadioTower }
];

export function AppShell(props: {
  activeScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">C</div>
          <div>
            <strong>Confere</strong>
            <span>Finance OS local</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${props.activeScreen === item.id ? "nav-item--active" : ""}`}
                key={item.id}
                onClick={() => props.onNavigate(item.id)}
                type="button"
              >
                <Icon aria-hidden="true" size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="main-surface">{props.children}</main>
    </div>
  );
}
```

- [ ] **Step 6: Add app shell and styles**

Create `harness/src/ui/App.tsx`:

```tsx
import { useState } from "react";

import { AppShell } from "./components/AppShell.js";
import type { ScreenId } from "./types.js";

export function App(): JSX.Element {
  const [screen, setScreen] = useState<ScreenId>("home");

  return (
    <AppShell activeScreen={screen} onNavigate={setScreen}>
      <section className="screen">
        <p className="eyebrow">Confere</p>
        <h1>{titleForScreen(screen)}</h1>
        <p className="screen-lead">
          Operação local com agente em dry-run, aprovação humana e histórico auditável.
        </p>
      </section>
    </AppShell>
  );
}

function titleForScreen(screen: ScreenId): string {
  const titles: Record<ScreenId, string> = {
    home: "Início",
    contaazul: "Conta Azul",
    asaas: "Asaas",
    operacoes: "Operações",
    sessoes: "Sessões"
  };
  return titles[screen];
}
```

Create `harness/src/ui/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

Create `harness/src/ui/styles.css` with this initial Finance OS claro base:

```css
:root {
  color: #18202f;
  background: #f6f7f9;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
  text-rendering: geometricPrecision;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 1024px;
  min-height: 100vh;
}

button,
input,
textarea {
  font: inherit;
}

.app-shell {
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  border-right: 1px solid #dce1e8;
  background: #ffffff;
  padding: 20px 16px;
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
}

.brand-mark {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 8px;
  background: #123c69;
  color: #ffffff;
  font-weight: 700;
}

.brand-block span {
  display: block;
  color: #697386;
  font-size: 12px;
  margin-top: 2px;
}

.nav-list {
  display: grid;
  gap: 6px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 42px;
  border: 0;
  border-radius: 8px;
  color: #334155;
  background: transparent;
  padding: 0 12px;
  text-align: left;
  cursor: pointer;
}

.nav-item:hover,
.nav-item--active {
  background: #e9eef5;
  color: #123c69;
}

.main-surface {
  min-width: 0;
  padding: 24px;
}

.screen {
  max-width: 1180px;
}

.eyebrow {
  color: #5f6f89;
  font-size: 13px;
  font-weight: 700;
  margin: 0 0 8px;
  text-transform: uppercase;
}

h1 {
  font-size: 32px;
  line-height: 1.2;
  margin: 0 0 8px;
}

.screen-lead {
  color: #5d6878;
  margin: 0;
}

.status-pill {
  border-radius: 999px;
  display: inline-flex;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  padding: 7px 10px;
}

.status-pill--neutral {
  background: #e9eef5;
  color: #334155;
}

.status-pill--good {
  background: #dff6e6;
  color: #166534;
}

.status-pill--warn {
  background: #fff1c7;
  color: #8a5a00;
}

.status-pill--danger {
  background: #ffe1e1;
  color: #a52828;
}

.action-button {
  align-items: center;
  border: 1px solid #cfd7e3;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  gap: 8px;
  min-height: 38px;
  padding: 0 14px;
}

.action-button:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.action-button--primary {
  background: #123c69;
  border-color: #123c69;
  color: #ffffff;
}

.action-button--secondary {
  background: #ffffff;
  color: #233044;
}

.action-button--danger {
  background: #a52828;
  border-color: #a52828;
  color: #ffffff;
}
```

- [ ] **Step 7: Run UI shell test**

Run:

```powershell
cd harness
npm run test:ui -- tests/ui/confere-ui.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit UI foundation**

Run:

```powershell
git add harness/src/ui harness/vitest.ui.config.ts harness/tests/ui/confere-ui.test.tsx
git commit -m "feat: add confere ui shell"
```

Expected: commit contains UI foundation.

## Task 9: Home and Session Screens

**Files:**
- Create: `harness/src/ui/screens/HomeScreen.tsx`
- Create: `harness/src/ui/screens/SessionsScreen.tsx`
- Modify: `harness/src/ui/App.tsx`
- Modify: `harness/src/ui/styles.css`
- Test: `harness/tests/ui/confere-ui.test.tsx`

- [ ] **Step 1: Extend UI test for status screens**

Add this test to `harness/tests/ui/confere-ui.test.tsx`:

```tsx
it("renders home status language without secret values", () => {
  const html = renderToString(<App />);

  expect(html).toContain("Modo de operação");
  expect(html).toContain("Quota do modelo");
  expect(html).not.toContain("GEMINI_API_KEY");
});
```

- [ ] **Step 2: Add home screen**

Create `harness/src/ui/screens/HomeScreen.tsx`:

```tsx
import { ArrowRight, Building2, Landmark } from "lucide-react";

import { ActionButton } from "../components/ActionButton.js";
import { StatusPill } from "../components/StatusPill.js";
import type { ScreenId } from "../types.js";

export function HomeScreen(props: {
  onNavigate: (screen: ScreenId) => void;
}): JSX.Element {
  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <p className="eyebrow">Confere</p>
          <h1>Operações financeiras com aprovação humana</h1>
          <p className="screen-lead">
            Prepare cobranças e boletos em dry-run, revise o plano e execute apenas com confirmação.
          </p>
        </div>
        <StatusPill tone="warn">Dry-run primeiro</StatusPill>
      </div>

      <div className="module-grid">
        <button className="module-tile" onClick={() => props.onNavigate("contaazul")} type="button">
          <Building2 aria-hidden="true" size={24} />
          <strong>Conta Azul</strong>
          <span>Venda de serviço + boleto</span>
          <ArrowRight aria-hidden="true" size={18} />
        </button>
        <button className="module-tile" onClick={() => props.onNavigate("asaas")} type="button">
          <Landmark aria-hidden="true" size={24} />
          <strong>Asaas</strong>
          <span>Cobrança e boleto</span>
          <ArrowRight aria-hidden="true" size={18} />
        </button>
      </div>

      <div className="status-grid">
        <div className="metric-panel">
          <span>Modo de operação</span>
          <strong>Dry-run com handoff seguro</strong>
        </div>
        <div className="metric-panel">
          <span>Quota do modelo</span>
          <strong>Uso controlado local</strong>
        </div>
      </div>

      <ActionButton variant="secondary" onClick={() => props.onNavigate("operacoes")}>
        Ver operações
      </ActionButton>
    </section>
  );
}
```

- [ ] **Step 3: Add sessions screen**

Create `harness/src/ui/screens/SessionsScreen.tsx`:

```tsx
import { useEffect, useState } from "react";

import type { ConfereStatus } from "../../server/api-types.js";
import { getStatus } from "../api.js";
import { StatusPill } from "../components/StatusPill.js";

export function SessionsScreen(): JSX.Element {
  const [status, setStatus] = useState<ConfereStatus | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    void getStatus().then(setStatus).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Falha ao carregar status.");
    });
  }, []);

  return (
    <section className="screen">
      <p className="eyebrow">Sessões</p>
      <h1>Estado local</h1>
      <p className="screen-lead">Sessões e limites sem expor valores secretos.</p>
      {error ? <div className="notice notice--danger">{error}</div> : null}
      <div className="status-grid">
        <div className="metric-panel">
          <span>Conta Azul</span>
          <strong>{status?.sessions.contaazul ?? "carregando"}</strong>
        </div>
        <div className="metric-panel">
          <span>Asaas</span>
          <strong>{status?.sessions.asaas ?? "carregando"}</strong>
        </div>
        <div className="metric-panel">
          <span>Live</span>
          <strong>{status?.allowLiveMutations ? "habilitado" : "bloqueado"}</strong>
        </div>
        <div className="metric-panel">
          <span>Modelo</span>
          <strong>{status ? `${status.model.provider} · ${status.model.model}` : "carregando"}</strong>
        </div>
      </div>
      <div className="warning-list">
        {(status?.warnings ?? []).map((warning) => (
          <StatusPill key={warning} tone="warn">{warning}</StatusPill>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire screens into App**

Replace the temporary screen body in `harness/src/ui/App.tsx` with:

```tsx
import { useState } from "react";

import { AppShell } from "./components/AppShell.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { SessionsScreen } from "./screens/SessionsScreen.js";
import type { ScreenId } from "./types.js";

export function App(): JSX.Element {
  const [screen, setScreen] = useState<ScreenId>("home");

  return (
    <AppShell activeScreen={screen} onNavigate={setScreen}>
      {screen === "home" ? <HomeScreen onNavigate={setScreen} /> : null}
      {screen === "sessoes" ? <SessionsScreen /> : null}
      {screen === "contaazul" ? <Placeholder title="Conta Azul" /> : null}
      {screen === "asaas" ? <Placeholder title="Asaas" /> : null}
      {screen === "operacoes" ? <Placeholder title="Operações" /> : null}
    </AppShell>
  );
}

function Placeholder(props: { title: string }): JSX.Element {
  return (
    <section className="screen">
      <p className="eyebrow">Confere</p>
      <h1>{props.title}</h1>
      <p className="screen-lead">Fluxo operacional em preparação.</p>
    </section>
  );
}
```

- [ ] **Step 5: Extend styles for status panels**

Append to `harness/src/ui/styles.css`:

```css
.screen-header {
  align-items: flex-start;
  display: flex;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
}

.module-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(280px, 1fr));
  gap: 14px;
  margin: 24px 0;
}

.module-tile {
  align-items: center;
  background: #ffffff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
  color: #18202f;
  cursor: pointer;
  display: grid;
  gap: 8px;
  grid-template-columns: 32px minmax(0, 1fr) 24px;
  min-height: 96px;
  padding: 18px;
  text-align: left;
}

.module-tile strong,
.module-tile span {
  grid-column: 2;
}

.module-tile span {
  color: #607086;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(180px, 1fr));
  gap: 12px;
  margin: 20px 0;
}

.metric-panel {
  background: #ffffff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
  padding: 14px;
}

.metric-panel span {
  color: #607086;
  display: block;
  font-size: 12px;
  margin-bottom: 8px;
}

.metric-panel strong {
  color: #18202f;
  font-size: 14px;
}

.notice {
  border-radius: 8px;
  margin: 18px 0;
  padding: 12px 14px;
}

.notice--danger {
  background: #ffe1e1;
  color: #8a1f1f;
}

.warning-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
```

- [ ] **Step 6: Run UI tests**

Run:

```powershell
cd harness
npm run test:ui -- tests/ui/confere-ui.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit home/session screens**

Run:

```powershell
git add harness/src/ui harness/tests/ui/confere-ui.test.tsx
git commit -m "feat: add confere home and session screens"
```

Expected: commit contains home/session UI only.

## Task 10: Workflow Screens with Conversational Dry-Run and Approval

**Files:**
- Create: `harness/src/ui/screens/WorkflowScreen.tsx`
- Create: `harness/src/ui/components/OperationSummaryPanel.tsx`
- Modify: `harness/src/ui/App.tsx`
- Modify: `harness/src/ui/styles.css`
- Test: `harness/tests/ui/confere-ui.test.tsx`

- [ ] **Step 1: Add UI test for contextual action language**

Add this test:

```tsx
it("renders workflow action language", () => {
  const html = renderToString(<App />);

  expect(html).toContain("Conta Azul");
  expect(html).toContain("Asaas");
});
```

This test stays broad because detailed workflow behavior depends on browser interaction. Backend tests cover the approval handoff contract.

- [ ] **Step 2: Add operation summary panel**

Create `harness/src/ui/components/OperationSummaryPanel.tsx`:

```tsx
import type { OperationSummary } from "../../core/operation-summary.js";
import { ActionButton } from "./ActionButton.js";

export function OperationSummaryPanel(props: {
  operation?: OperationSummary;
  draftOperationId?: string;
  onExecute?: () => void;
  executing?: boolean;
}): JSX.Element {
  if (!props.operation && !props.draftOperationId) {
    return (
      <aside className="summary-panel">
        <h2>Plano</h2>
        <p>Prepare uma operação para ver o resumo antes da execução.</p>
      </aside>
    );
  }

  return (
    <aside className="summary-panel">
      <h2>Plano</h2>
      <dl className="summary-list">
        <div>
          <dt>Operação</dt>
          <dd>{props.operation?.operationId ?? props.draftOperationId}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{props.operation?.latestStatus ?? "planned"}</dd>
        </div>
        {props.operation?.customerName ? (
          <div>
            <dt>Cliente</dt>
            <dd>{props.operation.customerName}</dd>
          </div>
        ) : null}
        {props.operation?.unitValue ? (
          <div>
            <dt>Valor</dt>
            <dd>{props.operation.unitValue}</dd>
          </div>
        ) : null}
        {props.operation?.dueDateIso ? (
          <div>
            <dt>Vencimento</dt>
            <dd>{props.operation.dueDateIso}</dd>
          </div>
        ) : null}
      </dl>
      <ActionButton
        disabled={!props.draftOperationId || props.executing}
        onClick={props.onExecute}
        variant="primary"
      >
        Aprovar execução real
      </ActionButton>
    </aside>
  );
}
```

- [ ] **Step 3: Add shared workflow screen**

Create `harness/src/ui/screens/WorkflowScreen.tsx`:

```tsx
import { Send } from "lucide-react";
import { useState } from "react";

import type { OperationSummary } from "../../core/operation-summary.js";
import type { AgentTurnApiResponse } from "../../server/api-types.js";
import { executeOperation, getOperation, runAgentTurn } from "../api.js";
import { ActionButton } from "../components/ActionButton.js";
import { OperationSummaryPanel } from "../components/OperationSummaryPanel.js";

export function WorkflowScreen(props: {
  module: "contaazul" | "asaas";
  title: string;
  description: string;
}): JSX.Element {
  const [request, setRequest] = useState("");
  const [sessionId] = useState(() => `confere_${props.module}_${Date.now()}`);
  const [response, setResponse] = useState<AgentTurnApiResponse | undefined>();
  const [operation, setOperation] = useState<OperationSummary | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function prepare(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const result = await runAgentTurn({
        request,
        module: props.module,
        sessionId
      });
      setResponse(result);
      if (result.draftOperationId) {
        const summary = await getOperation(result.draftOperationId);
        setOperation(summary.operation);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao preparar operação.");
    } finally {
      setBusy(false);
    }
  }

  async function approve(): Promise<void> {
    if (!response?.draftOperationId) return;
    setBusy(true);
    setError(undefined);
    try {
      const executed = await executeOperation(response.draftOperationId);
      if (executed.status === "blocked") {
        setError(executed.reason);
        return;
      }
      if (executed.summary) setOperation(executed.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao executar operação.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workflow-layout">
      <div className="workflow-main">
        <p className="eyebrow">Confere</p>
        <h1>{props.title}</h1>
        <p className="screen-lead">{props.description}</p>
        <div className="chat-panel">
          <textarea
            aria-label="Pedido operacional"
            onChange={(event) => setRequest(event.target.value)}
            value={request}
          />
          <ActionButton disabled={!request.trim() || busy} icon={Send} onClick={prepare} variant="primary">
            Preparar operação
          </ActionButton>
        </div>
        {error ? <div className="notice notice--danger">{error}</div> : null}
        {response ? (
          <div className="agent-output">
            <strong>Status do agente: {response.result.status}</strong>
            <pre>{JSON.stringify(response.result, null, 2)}</pre>
          </div>
        ) : null}
      </div>
      <OperationSummaryPanel
        draftOperationId={response?.draftOperationId}
        executing={busy}
        operation={operation}
        onExecute={approve}
      />
    </section>
  );
}
```

- [ ] **Step 4: Wire workflow screens**

In `harness/src/ui/App.tsx`, import:

```tsx
import { WorkflowScreen } from "./screens/WorkflowScreen.js";
```

Replace the temporary Conta Azul and Asaas screen branches:

```tsx
{screen === "contaazul" ? (
  <WorkflowScreen
    module="contaazul"
    title="Conta Azul"
    description="Prepare venda de serviço com boleto pelo fluxo mapeado."
  />
) : null}
{screen === "asaas" ? (
  <WorkflowScreen
    module="asaas"
    title="Asaas"
    description="Prepare cobrança e boleto pelo fluxo mapeado."
  />
) : null}
```

- [ ] **Step 5: Add workflow styles**

Append to `harness/src/ui/styles.css`:

```css
.workflow-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 18px;
  max-width: 1240px;
}

.workflow-main {
  min-width: 0;
}

.chat-panel {
  background: #ffffff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
  display: grid;
  gap: 12px;
  margin-top: 22px;
  padding: 14px;
}

.chat-panel textarea {
  border: 1px solid #cfd7e3;
  border-radius: 8px;
  min-height: 126px;
  padding: 12px;
  resize: vertical;
}

.agent-output {
  background: #ffffff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
  margin-top: 14px;
  padding: 14px;
}

.agent-output pre {
  background: #f1f4f8;
  border-radius: 8px;
  color: #273244;
  margin: 12px 0 0;
  max-height: 320px;
  overflow: auto;
  padding: 12px;
  white-space: pre-wrap;
}

.summary-panel {
  align-self: start;
  background: #ffffff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
  padding: 16px;
}

.summary-panel h2 {
  font-size: 18px;
  margin: 0 0 12px;
}

.summary-list {
  display: grid;
  gap: 10px;
  margin: 0 0 16px;
}

.summary-list div {
  border-bottom: 1px solid #eef2f7;
  padding-bottom: 8px;
}

.summary-list dt {
  color: #607086;
  font-size: 12px;
}

.summary-list dd {
  margin: 3px 0 0;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 6: Run UI tests**

Run:

```powershell
cd harness
npm run test:ui -- tests/ui/confere-ui.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit workflow screens**

Run:

```powershell
git add harness/src/ui harness/tests/ui/confere-ui.test.tsx
git commit -m "feat: add confere workflow screens"
```

Expected: commit contains workflow UI only.

## Task 11: Operations Screen

**Files:**
- Create: `harness/src/ui/screens/OperationsScreen.tsx`
- Modify: `harness/src/ui/App.tsx`
- Modify: `harness/src/ui/styles.css`
- Test: `harness/tests/ui/confere-ui.test.tsx`

- [ ] **Step 1: Add operations render test**

Add this test:

```tsx
it("renders operations navigation language", () => {
  const html = renderToString(<App />);

  expect(html).toContain("Operações");
});
```

- [ ] **Step 2: Add operations screen**

Create `harness/src/ui/screens/OperationsScreen.tsx`:

```tsx
import { ExternalLink, FileText, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";

import type { OperationSummary } from "../../core/operation-summary.js";
import { listOperations } from "../api.js";
import { ActionButton } from "../components/ActionButton.js";
import { OperationSummaryPanel } from "../components/OperationSummaryPanel.js";
import { StatusPill } from "../components/StatusPill.js";

export function OperationsScreen(): JSX.Element {
  const [operations, setOperations] = useState<OperationSummary[]>([]);
  const [selected, setSelected] = useState<OperationSummary | undefined>();
  const [error, setError] = useState<string | undefined>();

  async function refresh(): Promise<void> {
    try {
      const response = await listOperations();
      setOperations(response.operations);
      setSelected(response.operations[0]);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao listar operações.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="workflow-layout">
      <div className="workflow-main">
        <div className="screen-header">
          <div>
            <p className="eyebrow">Operações</p>
            <h1>Histórico auditável</h1>
            <p className="screen-lead">Ledger redigido com resumo por operação.</p>
          </div>
          <ActionButton icon={RefreshCcw} onClick={() => void refresh()}>Atualizar</ActionButton>
        </div>
        {error ? <div className="notice notice--danger">{error}</div> : null}
        <div className="operations-table">
          {operations.map((operation) => (
            <button
              className="operation-row"
              key={operation.operationId}
              onClick={() => setSelected(operation)}
              type="button"
            >
              <span>{operation.operationId}</span>
              <StatusPill tone={toneForStatus(operation.latestStatus)}>{operation.latestStatus ?? "unknown"}</StatusPill>
              <span>{operation.customerName ?? operation.toolName ?? "sem resumo"}</span>
              <span>{operation.latestTimestamp ?? ""}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <OperationSummaryPanel operation={selected} />
        <div className="artifact-actions">
          {(selected?.artifacts ?? []).map((artifact) => (
            <ActionButton
              icon={artifact.kind === "pdf" ? FileText : ExternalLink}
              key={`${artifact.label}-${artifact.path}`}
              onClick={() => void window.confere?.openPath(artifact.path)}
            >
              {artifact.label}
            </ActionButton>
          ))}
        </div>
      </div>
    </section>
  );
}

function toneForStatus(status: OperationSummary["latestStatus"]): "neutral" | "good" | "warn" | "danger" {
  if (status === "succeeded") return "good";
  if (status === "failed" || status === "blocked") return "danger";
  if (status === "planned" || status === "approved" || status === "running") return "warn";
  return "neutral";
}
```

- [ ] **Step 3: Wire operations screen**

In `harness/src/ui/App.tsx`, import:

```tsx
import { OperationsScreen } from "./screens/OperationsScreen.js";
```

Replace the temporary operations screen branch:

```tsx
{screen === "operacoes" ? <OperationsScreen /> : null}
```

- [ ] **Step 4: Add operations styles**

Append:

```css
.operations-table {
  background: #ffffff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
  display: grid;
  overflow: hidden;
}

.operation-row {
  align-items: center;
  background: #ffffff;
  border: 0;
  border-bottom: 1px solid #eef2f7;
  color: #233044;
  cursor: pointer;
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(220px, 1.2fr) 110px minmax(180px, 1fr) 190px;
  min-height: 50px;
  padding: 0 12px;
  text-align: left;
}

.operation-row:hover {
  background: #f6f8fb;
}

.artifact-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
```

- [ ] **Step 5: Run UI tests**

Run:

```powershell
cd harness
npm run test:ui -- tests/ui/confere-ui.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit operations screen**

Run:

```powershell
git add harness/src/ui harness/tests/ui/confere-ui.test.tsx
git commit -m "feat: add confere operations screen"
```

Expected: commit contains operations UI only.

## Task 12: Backend and UI Safety Gates

**Files:**
- Modify: `harness/tests/server/confere-service.test.ts`
- Modify: `harness/src/server/confere-service.ts`
- Modify: `harness/tests/ui/confere-ui.test.tsx`

- [ ] **Step 1: Add service tests for blocked execution**

Append to `harness/tests/server/confere-service.test.ts`:

```ts
it("blocks live execution when no draft exists", async () => {
  const service = await createConfereService({
    cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
    env: { ALLOW_LIVE_MUTATIONS: "true" },
    registryFactory: async () => ({ registry: createToolRegistry(), warnings: [] }),
    modelProvider: createFakeModelProvider({})
  });

  const response = await service.executeApprovedOperation({ operationId: "missing" });

  expect(response).toEqual({
    status: "blocked",
    reason: "No active dry-run draft found for operation: missing"
  });
});

it("keeps a draft when live mutations are disabled", async () => {
  const service = await createConfereService({
    cwd: await mkdtemp(path.join(os.tmpdir(), "confere-service-")),
    env: { ALLOW_LIVE_MUTATIONS: "false" },
    registryFactory: async () => ({ registry: createToolRegistry(), warnings: [] }),
    modelProvider: createFakeModelProvider({})
  });
  service.saveDraftForTest({
    operationId: "op_guard",
    toolName: "asaas.create_boleto_charge_workflow",
    request: "criar boleto",
    params: { customerName: "Cliente" },
    createdAt: "2026-06-20T12:00:00.000Z"
  });

  const response = await service.executeApprovedOperation({ operationId: "op_guard" });

  expect(response.status).toBe("blocked");
  expect(service.getDraft("op_guard")).toMatchObject({ operationId: "op_guard" });
});
```

- [ ] **Step 2: Run service safety tests**

Run:

```powershell
cd harness
npm test -- tests/server/confere-service.test.ts
```

Expected: PASS. If the second test fails, update `executeApprovedOperation()` so it saves the consumed draft back before returning the live-disabled block.

- [ ] **Step 3: Add UI safety copy test**

Add to `harness/tests/ui/confere-ui.test.tsx`:

```tsx
it("renders approval as a human gated action", () => {
  const html = renderToString(<App />);

  expect(html).toContain("aprovação humana");
});
```

- [ ] **Step 4: Run UI safety test**

Run:

```powershell
cd harness
npm run test:ui -- tests/ui/confere-ui.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit safety gates**

Run:

```powershell
git add harness/src/server/confere-service.ts harness/tests/server/confere-service.test.ts harness/tests/ui/confere-ui.test.tsx
git commit -m "test: cover confere approval safety gates"
```

Expected: commit contains safety tests and any minimal service fix.

## Task 13: Full Verification and Runbook

**Files:**
- Modify: `harness/docs/runbook.md`

- [ ] **Step 1: Add Confere desktop runbook**

Append to `harness/docs/runbook.md`:

```md
## Confere Desktop MVP

Confere is the local desktop product layer over the harness.

Run local API only:

```powershell
cd harness
npm run server:dev
```

Run desktop app:

```powershell
cd harness
npm run desktop:dev
```

Demo flow:

1. Open Confere.
2. Confirm session status in Sessões.
3. Open Conta Azul or Asaas.
4. Enter a controlled request with known demo data.
5. Click Preparar operação.
6. Review the dry-run result and generated operation id.
7. Enable live execution only for the controlled demo environment.
8. Click Aprovar execução real.
9. Open Operações and verify the resulting summary, PDF, link, warnings, and idempotency state.

Safety rules:

- The UI must never ask the model to call low-level tools.
- Live execution must come from an active dry-run draft.
- The approval button maps internally to `APROVAR <operationId>`.
- Do not reconstruct live params from the redacted ledger.
- Do not expose provider secrets in the UI.
- Do not use official APIs, official webhooks, or official MCPs from Asaas or Conta Azul.
```

Do not include real customer PII, tokens, cookies, or copied `.env` values in the runbook.

- [ ] **Step 2: Run complete backend tests**

Run:

```powershell
cd harness
npm test
```

Expected: PASS.

- [ ] **Step 3: Run UI tests**

Run:

```powershell
cd harness
npm run test:ui
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```powershell
cd harness
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Build desktop app**

Run:

```powershell
cd harness
npm run desktop:build
```

Expected: build exits with code 0 and writes Electron/Vite output under ignored build directories.

- [ ] **Step 6: Run desktop smoke**

Run:

```powershell
cd harness
npm run desktop:dev
```

Expected:

- Confere window opens.
- Sidebar shows Início, Conta Azul, Asaas, Operações, Sessões.
- Sessões screen loads without showing secret values.
- Conta Azul and Asaas screens accept text and call the local API.
- Live approval button is disabled until a draft operation exists.

- [ ] **Step 7: Controlled provider demo smoke**

With real sessions available and live mutations intentionally enabled only for the demo:

```powershell
cd harness
npm run desktop:dev
```

Expected:

- Conta Azul controlled service-sale + boleto flow can prepare dry-run.
- The approval button triggers the same `APROVAR <operationId>` semantics.
- Operations screen shows the resulting sale/boleto summary.
- Asaas controlled boleto flow can prepare dry-run.
- If live Asaas is tested, the resulting operation appears in the Operations screen.

If a provider session is expired, stop the live smoke and recapture the mapped session. Do not switch to official provider APIs.

- [ ] **Step 8: Check repo hygiene**

Run:

```powershell
git status --short
rg -n -i "claude|opus|anthropic|generated with|co-authored" harness docs
rg -n "GEMINI_API_KEY\\s*=\\s*[^.]|GOOGLE_API_KEY\\s*=\\s*[^.]|AIza[0-9A-Za-z_-]+|AQ\\." harness docs --glob "!**/*.pdf"
```

Expected:

- `git status --short` shows only intended source/doc changes.
- Both `rg` checks return no matches.

- [ ] **Step 9: Commit runbook and verification**

Run:

```powershell
git add harness/docs/runbook.md
git commit -m "docs: add confere desktop runbook"
```

Expected: commit contains runbook update only.

## Final Verification Before Handoff

Run:

```powershell
cd harness
npm test
npm run test:ui
npm run typecheck
npm run desktop:build
```

Expected: all commands pass.

Then run:

```powershell
git log --oneline -8
git status --short
```

Expected:

- Recent commits show the Confere implementation broken into focused commits.
- Working tree is clean except intentionally ignored local artifacts.

## Spec Coverage Review

- Product name: Task 1 and UI text use Confere.
- Electron desktop app: Tasks 1, 7, and 13.
- Local harness API: Tasks 5 and 6.
- Workflow-only model exposure: existing safe registry remains in `agent-runner`; Task 5 uses `runAgentTurn()` and stores only planned workflow params.
- Conversational dry-run: Task 10.
- Contextual live approval: Tasks 4, 5, 10, and 12.
- Operation history: Tasks 3 and 11.
- Session/quota status: Tasks 5 and 9.
- Privacy: Tasks 5, 9, 12, and 13 avoid secret output and avoid reconstructing from ledger.
- Provider boundary: Tasks 2 and 13 preserve mapped-session-only behavior.
