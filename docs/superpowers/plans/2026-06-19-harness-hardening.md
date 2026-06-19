# Harness Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 9 concrete security/correctness/robustness gaps in the Kamilly billing harness so an AI agent can later operate it safely on a user's behalf, without changing the mapped-session integration boundary.

**Architecture:** Surgical hardening of existing `harness/src/core` and `harness/src/modules/contaazul` code plus a root-level secret-leak guard. Every behavior change is driven by a failing test first (TDD). No new provider integrations, no official APIs, no LLM wiring — that comes in a later plan.

**Tech Stack:** Node.js, TypeScript, Zod, Vitest. All `npm`/`npx` commands run from `C:\Kamilly\harness`. All `git` commands run from `C:\Kamilly`.

---

## Context For The Executor

The harness lives in `C:\Kamilly\harness` and is a TypeScript project (`type: module`, ESM, `.js` import suffixes required). Tests live under `harness/tests`, mirror `src` paths, and use Vitest. A global setup at `harness/tests/setup/no-live-network.ts` blocks live network — never bypass it.

The repository root `C:\Kamilly` also contains exploratory JavaScript scripts and **real secrets** (`.env`, `contaazul/.env`, `state.json`, `contaazul/state.json`), real customer boleto PDFs, captured API logs with cookies, and large `.mp4` screen recordings. The root currently has **no `.gitignore`** and the `.git` directory is empty/non-functional. Task 0 fixes that before anything else.

Run the full suite (`npm run test`) and `npm run typecheck` after every task. The baseline before this plan is **74 tests passing in 17 files**.

## File Structure

| File | Responsibility | Tasks |
| --- | --- | --- |
| `.gitignore` (root, create) | Stop secrets/artifacts/videos from ever being committed | 0 |
| `harness/src/core/redaction.ts` (modify) | Preserve audit identifiers; stop greedy regexes corrupting them | 1 |
| `harness/tests/core/redaction.test.ts` (modify) | Lock identifier-preservation + tightened-regex behavior | 1 |
| `harness/src/core/approval.ts` (modify) | Trim approval text before exact match | 2 |
| `harness/tests/core/approval.test.ts` (modify) | Lock trimming behavior | 2 |
| `harness/src/core/config.ts` (modify) | Remove real PII/account defaults; env-only | 3 |
| `harness/tests/core/config.test.ts` (modify) | Expect fail-closed empty defaults | 3 |
| `harness/src/modules/contaazul/tools.ts` (modify) | Config guard, session pre-check, partial-failure handling, dead-code removal | 3, 5, 6, 7 |
| `harness/tests/modules/contaazul/tools.test.ts` (modify) | Lock guard + session-expiry + partial-failure behavior | 3, 6, 7 |
| `harness/src/modules/contaazul/client.ts` (modify) | Optional `verifyProSession` capability | 6 |
| `harness/src/agent/orchestrator.ts` (modify) | Deterministic route priority for colliding routes | 4 |
| `harness/tests/agent/orchestrator.test.ts` (modify) | Lock collision tie-break | 4 |

---

## Task 0: Establish Git Baseline And Root Secret Guard (item 1)

**Files:**
- Create: `C:\Kamilly\.gitignore`

- [ ] **Step 1: Confirm git is currently non-functional**

Run (from `C:\Kamilly`): `git status`
Expected: `fatal: not a git repository (or any of the parent directories): .git` (the `.git` folder is empty). If instead `git status` works and lists tracked files, skip Step 3 and only do Steps 2, 4-6.

- [ ] **Step 2: Create the root `.gitignore`**

Create `C:\Kamilly\.gitignore` with exactly this content:

```gitignore
# Secrets / sessions — never commit
.env
*.env
state.json
**/state.json

# Operational data & generated artifacts
artifacts/
downloads/
**/downloads/
*.pdf
*.png

# Capture/debug logs (may contain cookies/tokens)
captured_*.json
*_network_log*.txt
*_network_logs.json
live_network_log.txt
clientes_export.json
clientes_cache.json

# Screen recordings
*.mp4

# Dependencies / build
node_modules/
dist/
coverage/

# Keep the hardened harness ignore rules in harness/.gitignore as well
```

- [ ] **Step 3: Initialize the repository (only if Step 1 showed "not a git repository")**

Run (from `C:\Kamilly`):
```bash
git init
git status --porcelain | grep -iE '(^|/)(\.env|state\.json)' && echo "LEAK" || echo "clean"
```
Expected: prints `clean`. If it prints `LEAK`, STOP — a secret is not being ignored; fix `.gitignore` before continuing. Do not run `git add` until this prints `clean`.

- [ ] **Step 4: Verify no secret/large file is staged**

Run (from `C:\Kamilly`):
```bash
git add -A
git ls-files | grep -iE '\.env$|state\.json$|\.mp4$|\.pdf$|captured_|clientes_export'
```
Expected: **no output** (empty). If any line prints, run `git reset`, fix `.gitignore`, and repeat.

- [ ] **Step 5: Create the baseline commit**

