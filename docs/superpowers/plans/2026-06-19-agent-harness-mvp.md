# Agent Harness MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MVP AI orchestration harness that can run the existing Asaas and Conta Azul mapped HTTP-session flows through safe, typed tools.

**Architecture:** Keep the current JavaScript scripts as discovery/proving assets, then extract stable behavior into TypeScript modules with schemas, audit logs, artifacts, and human approval gates. The only provider integration surface is the mapped browser-session HTTP behavior already captured in the scripts. The agent owns conversation and routing; deterministic tools own session-bound HTTP requests, parsing, retries, downloads, and receipts.

**Tech Stack:** Node.js, TypeScript, Zod, Playwright for session capture/debugging, local JSONL/SQLite operation ledger, OpenAI Agents SDK or equivalent tool-calling harness, `.env`/`state.json` session storage, and an optional private MCP adapter later only if it exposes our own mapped tools.

---

## Current System Summary

### Asaas

Relevant files:
- `asaas_clientes.js`: customer CRUD/export over mapped Asaas web endpoints.
- `cobrancas/asaas_cobrancas.js`: charge list/detail/create/edit/delete/receipt/interest flows.
- `cobrancas/interativo.js`: user-facing CLI for finding a customer, editing due date, creating a charge, extracting boleto/fatura links, and downloading PDF.
- `capture.js` and `request.js`: generic login/session capture and request validation.

Current auth model:
- Uses `COOKIE_STRING` from `.env`.
- Uses browser-session web endpoints under `https://www.asaas.com`.
- Does not use official Asaas API key or official webhooks, and must not add them later.

Stable candidate tools:
- `asaas.search_customers`
- `asaas.list_pending_charges`
- `asaas.update_charge_due_date`
- `asaas.create_boleto_charge`
- `asaas.get_charge_links`
- `asaas.download_boleto_pdf`
- `asaas.export_customers`
- `asaas.export_charges`

Main risks:
- HTML parsing with regex/selectors can break when the UI changes.
- Root `.env` is shared by multiple experiments, so provider/session separation is weak.
- Mutating actions are possible from CLI without a durable operation ledger.

### Conta Azul

Relevant files:
- `contaazul/capture.js`: captures Conta Azul session into `contaazul/.env` and `contaazul/state.json`.
- `contaazul/request.js`: validates HTTP and Playwright session restoration.
- `contaazul/interativo.js`: main CLI with three business flows.
- `contaazul/map_new_sale_flow.js`, `scan_capture_log.js`, `prepare_mcp_injection.js`: discovery/debugging utilities.

Current auth model:
- Uses captured Conta Azul Mais session cookies in `state.json`.
- Derives/switches to Conta Azul Pro via mapped session endpoints.
- Uses `x-authorization` from the derived `auth-token` for private/internal Conta Azul service endpoints.
- Does not use official OAuth2 API, and must not add it later.

Stable candidate tools:
- `contaazul.list_accountancy_clients`
- `contaazul.switch_to_pro_session`
- `contaazul.search_financial_statement`
- `contaazul.update_due_date_reissue_boleto`
- `contaazul.create_customer`
- `contaazul.search_customer_for_sale`
- `contaazul.create_service_sale`
- `contaazul.issue_charge_notification`
- `contaazul.download_boleto_pdf`

Main risks:
- Private/internal endpoints are not contractual and can change without notice.
- Conta Azul sessions expire and the current flow needs manual recapture.
- Hardcoded defaults exist in `contaazul/interativo.js`, including financial account ID and reply-to email.
- There is no webhook path, so polling/backoff and operation state are required.

## Permanent Integration Boundary

- Do not use official Asaas API endpoints, API keys, official webhooks, or official Asaas MCP.
- Do not use official Conta Azul API/OAuth integration, official webhooks, or official Conta Azul MCP/docs connectors.
- Do not add provider-official adapters later. This is a product constraint, not just an MVP shortcut.
- The only provider interaction path is the mapped HTTP/session path already proven by the scripts.
- Playwright is allowed for login/session capture, troubleshooting, and remapping when the UI/private endpoints change.
- A private MCP server is allowed later only if it is ours and only exposes the same typed tool registry implemented in this repository.
- External provider documentation may be read for background risk awareness, but must not become a dependency, adapter target, or runtime capability.

## Non-Goals

- No official Asaas API migration.
- No official Conta Azul API/OAuth migration.
- No provider webhooks.
- No provider MCP servers.
- No autonomous destructive actions.
- No final UI work in this phase.
- No broad rewrite of all current scripts before the harness proves one flow end-to-end.

## Safety Invariants

- The default runtime mode is `dry-run`; live mutations require explicit runtime flag and explicit user approval.
- Live mutation requires two gates: process environment `ALLOW_LIVE_MUTATIONS=true` and CLI/runtime flag `--live`.
- Approval text must include the exact operation ID, for example `APROVAR op_20260619_abc123`. A generic "sim" is not enough for live mutations.
- Read tools can run without approval, but still write a ledger entry.
- Mutating tools cannot send network requests until an approval preview is created and approved.
- Approval is per operation. Approval for one charge, customer, or sale does not authorize another.
- Every provider request must use a redacted request log; no cookie, token, password, CPF/CNPJ, full email, or session state is allowed in agent-visible traces by default.
- Tools must return structured data, not console text. Console text can exist only in legacy scripts.
- The orchestrator may ask the user for missing information, but must not invent customer IDs, values, dates, emails, phone numbers, financial account IDs, or service/category IDs.
- Session recapture is a first-class operational flow. If a session is expired, the agent reports the exact provider and asks the operator to recapture with the existing capture script.
- If provider session identity is ambiguous, stale, missing, or points to the wrong provider, the tool must return `blocked` and stop before network writes.
- Legacy scripts must not be shell-invoked by the new agent for business mutations. They remain manual fallback and endpoint reference only.

## Session And Secret Layout

The current repository has session material in root `.env`, `contaazul/.env`, and `contaazul/state.json`. The new harness must be explicit and fail closed:

- `ASAAS_ENV_PATH`: defaults to `.env` for compatibility, but must be configurable.
- `CONTAAZUL_ENV_PATH`: defaults to `contaazul/.env`.
- `CONTAAZUL_STATE_PATH`: defaults to `contaazul/state.json`.
- `ARTIFACTS_DIR`: defaults to `artifacts/`.
- `LEDGER_PATH`: defaults to `artifacts/ledger/operations.jsonl`.
- `RUNTIME_MODE`: defaults to `dry-run`.
- `ALLOW_LIVE_MUTATIONS`: defaults to `false`.

Session loading rules:
- A tool loads only its provider session.
- A tool performs a read-only health check before any live mutation.
- Session values are never copied into approval previews, artifacts, ledger summaries, model prompts, or test fixtures.
- Artifacts and ledger files are operational data, not source fixtures. Sanitized fixtures must live under `tests/fixtures/`.

## MVP Execution Strategy

Build the harness in vertical slices, not by rewriting every script at once:

1. Core safety scaffold: config, redaction, ledger, artifacts, dry-run, approval contracts.
2. Asaas read-only slice: search customer, list pending charges, extract links.
3. Asaas first live-capable slice: update due date and download boleto, guarded by dry-run and exact approval.
4. Asaas create-charge slice: create boleto charge and download artifact.
5. Conta Azul read-only slice: list clients, switch Pro session, search financial statement.
6. Conta Azul reissue slice: update due date, cancel/reissue boleto where required, poll mapped endpoints, download artifact.
7. Conta Azul create-sale slice: create customer if needed, create service sale, issue/send charge, download artifact.
8. Orchestrator polish: natural-language routing, missing-field questions, receipts, and runbook.

The first accepted MVP can stop after slice 3 if it proves the full safety loop end-to-end.

## 2026 Research Notes