Run (from `C:\Kamilly`):
```bash
git commit -m "chore: add root .gitignore and establish baseline

```
Expected: commit succeeds; the working tree no longer reports `.env`/`state.json`/`.mp4` as tracked.

- [ ] **Step 6: Confirm the harness suite still passes from the new baseline**

Run (from `C:\Kamilly\harness`): `npm run test`
Expected: `Test Files 17 passed (17)`, `Tests 74 passed (74)`.

---

## Task 1: Harden Redaction — Preserve Audit Identifiers (item 2)

The ledger redactor corrupts `operationId`/`approvalText` because the phone regex matches the numeric timestamp inside them, and it under-redacts (formatted CPF/CNPJ value-matching is too loose). Tighten value regexes to require their separators and preserve identifier keys verbatim.

**Files:**
- Modify: `harness/src/core/redaction.ts`
- Modify: `harness/tests/core/redaction.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these two tests inside the `describe("redaction", ...)` block in `harness/tests/core/redaction.test.ts` (before the closing `});`):

```ts
  it("preserves audit identifiers containing long numeric runs", () => {
    const redacted = redact({
      operationId: "op_controlled_contaazul_sale_20260619201113142",
      approvalText: "APROVAR op_contaazul_sale_1781903486089_6092b931",
      idempotencyKey: "contaazul-sale-boleto:8614c01bfda7d75296250df7fa29d4c5",
      sha256: "705b153b3c3412fce97947f3d9897227fde489be37000a4812ab535f799a15c7"
    });

    expect(redacted).toEqual({
      operationId: "op_controlled_contaazul_sale_20260619201113142",
      approvalText: "APROVAR op_contaazul_sale_1781903486089_6092b931",
      idempotencyKey: "contaazul-sale-boleto:8614c01bfda7d75296250df7fa29d4c5",
      sha256: "705b153b3c3412fce97947f3d9897227fde489be37000a4812ab535f799a15c7"
    });
  });

  it("still masks a formatted phone inside a free-text string", () => {
    const text = redactString("Ligar para (62) 99151-4384 hoje");
    expect(text).not.toContain("99151-4384");
    expect(text).toContain("[REDACTED_PHONE]");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `C:\Kamilly\harness`): `npx vitest run tests/core/redaction.test.ts`
Expected: FAIL — "preserves audit identifiers" fails because the current phone regex rewrites the numeric runs to `[REDACTED_PHONE]`.

- [ ] **Step 3: Tighten the value regexes and add identifier preservation**

In `harness/src/core/redaction.ts`, add this constant right after the existing `DOCUMENT_KEY_PATTERN` declaration (around line 20):

```ts
const PRESERVE_KEY_PATTERN = /^(operationId|duplicateOperationId|idempotencyKey|sha256|timestamp)$/;
```

Replace the entire body of `redactString` with:

```ts
export function redactString(value: string): string {
  return value
    .replace(/\bCookie:\s*[^;\n\r]+/gi, `Cookie: ${SECRET_PLACEHOLDER}`)
    .replace(
      /\b(auth-token|redirect_token|accountancy-token|authorization|x-authorization)=([^;\s]+)/gi,
      `$1=${SECRET_PLACEHOLDER}`
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, EMAIL_PLACEHOLDER)
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, DOCUMENT_PLACEHOLDER)
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, DOCUMENT_PLACEHOLDER)
    .replace(/(?<!\d)(?:\+55[\s-]?)?\(?\d{2}\)?[\s-]?9?\d{4}-\d{4}(?!\d)/g, PHONE_PLACEHOLDER);
}
```

Replace the entire body of `redactValueForKey` with:

```ts
function redactValueForKey(key: string, value: unknown): unknown {
  if (PRESERVE_KEY_PATTERN.test(key) && (typeof value === "string" || typeof value === "number")) {
    return value;
  }
  if (EMAIL_KEY_PATTERN.test(key)) return EMAIL_PLACEHOLDER;
  if (PHONE_KEY_PATTERN.test(key)) return PHONE_PLACEHOLDER;
  if (DOCUMENT_KEY_PATTERN.test(key)) return DOCUMENT_PLACEHOLDER;
  if (SECRET_KEY_PATTERN.test(key)) return SECRET_PLACEHOLDER;
  return redactUnknown(value);
}
```

- [ ] **Step 4: Run the full suite to verify pass and no regressions**

Run (from `C:\Kamilly\harness`): `npm run test`
Expected: PASS — 76 tests (the 74 baseline + 2 new). Confirm `tests/core/redaction.test.ts` and `tests/modules/contaazul/tools.test.ts` both pass (the latter asserts redacted ledgers do not contain `pro-token-test`).

- [ ] **Step 5: Typecheck and commit**

Run (from `C:\Kamilly\harness`): `npm run typecheck`
Expected: no errors.
```bash
cd C:/Kamilly && git add harness/src/core/redaction.ts harness/tests/core/redaction.test.ts && git commit -m "fix(redaction): preserve audit identifiers, tighten phone/document regexes

```

---

## Task 2: Accept Trimmed Approval Text (item 7)

`parseApprovalText` uses strict `===`, so a trailing newline/space from terminal copy-paste silently fails approval. Trim the input ends before comparison.

**Files:**
- Modify: `harness/src/core/approval.ts`
- Modify: `harness/tests/core/approval.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside `describe("approval parser", ...)` in `harness/tests/core/approval.test.ts`:

```ts
  it("accepts approval text with surrounding whitespace", () => {
    expect(parseApprovalText("  APROVAR op_123\n", "op_123")).toEqual({
      approved: true,
      operationId: "op_123"
    });
  });

  it("still rejects internal-only differences after trimming", () => {
    expect(parseApprovalText("APROVAR  op_123", "op_123").approved).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `C:\Kamilly\harness`): `npx vitest run tests/core/approval.test.ts`
Expected: FAIL on "accepts approval text with surrounding whitespace" (current code compares the untrimmed string).

- [ ] **Step 3: Trim input before comparison**

In `harness/src/core/approval.ts`, replace the line `if (input === expected) {` with:

```ts
  if (input.trim() === expected) {
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `C:\Kamilly\harness`): `npx vitest run tests/core/approval.test.ts`
Expected: PASS (4 tests). The "APROVAR  op_123" double-space case stays rejected.

- [ ] **Step 5: Commit**

```bash
cd C:/Kamilly && git add harness/src/core/approval.ts harness/tests/core/approval.test.ts && git commit -m "fix(approval): trim approval text before exact-match check

```

---

## Task 3: Remove Real PII Defaults From Config + Guard Live Sale (item 3)

`config.ts` ships a real Gmail, a real financial-account UUID, and a real company name as source defaults. Make them env-only (fail-closed empty), and block a live service sale when the financial account id is unset rather than POSTing an empty value.

**Files:**
- Modify: `harness/src/core/config.ts`
- Modify: `harness/tests/core/config.test.ts`
- Modify: `harness/src/modules/contaazul/tools.ts`
- Modify: `harness/tests/modules/contaazul/tools.test.ts`

- [ ] **Step 1: Update the config test to expect fail-closed empty defaults**

In `harness/tests/core/config.test.ts`, replace lines 15-19 (the three `expect(config.contaAzul...)` assertions in the "loads fail-closed defaults" test) with:

```ts
    expect(config.contaAzulFinancialAccountId).toBe("");
    expect(config.contaAzulDefaultReplyToEmail).toBe("");
    expect(config.contaAzulDefaultCompanyDisplayName).toBe("");
```

Leave the second test ("honors explicit paths and live gates") unchanged — it already passes env values.

- [ ] **Step 2: Run the config test to verify it fails**

Run (from `C:\Kamilly\harness`): `npx vitest run tests/core/config.test.ts`
Expected: FAIL — defaults still return the hardcoded real values.

- [ ] **Step 3: Make the config defaults env-only**

In `harness/src/core/config.ts`, replace the three assignments inside `loadHarnessConfig`:

```ts
    contaAzulFinancialAccountId:
      env.CONTAAZUL_FINANCIAL_ACCOUNT_ID ?? "cf6eedce-10e8-4554-b707-9246826b12c6",
    contaAzulDefaultReplyToEmail:
      env.CONTAAZUL_DEFAULT_REPLY_TO_EMAIL ?? "sccontabilidadefinanceiro@gmail.com",
    contaAzulDefaultCompanyDisplayName:
      env.CONTAAZUL_DEFAULT_COMPANY_DISPLAY_NAME ?? "MAIS NEGOCIOS ASSESSORIA CONTABIL LTDA",
```

with:

```ts
    contaAzulFinancialAccountId: env.CONTAAZUL_FINANCIAL_ACCOUNT_ID ?? "",
    contaAzulDefaultReplyToEmail: env.CONTAAZUL_DEFAULT_REPLY_TO_EMAIL ?? "",
    contaAzulDefaultCompanyDisplayName: env.CONTAAZUL_DEFAULT_COMPANY_DISPLAY_NAME ?? "",
```

- [ ] **Step 4: Move the real values to the harness env (manual, do not commit them)**

Add the three keys to `C:\Kamilly\contaazul\.env` (which is git-ignored by Task 0) using the operator's real values:
```
CONTAAZUL_FINANCIAL_ACCOUNT_ID=<real account id>
CONTAAZUL_DEFAULT_REPLY_TO_EMAIL=<real reply-to>
CONTAAZUL_DEFAULT_COMPANY_DISPLAY_NAME=<real company name>
```
This step is configuration, not code. If the operator's values are unknown, leave this for them and proceed — Step 5 guarantees a live sale will block clearly rather than send an empty account id.

- [ ] **Step 5: Write the failing guard test**

In `harness/tests/modules/contaazul/tools.test.ts`, inside `describe("Conta Azul mutation tools", ...)`, append:

```ts
  it("blocks a live service sale when the financial account id is not configured", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const client = createFakeMutationClient({});
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      config: { financialAccountId: "", defaultReplyToEmail: "reply@example.test", defaultCompanyDisplayName: "Empresa Teste" },
      proSessionStore: new Map([["rel_001", "pro-token-test"]]),
      operationIdFactory: () => "op_no_account"
    });

    const receipt = await tools.createServiceSaleAndIssueBoleto({
      relationId: "rel_001",
      customerId: "person_uuid",
      customerName: "Cliente Exemplo",
      categoryId: "cat_uuid",
      serviceItemId: "item_uuid",
      serviceDescription: "Honorarios mensais",
      unitValue: 250.75,
      dueDateIso: "2026-07-20",
      saleDateIso: "2026-06-19",
      saleNumber: 123,
      operationNatureId: "nature_uuid",
      notification: { email: "cliente@example.test", phone: "11999999999" },
      approvalText: "APROVAR op_no_account"
    });

    expect(receipt.status).toBe("blocked");
    expect(receipt.warnings.join(" ")).toContain("CONTAAZUL_FINANCIAL_ACCOUNT_ID");
    expect(client.calls).toEqual([]);
  });