- OpenAI Agents SDK fits when the app owns orchestration, tools, approvals, and state. This project matches that shape because billing actions need validation, resumability, and audit trails.
- OpenAI docs recommend guardrails and human review for tool calls with side effects. For this project, every create/update/delete/cancel/send-notification action should pause for approval with a structured preview.
- OpenAI docs describe the harness as the control plane around the model: tool routing, approvals, tracing, recovery, and run state. Keep this separate from endpoint-specific modules.
- MCP can be useful as a protocol boundary, but only as a private server owned by this project. Official provider MCPs are forbidden by architecture.

Sources checked for AI harness/security background only:
- OpenAI Agents SDK: https://developers.openai.com/api/docs/guides/agents
- OpenAI guardrails/human review: https://developers.openai.com/api/docs/guides/agents/guardrails-approvals
- OpenAI sandbox/harness boundary: https://developers.openai.com/api/docs/guides/agents/sandboxes
- MCP security best practices: https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices

## Key Design Decisions

1. Use TypeScript for the new harness.
   - Reason: tool schemas, typed payloads, safer refactors, agent SDK compatibility, and module growth.
   - Do not rewrite all scripts first. Extract only the stable operations needed for MVP.

2. Treat existing scripts as reference implementations.
   - Keep `cobrancas/` and `contaazul/` scripts usable.
   - Move production behavior into `src/modules/*` only after a wrapper reproduces the current result.

3. Use tools, not freeform browser control, for business actions.
   - Browser/Playwright remains for login capture, session debugging, and emergency endpoint remapping.
   - The agent should call deterministic tools with typed inputs and structured outputs.

4. Add human approval before every side effect.
   - Side effects include create charge, edit due date, cancel charge, reissue boleto, create customer, create sale, send billing email/SMS/WhatsApp, delete anything, and confirm receipt.
   - Approval preview must include provider, client, value, due date, endpoint/action, artifact outputs, and rollback/limitations.

5. Add an operation ledger before expanding features.
   - Every tool call should write an operation record with `operationId`, provider, tool name, arguments redacted, target entity IDs, status, timestamps, artifacts, and error details.
   - This is the minimum audit trail for finance automation.

## Proposed File Structure

Create:
- `.gitignore`: excludes `.env`, `*.env`, `state.json`, `artifacts/`, `downloads/`, PDFs, screenshots, and unsanitized capture logs.
- `src/core/config.ts`: loads provider-specific env/session config.
- `src/core/session-store.ts`: reads session state from `.env` and `state.json`, separated by provider.
- `src/core/tool-types.ts`: shared input/output contracts for tools, approvals, artifacts, and receipts.
- `src/core/http-client.ts`: fetch wrapper with retries, rate limiting, redaction, and response capture.
- `src/core/artifacts.ts`: saves PDFs, JSON responses, HTML snapshots, and screenshots under `artifacts/`.
- `src/core/ledger.ts`: append-only operation log, initially JSONL or SQLite.
- `src/core/approval.ts`: describes side-effect previews and approval decisions.
- `src/core/dry-run.ts`: blocks live mutations unless runtime mode explicitly allows them.
- `src/core/tool-registry.ts`: registers tools and schemas.
- `src/modules/asaas/client.ts`: Asaas session HTTP client.
- `src/modules/asaas/tools.ts`: Asaas tool functions and schemas.
- `src/modules/asaas/parsers.ts`: HTML/JSON parsing for customers, charges, links.
- `src/modules/contaazul/client.ts`: Conta Azul session HTTP client and session switch.
- `src/modules/contaazul/tools.ts`: Conta Azul tool functions and schemas.
- `src/modules/contaazul/parsers.ts`: response normalization.
- `src/agent/orchestrator.ts`: routes user intent to tools and asks for missing fields.
- `src/agent/instructions/orchestrator.md`: durable behavior rules for the agent.
- `src/agent/instructions/asaas.md`: Asaas-specific tool usage rules.
- `src/agent/instructions/contaazul.md`: Conta Azul-specific tool usage rules.
- `src/cli.ts`: MVP CLI entrypoint.
- `docs/mapped-endpoints.md`: human-readable inventory of mapped endpoints extracted from the current scripts.
- `docs/runbook.md`: session recapture, dry-run/live-run, artifact, and rollback notes.
- `tests/fixtures/README.md`: explains fixture sanitization rules.
- `tests/modules/asaas/*.test.ts`: parser/client tests with saved fixtures.
- `tests/modules/contaazul/*.test.ts`: parser/client tests with saved fixtures.