```

- [ ] **Step 6: Run the guard test to verify it fails**

Run (from `C:\Kamilly\harness`): `npx vitest run tests/modules/contaazul/tools.test.ts -t "financial account id is not configured"`
Expected: FAIL — currently the empty id is sent into the payload (status would be `succeeded`).

- [ ] **Step 7: Add the guard in `createServiceSaleAndIssueBoleto`**

In `harness/src/modules/contaazul/tools.ts`, inside `createServiceSaleAndIssueBoleto`, immediately after the line:

```ts
      const financialAccountId =
        params.financialAccountId ?? options.config.financialAccountId;
```

insert:

```ts
      if (!financialAccountId) {
        const warning =
          "Conta financeira nao configurada: defina CONTAAZUL_FINANCIAL_ACCOUNT_ID antes de criar venda ao vivo.";
        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
          status: "blocked",
          summary: warning,
          args: params,
          data: {
            approvalPreview: {
              operationId,
              provider: "contaazul",
              toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
              action: "create",
              target: { customerId: params.customerId, customerName: params.customerName },
              changes: [],
              irreversible: false,
              rollbackNote: "Nenhuma acao executada."
            },
            plannedRequests: []
          },
          warnings: [warning]
        });
      }
```

- [ ] **Step 8: Run the full suite and typecheck**

Run (from `C:\Kamilly\harness`): `npm run test` then `npm run typecheck`
Expected: PASS — the new guard test passes; the existing dry-run/live tests (which use `financialAccountId: "account_test"`) are unaffected.

- [ ] **Step 9: Commit**

```bash
cd C:/Kamilly && git add harness/src/core/config.ts harness/tests/core/config.test.ts harness/src/modules/contaazul/tools.ts harness/tests/modules/contaazul/tools.test.ts && git commit -m "fix(config): remove real PII defaults; block live sale without financial account id

```

---

## Task 4: Deterministic Route Priority For Colliding Routes (item 4)

Two Asaas routes and two Conta Azul routes share identical `match()` predicates. Today the winner depends on stable-sort array order when missing-field counts tie. Make the tie-break explicit: when both an ID-based and a name-based route fully match, prefer the exact ID-based tool.

**Files:**
- Modify: `harness/src/agent/orchestrator.ts`
- Modify: `harness/tests/agent/orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

In `harness/tests/agent/orchestrator.test.ts`, append inside `describe("agent orchestrator", ...)`:

```ts
  it("prefers the exact-id Asaas tool when both id and name are provided", async () => {
    const registry = createToolRegistry();

    registerHarnessTools(registry, {
      asaasMutation: {
        createBoletoCharge: async () =>
          receipt("asaas.create_boleto_charge", { plannedRequest: { method: "POST", url: "x" } }),
        createBoletoChargeWorkflow: async () =>
          receipt("asaas.create_boleto_charge_workflow", { plannedRequest: { method: "POST", url: "y" } })
      }
    });

    const result = await planOrchestratorTurn({
      request: "criar boleto no Asaas",
      registry,
      params: {
        customerId: "cust_1",
        customerName: "Cliente Exemplo",
        valueBr: "120,00",
        dueDateBr: "20/07/2026",
        description: "Honorarios"
      }
    });

    expect(result).toMatchObject({
      status: "executed",
      toolName: "asaas.create_boleto_charge"
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails or is non-deterministic**

Run (from `C:\Kamilly\harness`): `npx vitest run tests/agent/orchestrator.test.ts -t "prefers the exact-id"`
Expected: This may pass accidentally today (stable sort + array order). Proceed anyway — the implementation change makes it guaranteed rather than incidental and protects against future route reordering.

- [ ] **Step 3: Add an explicit `priority` field and use it in the tie-break**

In `harness/src/agent/orchestrator.ts`, extend the `Route` type (around line 61) to include a priority:

```ts
type Route = {
  provider: Provider;
  intent: string;
  toolName: string;
  requiredFields: string[];
  priority: number;
  match: (request: string) => boolean;
};
```

Update the sort inside `planOrchestratorTurn` (around line 186-192) to break ties by priority (higher wins):

```ts
  const routeMatch = ROUTES
    .filter((candidate) => candidate.match(normalizedRequest))
    .map((route) => ({
      route,
      missingFields: route.requiredFields.filter((field) => !hasParam(params, field))
    }))
    .sort((a, b) =>
      a.missingFields.length - b.missingFields.length ||
      b.route.priority - a.route.priority
    )[0];