Keep as discovery assets:
- `asaas_clientes.js`
- `cobrancas/asaas_cobrancas.js`
- `cobrancas/interativo.js`
- `contaazul/interativo.js`
- `contaazul/map_new_sale_flow.js`
- `contaazul/scan_capture_log.js`

## Shared Tool Contracts

All new tools should return the same envelope:

```ts
type Provider = "asaas" | "contaazul";
type RuntimeMode = "dry-run" | "live";
type OperationStatus = "planned" | "approved" | "running" | "succeeded" | "failed" | "blocked";

type Artifact = {
  kind: "json" | "pdf" | "html" | "png" | "txt";
  path: string;
  label: string;
  sha256?: string;
};

type ToolReceipt<T> = {
  operationId: string;
  provider: Provider;
  toolName: string;
  status: OperationStatus;
  dryRun: boolean;
  summary: string;
  data?: T;
  artifacts: Artifact[];
  warnings: string[];
};
```

All mutating tools should create this approval preview before doing live network writes:

```ts
type ApprovalPreview = {
  operationId: string;
  provider: Provider;
  toolName: string;
  action: "create" | "update" | "delete" | "cancel" | "send" | "download";
  target: {
    customerId?: string;
    customerName?: string;
    chargeId?: string;
    saleId?: string;
    installmentId?: string;
  };
  changes: Array<{ field: string; from?: string; to: string }>;
  irreversible: boolean;
  rollbackNote: string;
};
```

## Operation Lifecycle

1. Parse user request.
2. Resolve provider and tool candidates.
3. Run read-only discovery tools if needed.
4. Ask the user to disambiguate any customer, charge, sale, category, item, email, phone, value, or due date.
5. Build an approval preview for side effects.
6. In `dry-run`, stop after preview and receipt.
7. In `live`, require explicit confirmation for that operation ID.
8. Execute the mapped HTTP request.
9. Save artifacts and raw redacted response summaries.
10. Write final ledger status and return a receipt.

## MVP Tool Contracts

### Read-only tools

- `asaas.search_customers({ query, refreshCache? }) -> CustomerMatch[]`
- `asaas.list_pending_charges({ customerId }) -> PendingCharge[]`
- `asaas.get_charge_links({ chargeId }) -> ChargeLinks`
- `contaazul.list_accountancy_clients() -> AccountancyClient[]`
- `contaazul.search_financial_statement({ relationId, query }) -> FinancialStatementItem[]`
- `contaazul.search_customer_for_sale({ relationId, query }) -> SaleCustomerMatch[]`

These can run without approval but must redact session data and log the operation.

### Mutating tools

- `asaas.update_charge_due_date({ chargeId, dueDateBr }) -> UpdatedChargeReceipt`
- `asaas.create_boleto_charge({ customerId, valueBr, dueDateBr, description }) -> CreatedChargeReceipt`
- `contaazul.update_due_date_reissue_boleto({ relationId, installmentId, dueDateBr, email }) -> ReissuedBoletoReceipt`
- `contaazul.create_customer({ relationId, person }) -> CreatedCustomerReceipt`
- `contaazul.create_service_sale_and_issue_boleto({ relationId, customerId, categoryId, serviceItemId, description, value, dueDateBr, notification }) -> CreatedServiceSaleReceipt`

These must require approval and produce a receipt. In `dry-run`, they must produce the approval preview and stop before any write request.

## Data Types To Normalize First

- `CustomerMatch`: `{ id, name, document?, email?, phone?, providerRawRef? }`
- `PendingCharge`: `{ id, customerId, customerName?, valueBr, dueDateBr, status, description? }`
- `ChargeLinks`: `{ chargeId, boletoUrl?, invoiceUrl?, externalToken? }`
- `AccountancyClient`: `{ relationId, tenantId, name, document?, active }`
- `FinancialStatementItem`: `{ id, financialEventId, description, value, dueDateIso?, customerName?, status?, installmentId? }`
- `SaleCustomerMatch`: `{ id, name, document?, email?, billingEmail?, billingPhone? }`
- `Receipt`: always wrapped by `ToolReceipt<T>`.

## Agent Behavior Rules

The orchestrator should:
- Identify provider and intent from the user request.
- Ask only for missing required fields.
- Never infer a customer when multiple matches exist.
- Never execute a mutating tool without a preview and explicit user confirmation.
- Prefer existing customer/entity selection over creating duplicates.
- Treat boleto PDFs and links as artifacts.
- Explain failures in operational terms: expired session, endpoint changed, validation error, target not found, rate limit, or provider-side rejection.
- Keep provider-specific credentials out of prompts, traces, and tool outputs.

## Implementation Tasks

### Task 0: Freeze Current Mapped Endpoints

**Files:**
- Create: `docs/mapped-endpoints.md`
- Read-only references: `cobrancas/asaas_cobrancas.js`, `cobrancas/interativo.js`, `contaazul/interativo.js`

- [x] Create an endpoint inventory with one row per mapped endpoint: provider, method, URL/path, purpose, source file/function, auth source, mutates state, expected response type, artifact output.
- [x] Mark every mutating endpoint as `requiresApproval: true`.
- [x] Mark every parsing dependency: HTML table, JSON body, hidden input, redirect cookie, PDF response, or polling loop.
- [x] Run `rg -n "fetch\\(|https://|/payment|services.contaazul|contaazul-bff|finance-pro|customerAccount" -S -g "!node_modules/**" .` and reconcile every relevant result into `docs/mapped-endpoints.md`.
- [x] Expected result: the document contains all Asaas and Conta Azul endpoints currently used by the working scripts, with no official provider API/webhook/MCP endpoint added.

### Task 1: Bootstrap TypeScript Harness

**Files:**
- Create: `.gitignore`
- Create: `tsconfig.json`
- Modify: `package.json`
- Create: `src/core/config.ts`
- Create: `src/core/tool-types.ts`
- Create: `src/cli.ts`

- [x] Add TypeScript, Zod, tsx, Vitest, and Node types:
  - Run: `npm install zod`
  - Run: `npm install -D typescript tsx vitest @types/node`
- [x] Add scripts:
  - `npm run dev -- "pedido do usuario"`
  - `npm run test`
  - `npm run typecheck`
- [x] Implement `src/core/config.ts` with separate provider session paths:
  - `ASAAS_ENV_PATH`, default `.env`
  - `CONTAAZUL_ENV_PATH`, default `contaazul/.env`
  - `CONTAAZUL_STATE_PATH`, default `contaazul/state.json`
  - `ARTIFACTS_DIR`, default `artifacts/`
  - `LEDGER_PATH`, default `artifacts/ledger/operations.jsonl`
  - `RUNTIME_MODE`, default `dry-run`
  - `ALLOW_LIVE_MUTATIONS`, default `false`
- [x] Implement `src/core/tool-types.ts` with the shared `ToolReceipt`, `Artifact`, and `ApprovalPreview` contracts from this plan.
- [x] Implement `src/cli.ts` as a thin entrypoint that accepts a user request string, `--dry-run`, and `--live`; default to dry-run.
- [x] Add `.gitignore` entries for `.env`, `*.env`, `state.json`, `artifacts/`, `downloads/`, `*.pdf`, `*.png`, unsanitized capture logs, and `node_modules/`.
- [x] Run `npm run typecheck`.
- [x] Expected result: TypeScript compiles before any provider logic exists.