```

Then add `priority` to every entry in the `ROUTES` array. Give workflow (name-resolving) routes a lower priority than their exact-id siblings, and a neutral default elsewhere. Set:

- `asaas.create_boleto_charge` → `priority: 10`
- `asaas.create_boleto_charge_workflow` → `priority: 5`
- `contaazul.create_service_sale_and_issue_boleto` → `priority: 10`
- `contaazul.create_service_sale_boleto_workflow` → `priority: 5`
- every other route → `priority: 0`

Concretely, add a `priority: 0,` line to each non-colliding route object (after its `requiredFields`), and the `priority: 10`/`priority: 5` lines to the four colliding routes listed above.

- [ ] **Step 4: Run the full suite to verify pass**

Run (from `C:\Kamilly\harness`): `npm run test`
Expected: PASS. The two existing Conta Azul routing tests still pass: the "natural input" test still routes to the workflow (it has fewer missing fields than the exact tool), and the "exact params" test still routes to the exact tool (zero missing). The new Asaas tie-break test passes deterministically.

- [ ] **Step 5: Typecheck and commit**

Run (from `C:\Kamilly\harness`): `npm run typecheck`
```bash
cd C:/Kamilly && git add harness/src/agent/orchestrator.ts harness/tests/agent/orchestrator.test.ts && git commit -m "fix(orchestrator): deterministic priority tie-break for colliding routes

```

---

## Task 5: Remove Dead Code In The Sale Flow (item 8)

`pollChargeRequestUrl` and `extractChargeRequestFromSummary` in `tools.ts` are defined but never called — the live flow resolves the charge URL through `pollChargeRequestFromFinancialStatement` instead. Remove them to shrink the surface of a safety-critical file. (`financialEventPollingPlan` is still used by the reissue flow — keep it.)

**Files:**
- Modify: `harness/src/modules/contaazul/tools.ts`

- [ ] **Step 1: Confirm the functions are unreferenced**

Run (from `C:\Kamilly\harness`): `npx vitest run` first to record green, then search:
```bash
grep -n "pollChargeRequestUrl\|extractChargeRequestFromSummary\|getFinancialEventSummary" src/modules/contaazul/tools.ts
```
Expected: each name appears only at its own definition site (and `getFinancialEventSummary` only inside the to-be-removed `pollChargeRequestUrl`). If any appears in an active code path, STOP and do not remove it.

- [ ] **Step 2: Delete the dead functions**

In `harness/src/modules/contaazul/tools.ts`, delete the entire `async function pollChargeRequestUrl(...) { ... }` block (the function starting at `async function pollChargeRequestUrl(input: {`) and the entire `function extractChargeRequestFromSummary(...) { ... }` block. Delete nothing else.

- [ ] **Step 3: Typecheck to confirm no dangling references**

Run (from `C:\Kamilly\harness`): `npm run typecheck`
Expected: no errors. If TypeScript reports `getFinancialEventSummary` is now unused on the client interface, leave the interface method in place (it is part of the client contract and harmless) — only the two helper functions are removed.

- [ ] **Step 4: Run the full suite and commit**

Run (from `C:\Kamilly\harness`): `npm run test`
Expected: PASS, same test count as after Task 4.
```bash
cd C:/Kamilly && git add harness/src/modules/contaazul/tools.ts && git commit -m "refactor(contaazul): remove dead charge-summary polling helpers

```

---

## Task 6: Pre-Flight Pro-Session Health Check (item 6)

A present-but-expired in-memory Pro token currently still attempts the live POST. Add an optional `verifyProSession` capability to the client and, when available, check it before the first live write so an expired session blocks cleanly with recapture guidance instead of throwing mid-flow.

**Files:**
- Modify: `harness/src/modules/contaazul/client.ts`
- Modify: `harness/src/modules/contaazul/tools.ts`
- Modify: `harness/tests/modules/contaazul/tools.test.ts`

- [ ] **Step 1: Add the optional capability to the client interface**

In `harness/src/modules/contaazul/client.ts`, add to the `ContaAzulMutationClient` type (after `downloadBoletoPdf(...)`):

```ts
  verifyProSession?(params: { authToken: string }): Promise<boolean>;
```

Add a concrete implementation to `MappedContaAzulSessionClient` (a cheap read that throws `ContaAzulSessionExpiredError` on 401/403 via `assertNotExpired`). Add this method to the class, before the private `maisHeaders()`:

```ts
  async verifyProSession(params: { authToken: string }): Promise<boolean> {
    const response = await this.request(`${SERVICES_BASE_URL}/app/v1/negotiations/next-number`, {
      headers: proReadHeaders(params.authToken)
    });
    assertNotExpired(response);
    return response.ok;
  }
```

- [ ] **Step 2: Write the failing test**

In `harness/tests/modules/contaazul/tools.test.ts`, inside `describe("Conta Azul mutation tools", ...)`, append:

```ts
  it("blocks a live sale with recapture guidance when the Pro session is expired", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const base = createFakeMutationClient({});
    const client = {
      ...base,
      async verifyProSession() {
        throw new ContaAzulSessionExpiredError("Conta Azul session expired.");
      }
    };
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]]),
      operationIdFactory: () => "op_expired_sale"
    });

    const receipt = await tools.createServiceSaleAndIssueBoleto({
      relationId: "rel_001",
      customerId: "person_uuid",
      customerName: "Cliente Exemplo",
      categoryId: "cat_uuid",
      serviceItemId: "item_uuid",
      serviceDescription: "Honorarios mensais",
      unitValue: 250.75,
      dueDateIso: "2026-07-20",
      saleDateIso: "2026-06-19",
      saleNumber: 123,
      operationNatureId: "nature_uuid",
      notification: { email: "cliente@example.test", phone: "11999999999" },
      approvalText: "APROVAR op_expired_sale"
    });

    expect(receipt.status).toBe("blocked");
    expect(receipt.warnings.join(" ")).toContain("node contaazul/capture.js");
    expect(base.calls).toEqual([]);
  });