### Task 2: Add Redacted HTTP Client and Ledger

**Files:**
- Create: `src/core/http-client.ts`
- Create: `src/core/ledger.ts`
- Create: `src/core/redaction.ts`
- Create: `src/core/dry-run.ts`
- Test: `tests/core/redaction.test.ts`
- Test: `tests/core/ledger.test.ts`

- [x] Add redaction for `Cookie`, `Authorization`, `x-authorization`, `accountancy-token`, `auth-token`, `redirect_token`, `LOGIN`, `SENHA`, emails, phone numbers, CPF/CNPJ, and full session values.
- [x] Add `requestWithRetry` with timeout, 429 handling, and exponential backoff.
- [x] Add JSONL ledger append with `operationId`, provider, tool, status, timestamps, redacted args, redacted response summary.
- [x] Add `assertLiveMutationAllowed({ runtimeMode, allowLiveMutations, approvedOperationId, operationId })` that throws unless `runtimeMode === "live"`, `allowLiveMutations === true`, and `approvedOperationId === operationId`.
- [x] Add approval parser that accepts only exact text `APROVAR <operationId>` for live mutations.
- [x] Unit test redaction, dry-run blocking, and ledger writes.
- [x] Expected result: mutating code cannot accidentally write in default mode.

### Task 3: Extract Asaas Read Tools

**Files:**
- Create: `src/modules/asaas/client.ts`
- Create: `src/modules/asaas/parsers.ts`
- Create: `src/modules/asaas/tools.ts`
- Test: `tests/modules/asaas/parsers.test.ts`

- [x] Port customer search/cache behavior from `cobrancas/interativo.js`.
- [x] Port pending charge parsing from `obterCobrancasPendentes`.
- [x] Port boleto/fatura link extraction from `obterLinksBoleto`.
- [x] Use sanitized fixtures derived from existing saved HTML/JSON where possible; remove cookies, tokens, emails, phone numbers, CPF/CNPJ, and real customer identifiers unless explicitly needed as masked test values.
- [x] Verify output shape is stable and does not leak cookies.
- [x] Expected result: `asaas.search_customers`, `asaas.list_pending_charges`, and `asaas.get_charge_links` return normalized data without console parsing.

### Task 4: Extract Asaas Mutating Tools

**Files:**
- Modify: `src/modules/asaas/tools.ts`
- Create: `src/core/approval.ts`
- Test: `tests/modules/asaas/tools.test.ts`

- [x] Port due date update behavior from `salvarVencimento`.
- [x] Port boleto charge creation behavior from `criarCobrancaParaCliente`.
- [x] Port PDF download behavior from `baixarPDFBoleto`.
- [x] Require approval preview before sending POST.
- [x] Store boleto PDFs under `artifacts/asaas/<operationId>/`.
- [x] In dry-run mode, return the planned endpoint, redacted payload, target charge/customer, and expected artifact names without writing to Asaas.
- [x] Expected result: Asaas mutations are impossible without approval and live mode.

### Task 5: Extract Conta Azul Session and Read Tools

**Files:**
- Create: `src/modules/contaazul/client.ts`
- Create: `src/modules/contaazul/tools.ts`
- Create: `src/modules/contaazul/parsers.ts`
- Modify: `src/core/session-store.ts`
- Test: `tests/modules/contaazul/session.test.ts`

- [x] Port `obterClientes`.
- [x] Port `obterAuthTokenClienteHTTP`.
- [x] Port `obterMovimentacoes`.
- [x] Add explicit session-expired detection and a user-facing recapture instruction.
- [x] Add provider session health checks that block when Conta Azul session cookies/state are missing, expired, or loaded from the wrong path.
- [x] Log session switch as an operation, but redact all tokens.
- [x] Expected result: Conta Azul client selection, Pro session switching, and financial statement search work as read-only tool calls.

### Task 6: Extract Conta Azul Mutating Flows

**Files:**
- Modify: `src/modules/contaazul/tools.ts`
- Test: `tests/modules/contaazul/tools.test.ts`

- [x] Port update/reissue boleto flow from `processarFluxoLancamento`.
- [x] Port create customer flow as a structured payload builder.
- [x] Port create service sale and issue boleto flow from `criarVendaServicoFluxo`.
- [x] Move hardcoded defaults into config:
  - financial account ID
  - default reply-to email
  - default company display name
- [x] Require approval before every POST/PATCH that changes Conta Azul state.
- [x] Replace interactive prompts inside the flow with structured required inputs and orchestrator questions.
- [x] In dry-run mode, build the exact planned payloads and polling plan without sending POST/PATCH requests.
- [x] Expected result: Conta Azul boleto reissue and new service-sale boleto flows produce receipts and artifacts.

Note: the service-sale live flow now creates the sale after exact approval, polls the mapped financial-event endpoint for the generated installment, issues the boleto with the real installment ID/version, polls the summary for the charge URL, sends the notification, and stores the downloaded PDF artifact.

### Task 7: Add Orchestrator Agent

**Files:**
- Create: `src/agent/orchestrator.ts`
- Create: `src/agent/instructions/orchestrator.md`
- Create: `src/agent/instructions/asaas.md`
- Create: `src/agent/instructions/contaazul.md`

- [x] Register read tools and mutating tools with schemas.
- [x] Implement intent routing:
  - Asaas customer/charge actions.
  - Conta Azul client/statement/sale/boleto actions.
- [x] Add missing-field questions.
- [x] Add approval interruption flow for side effects.
- [x] Return a final receipt with artifact paths and operation IDs.
- [x] Add provider boundary instruction: never suggest or call official provider APIs, provider webhooks, or provider MCPs.
- [x] Expected result: the CLI can handle a natural-language request and route it to dry-run tool previews.

### Task 8: Add MVP Validation Suite

**Files:**
- Create: `tests/e2e/dry-run.test.ts`
- Create: `tests/fixtures/README.md`
- Create: `docs/runbook.md`

- [x] Add dry-run tests for each mutating tool.
- [x] Add parser tests using sanitized captured HTML/JSON fixtures.
- [x] Add a manual runbook for session recapture and safe test data.
- [x] Add a "no live mutation" CI/default mode so tests cannot accidentally call live endpoints.
- [x] Add a smoke test that asserts official-provider keywords are blocked in tool registry names: `official`, `oauth`, `webhook`, `asaas_mcp`, `contaazul_mcp`.
- [x] Add a smoke test that asserts mutating tools fail unless both `--live` and `ALLOW_LIVE_MUTATIONS=true` are present and approval text matches `APROVAR <operationId>`.
- [x] Expected result: `npm run test` passes without live provider calls.

## MVP Acceptance Criteria

- A user can ask for one of the known flows in natural language through the CLI.
- The agent asks for missing fields and disambiguates customers/entities.
- Read-only tools run without exposing session tokens.
- Mutating tools produce an approval preview and wait for explicit confirmation.
- Every tool call writes a ledger entry.
- Every generated boleto PDF/link is saved as an artifact and returned in the final receipt.
- Existing JS scripts remain available as fallback/manual probes.
- Adding a new module means adding a new `src/modules/<provider>/tools.ts`, instruction file, schemas, and tests without rewriting the orchestrator.

## Future Extensions

- Expose the typed tool registry as a private local MCP server once approvals and redaction are stable, if an MCP boundary helps other agents/clients.
- Add a lightweight web UI only after the CLI harness proves the business flows.
- Add scheduled polling/check routines using mapped HTTP endpoints where the operation needs async follow-up.
- Add new provider modules only through mapped-session tools, fixtures, approval previews, and ledger entries.