```

- [ ] **Step 2b: Run the test to verify it fails**

Run (from `C:\Kamilly\harness`): `npx vitest run tests/modules/contaazul/tools.test.ts -t "Pro session is expired"`
Expected: FAIL — there is no pre-flight check yet, so `verifyProSession` is never called and the flow proceeds to `createServiceSale`.

- [ ] **Step 3: Call the pre-flight check before the first live write**

In `harness/src/modules/contaazul/tools.ts`, inside `createServiceSaleAndIssueBoleto`, find the live-path section that begins right after the `if (!authToken) { throw new Error("Conta Azul Pro session unexpectedly missing after validation."); }` block and immediately before `const saleResult = await options.client.createServiceSale({`. Insert:

```ts
      if (options.client.verifyProSession) {
        try {
          const ok = await options.client.verifyProSession({ authToken });
          if (!ok) throw new ContaAzulSessionExpiredError();
        } catch (error) {
          if (error instanceof ContaAzulSessionExpiredError) {
            const warning = `${error.message} Recapture session with ${error.recaptureCommand}.`;
            return writeMutationReceipt({
              ledgerPath: options.ledgerPath,
              operationId,
              runtimeMode,
              toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
              status: "blocked",
              summary: warning,
              args: params,
              data,
              artifacts: [pdfArtifact],
              warnings: [warning]
            });
          }
          throw error;
        }
      }
```

- [ ] **Step 4: Run the full suite to verify pass**

Run (from `C:\Kamilly\harness`): `npm run test`
Expected: PASS. The existing live happy-path test still passes because its fake client has no `verifyProSession` method (the `if (options.client.verifyProSession)` guard is skipped), so its asserted call order is unchanged.

- [ ] **Step 5: Typecheck and commit**

Run (from `C:\Kamilly\harness`): `npm run typecheck`
```bash
cd C:/Kamilly && git add harness/src/modules/contaazul/client.ts harness/src/modules/contaazul/tools.ts harness/tests/modules/contaazul/tools.test.ts && git commit -m "feat(contaazul): pre-flight Pro-session health check before live sale

```

---

## Task 7: Partial-Failure Capture For The Live Sale (items 5, 9)

If `createServiceSale` succeeds but a later step (event poll, charge, notification, statement poll, PDF) fails, the sale is left orphaned in Conta Azul while the operation throws. Capture the created `saleId` and emit a clear `failed` receipt with recovery guidance, recording the orphan in the ledger instead of throwing raw.

**Files:**
- Modify: `harness/src/modules/contaazul/tools.ts`
- Modify: `harness/tests/modules/contaazul/tools.test.ts`

- [ ] **Step 1: Write the failing test**

In `harness/tests/modules/contaazul/tools.test.ts`, inside `describe("Conta Azul mutation tools", ...)`, append. This test uses a client that creates the sale but then fails the financial-event lookup:

```ts
  it("captures the orphaned sale id when a post-sale step fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-contaazul-mutation-"));
    const base = createFakeMutationClient({});
    const client = {
      ...base,
      async getFinancialEventsByReference(params: unknown) {
        base.calls.push({ name: "getFinancialEventsByReference", payload: params });
        return [];
      }
    };
    const tools = createContaAzulMutationTools({
      client,
      ledgerPath: path.join(dir, "ledger", "operations.jsonl"),
      artifactsDir: path.join(dir, "artifacts"),
      runtimeMode: "live",
      allowLiveMutations: true,
      config: mutationConfig(),
      proSessionStore: new Map([["rel_001", "pro-token-test"]]),
      operationIdFactory: () => "op_partial"
    });

    const receipt = await tools.createServiceSaleAndIssueBoleto({
      relationId: "rel_001",
      customerId: "person_uuid",
      customerName: "Cliente Exemplo",
      categoryId: "cat_uuid",
      serviceItemId: "item_uuid",
      serviceDescription: "Honorarios mensais",
      unitValue: 250.75,
      dueDateIso: "2026-07-20",
      saleDateIso: "2026-06-19",
      saleNumber: 123,
      operationNatureId: "nature_uuid",
      notification: { email: "cliente@example.test", phone: "11999999999" },
      approvalText: "APROVAR op_partial"
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.warnings.join(" ")).toContain("sale_uuid");
    expect(receipt.data?.result).toMatchObject({ orphanedSaleId: "sale_uuid", failedStep: "poll_financial_event" });
    expect(base.calls.map((call) => call.name)).toEqual([
      "createServiceSale",
      "getFinancialEventsByReference"
    ]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `C:\Kamilly\harness`): `npx vitest run tests/modules/contaazul/tools.test.ts -t "orphaned sale id"`
Expected: FAIL — currently `pollFinancialEventForSale` throws and the error propagates as an unhandled rejection (no `failed` receipt, no `orphanedSaleId`).

- [ ] **Step 3: Wrap the post-sale steps in a compensation-aware try/catch**

In `harness/src/modules/contaazul/tools.ts`, in `createServiceSaleAndIssueBoleto`, wrap the live execution that starts at `const saleResult = await options.client.createServiceSale({` through the final `return writeMutationReceipt({ ... status: "succeeded" ... })`. Keep `createServiceSale` outside the try (so a failure there is just a normal throw with no orphan), and put everything after it inside a try that records the orphan on failure. Replace the block beginning:

```ts
      const saleResult = await options.client.createServiceSale({
        authToken,
        payload: salePayload
      });
      const saleId = extractRequiredString(saleResult, ["id"], "created sale id");
```

...up to the end of the existing `return writeMutationReceipt({ ... "Venda de servico, boleto, notificacao e PDF gerados no Conta Azul." ... })`, with this structure (the inner step code is unchanged — only the surrounding try/catch and a `failedStep` tracker are added):

```ts
      const saleResult = await options.client.createServiceSale({
        authToken,
        payload: salePayload
      });
      const saleId = extractRequiredString(saleResult, ["id"], "created sale id");
      let failedStep = "poll_financial_event";

      try {
        const createdSaleNumber = extractOptionalNumber(saleResult, ["number"]) ?? params.saleNumber;
        const financialEvent = await pollFinancialEventForSale({
          client: options.client,
          authToken,
          saleId,
          maxAttempts: 10,
          delayMs: 2000
        });

        failedStep = "create_charge_request";
        const liveChargePayload = buildChargeRequestPayload({
          financialAccountId,
          installmentId: financialEvent.installmentId,
          installmentVersion: financialEvent.installmentVersion,
          originalDescription: `Venda ${createdSaleNumber}`,
          dueDateIso: params.dueDateIso,
          value: params.unitValue,
          index: 1,
          email: params.notification.email,
          smsNumbers: compact([params.notification.phone]),
          whatsappNumbers: compact([params.notification.phone])
        });
        const chargeResult = await options.client.createChargeRequest({
          authToken,
          payload: liveChargePayload
        });
        const chargeRequestId = extractChargeRequestId(chargeResult);

        failedStep = "send_notification";
        const liveNotificationPayload = buildChargeNotificationPayload({
          customerName: params.customerName,
          value: params.unitValue,
          dueDateIso: params.dueDateIso,
          saleNumber: createdSaleNumber,
          email: params.notification.email,
          replyTo: params.notification.replyTo ?? options.config.defaultReplyToEmail,
          companyDisplayName:
            params.notification.companyDisplayName ??
            options.config.defaultCompanyDisplayName,
          chargeRequestIds: [chargeRequestId]
        });
        const notificationResult = await options.client.sendChargeNotification({
          authToken,
          payload: liveNotificationPayload
        });

        failedStep = "poll_charge_url";
        const chargeRequestFromStatement = await pollChargeRequestFromFinancialStatement({
          client: options.client,
          authToken,
          saleNumber: createdSaleNumber,
          value: params.unitValue,
          chargeRequestId,
          maxAttempts: 20,
          delayMs: 3000
        });

        failedStep = "download_pdf";
        const pdf = await options.client.downloadBoletoPdf({
          authToken,
          customerName: params.customerName,
          chargeRequestId: chargeRequestFromStatement.chargeRequestId,
          chargeUrl: chargeRequestFromStatement.chargeUrl
        });
        const pdfArtifactResult = await saveBinaryArtifact({
          artifactsDir: options.artifactsDir,
          provider: "contaazul",
          operationId,
          label: "boleto da venda",
          fileName: `boleto_venda_${createdSaleNumber}.pdf`,
          kind: "pdf",
          contents: pdf
        });
        const resultSummary = {
          saleId,
          saleNumber: createdSaleNumber,
          financialEventId: financialEvent.financialEventId,
          installmentId: financialEvent.installmentId,
          installmentVersion: financialEvent.installmentVersion,
          chargeRequestId: chargeRequestFromStatement.chargeRequestId,
          chargeUrl: chargeRequestFromStatement.chargeUrl,
          chargeUrlSource: "financial_statement",
          saleResult,
          chargeResult,
          notificationResult
        };
        const resultArtifact = await saveJsonArtifact({
          artifactsDir: options.artifactsDir,
          provider: "contaazul",
          operationId,
          label: "resultado da venda e boleto",
          fileName: `resultado_venda_${createdSaleNumber}.json`,
          contents: redact({
            idempotencyKey,
            approvalPreview,
            result: resultSummary
          })
        });

        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
          status: "succeeded",
          summary: "Venda de servico, boleto, notificacao e PDF gerados no Conta Azul.",
          args: params,
          data: {
            ...data,
            result: resultSummary
          },
          artifacts: [pdfArtifactResult, resultArtifact],
          responseSummary: serviceSaleResponseSummary({
            summary: "Venda de servico, boleto, notificacao e PDF gerados no Conta Azul.",
            idempotencyKey,
            params,
            result: resultSummary
          })
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "etapa pos-venda falhou.";
        const warning =
          `Venda criada no Conta Azul (saleId=${saleId}) mas a etapa "${failedStep}" falhou: ${detail}. ` +
          "Verifique e cancele a venda manualmente se necessario antes de tentar novamente.";
        return writeMutationReceipt({
          ledgerPath: options.ledgerPath,
          operationId,
          runtimeMode,
          toolName: CREATE_SERVICE_SALE_AND_ISSUE_BOLETO_TOOL,
          status: "failed",
          summary: warning,
          args: params,
          data: {
            ...data,
            result: { orphanedSaleId: saleId, failedStep, error: detail }
          },
          artifacts: [pdfArtifact],
          warnings: [warning],
          responseSummary: {
            summary: warning,
            idempotencyKey,
            orphanedSaleId: saleId,
            failedStep
          }
        });
      }
```

Note: the inner step logic is identical to the previous straight-line code; only `createServiceSale` is kept outside the try, a `failedStep` marker is threaded through, and the `catch` produces a `failed` receipt with `orphanedSaleId`.

- [ ] **Step 4: Run the full suite to verify pass**

Run (from `C:\Kamilly\harness`): `npm run test`
Expected: PASS. The existing live happy-path test still asserts the same call order and `succeeded` status (the success branch is unchanged). The new partial-failure test passes.

- [ ] **Step 5: Typecheck and commit**

Run (from `C:\Kamilly\harness`): `npm run typecheck`
```bash
cd C:/Kamilly && git add harness/src/modules/contaazul/tools.ts harness/tests/modules/contaazul/tools.test.ts && git commit -m "feat(contaazul): capture orphaned sale id on post-sale partial failure

```

---

## Task 8: Final Verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run (from `C:\Kamilly\harness`): `npm run test`
Expected: all tests pass (baseline 74 + new tests from Tasks 1, 3, 4, 6, 7 ≈ 81 tests), 17+ files.

- [ ] **Step 2: Typecheck**

Run (from `C:\Kamilly\harness`): `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Secret-leak guard**

Run (from `C:\Kamilly`):
```bash
git ls-files | grep -iE '\.env$|state\.json$|\.mp4$|\.pdf$|captured_|clientes_export' && echo "LEAK" || echo "clean"
```
Expected: prints `clean`.

- [ ] **Step 4: Confirm the dry-run default still holds end-to-end**

Run (from `C:\Kamilly\harness`): `npm run dev -- --operator --dry-run "criar venda de servico e emitir boleto no Conta Azul"`
Expected: status `needs_input` or a planned preview — never a live write — and no token strings in the output.

---

## Self-Review

**Spec coverage:**
- Item 1 (root .gitignore + git baseline) → Task 0. ✓
- Item 2 (redaction: identifier corruption + tightened regexes) → Task 1. ✓
- Item 3 (hardcoded PII defaults + live guard) → Task 3. ✓
- Item 4 (route collision) → Task 4. ✓
- Item 5 (partial-failure / orphaned sale) → Task 7. ✓
- Item 6 (session health check before mutation) → Task 6. ✓
- Item 7 (approval trim) → Task 2. ✓
- Item 8 (dead code) → Task 5. ✓
- Item 9 (live-path tests, partial failure) → Tasks 6 and 7 add mocked-client failure-path tests. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to" — every code step shows full code. The only non-code step is Task 3 Step 4 (operator fills real env values), which is explicitly configuration, and Step 7's guard guarantees safety even if it is skipped.

**Type consistency:** `verifyProSession?` is declared optional on `ContaAzulMutationClient` (Task 6) and guarded with `if (options.client.verifyProSession)` before use, so existing fakes without it still typecheck and run. `failedStep` / `orphanedSaleId` live only inside the `ContaAzulMutationPlan.result` field (typed `unknown`), so no type changes are required. `priority` is added to the `Route` type and every `ROUTES` entry (Task 4).

**Known scope boundary:** Task 7 records the orphaned sale and instructs manual cancellation rather than auto-cancelling — Conta Azul sale cancellation is not a mapped tool, and auto-rollback could itself fail or cancel the wrong entity. Adding a mapped `cancelSale` tool is a candidate for a future plan, not this one.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-19-harness-hardening.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, with review between tasks and fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, with checkpoints for review.

Which approach?
