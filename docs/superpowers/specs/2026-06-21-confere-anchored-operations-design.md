Confere — Anchored Operations & Unified Grounded-Choice Resolver Design

## Status

Approved design (brainstorming, 2026-06-21). Builds on the living-assistant UI redesign
(`2026-06-21-confere-ui-redesign-design.md`). This spec covers backend flow logic + renderer
changes. The safety model (dry-run first, `APROVAR <operationId>` gate) is unchanged.

## Problem

The assistant exposes only a vague free-text box, and grounded choice (search-and-pick of
empresa / cliente / categoria / item) is implemented **twice**, in two places that do not share
state:

- **(A) Backend** — `src/server/interactive-flow-controller.ts`, a deterministic state machine
  that emits option chips via `result.choices` and keeps `relationId`/slots server-side.
- **(B) Frontend** — `InlineSearchField` / `TenantSelector` in `src/ui/screens/AssistantScreen.tsx`,
  which call `window.confere.search*` directly and keep `relationId` in React state.

Observed bug (the "confusing interaction"): a tenant chosen through the **backend** chip flow
leaves the **React** `relationId` undefined. When the backend then asks for `customerId`, the
frontend matches that field name in its `isSearchField` list and tries to render its **own**
search box, which checks the React `relationId`, finds it empty, and prints the contradictory
warning *"⚠️ Selecione a empresa acima primeiro"* — even though the empresa is already selected.
A zero-result search also advances to an empty choice step ("Encontrei 0 cliente(s)…") instead of
re-prompting.

Separately, the four operations the product wants surfaced explicitly are not all reachable:

| Operation | Final tool | State today |
| --- | --- | --- |
| Mudar boleto · Asaas (vencimento) | `asaas.update_charge_due_date` | tool exists (full dry-run + live gate); **no flow, no entry, not in live allowlist** |
| Emitir boleto · Conta Azul | `contaazul.create_service_sale_boleto_workflow` | complete (flow + allowlists + starter) |
| Criar cliente · Conta Azul | `contaazul.create_customer_workflow` | in safe registry + starter + follow-up UI, but **not in `LIVE_APPROVAL_TOOL_ALLOWLIST`** (live exec would be blocked) and the post-create boleto hand-off re-searches and ignores the new customer |
| Mudar vencimento · Conta Azul | `contaazul.update_due_date_reissue_boleto_workflow` | tool exists; only reachable via the extrato "Alterar Vencimento" button; **not in safe registry / live allowlist** → not executable via the agent path |

So two of the four "explicit functions" are tools that exist but were never wired through; the
work is plumbing + an interactive flow, not new business logic.

## Decisions

1. **Form factor — Approach A (backend-authoritative).** The interactive-flow-controller is the
   single source of truth for grounded choice. All choices arrive as `result.choices` chips,
   already searched server-side. The frontend renders chips + free-text fields only.
2. **Four explicit anchored entry points** replace the current four free-text starter chips. Each
   starts its backend flow deterministically (via an `__interactive` marker), not by regex-guessing
   free text. Explicit names: **Mudar boleto · Asaas**, **Emitir boleto · Conta Azul**,
   **Criar cliente · Conta Azul**, **Mudar vencimento · Conta Azul**.
3. **"Mudar boleto Asaas" = due date only** — reuses the existing `asaas.update_charge_due_date`
   (no new endpoint).
4. **"Criar cliente" collection = deterministic flow** in the controller (not LLM slot-filling),
   for consistency with Approach A, testability, and a clean hand-off.

## Architecture — unified grounded-choice resolver

`interactive-flow-controller.ts` remains the entry point of `runAgentTurn` (tried before the LLM
planner). It gains:

- An **anchor entry**: a new marker `{ __interactive: { flow: "anchor", action } }` with
  `action ∈ { start_asaas_update_due_date, start_contaazul_service_sale,
  start_contaazul_create_customer, start_contaazul_update_due_date }`. Each anchor seeds the
  corresponding flow state and returns its first step. Free-text fallbacks
  (`looksLikeContaAzulServiceBoletoRequest`, provider choice) stay for typed requests.
- Two **new flows** (`InteractiveFlowName` union extended): `asaas_update_charge_due_date` and
  `contaazul_update_due_date`. The existing `contaazul_service_sale_boleto` and
  `asaas_boleto_charge` flows are reused; a new deterministic `contaazul_create_customer` flow is
  added.
- A shared **empty-result rule**: every search step, when its tool returns zero rows, stays on the
  same step and returns `needs_input` with a "não encontrei … tenta outro termo" message — never an
  empty `customerChoice`/`chargeChoice` step.

`relationId` lives only in the flow `slots`. The renderer no longer holds or sends
`tenantId/relationId/tenantName`.

## The four anchored operations

### 1. Mudar boleto · Asaas — `asaas_update_charge_due_date` (new)
Steps: `asaasCustomerSearch` → `asaas.search_customers` → chips → `chargeChoice`
(`asaas.list_pending_charges` by customerId; chip label = descrição, sub = valor + vencimento
atual) → `newDueDate` (collect DD/MM/AAAA, validated) → call `asaas.update_charge_due_date`
(dry-run `planned`) → draft + PlanCard + confirmation sheet → `APROVAR`.
Wiring: add `asaas.update_charge_due_date` to `LIVE_APPROVAL_TOOL_ALLOWLIST`. (Already emits
`approvalPreview` + `blockIfNotApproved`; no workflow wrapper needed.)

### 2. Emitir boleto · Conta Azul — `contaazul_service_sale_boleto` (reuse)
Unchanged flow. New: an anchor entry, plus a **pre-seeded entry** `start_with_customer` that sets
`slots = { tenantId, relationId, customerId, customerName }` and jumps to `categorySearch`, used by
the create-customer hand-off (§4).

### 3. Criar cliente · Conta Azul — `contaazul_create_customer` (new, deterministic)
Steps: `tenant` chip (reuses `list_accountancy_clients` + `switch_to_pro_session`) →
ordered field collection → plan `contaazul.create_customer_workflow` (dry-run) → confirm → on live
success, render the boleto offer (§4).
Field order with PF/PJ branching:
`personType` (chip: Física / Jurídica) → `document` (CPF or CNPJ, validated by personType) →
`name` (PF) **or** `companyName` + `name` (PJ) → `email` → `cellPhone` → `commercialPhone`
(optional) → address (`zipcode` → `street` → `numberAddress` → `neighborhood` → `complement`
optional) → `billingEmail`/`billingPhone` (default to the contact email/phone with a confirm).
Each non-search field is plain text in the composer; `personType` is a chip step. Required vs
optional follows `ContaAzulCreateCustomerWorkflowParamsSchema` — the flow reads the schema's
required keys so the two stay in sync.
Wiring: add `contaazul.create_customer_workflow` to `LIVE_APPROVAL_TOOL_ALLOWLIST`.

### 4. Mudar vencimento · Conta Azul — `contaazul_update_due_date` (new)
Steps: `tenant` chip → `statementSearch` (`contaazul.search_financial_statement`; chip label =
cliente + descrição, sub = valor + vencimento atual; carries `financialEventId`/`installmentId`) →
`newDueDate` → plan `contaazul.update_due_date_reissue_boleto_workflow` (dry-run) → confirm →
`APROVAR`.
Wiring: add `contaazul.update_due_date_reissue_boleto_workflow` to `LIVE_APPROVAL_TOOL_ALLOWLIST`.
The rich extrato table (`AssistantResultMessage`) may be reused to display results, but its
"Alterar Vencimento" action routes through this flow rather than a free-text agent turn.

## Create-customer → boleto hand-off

On successful **live** creation, `create_customer_workflow` exposes `resolved` (customerId +
customerName; tenant is known from the flow slots). The UI follow-up "Sim, emitir boleto" sends the
marker `{ __interactive: { flow: "contaazul_service_sale_boleto", action: "start_with_customer" } }`
with params `{ tenantId, relationId, customerId, customerName }`, so the boleto flow seeds those
slots and opens at `categorySearch`, skipping empresa + customer search. "Não, apenas cadastrar"
ends the turn.

## Frontend changes (`AssistantScreen.tsx`)

- **Remove** `InlineSearchField`, `TenantSelector`, the `isSearchField`/`isTenantField`
  special-casing in `QuestionChecklist`, and the React `tenantId/relationId/tenantName` state +
  `onSelectTenant`. Stop merging tenant params into every `prepare()` turn.
- **Render** `result.choices` as chips (already present) for every grounded choice; non-search
  missing fields render as the normal composer prompt.
- **Starter grid** = the four anchored buttons; each calls `prepare(label, { __interactive: { flow:
  "anchor", action } })`.
- **Zero-result** turns render the re-prompt text, not an empty choice list.
- Keep the customer-created follow-up block; repoint its "Sim" to the pre-seeded anchor.

## Safety / wiring summary

- `LIVE_APPROVAL_TOOL_ALLOWLIST` (`confere-service.ts`) gains: `contaazul.create_customer_workflow`,
  `contaazul.update_due_date_reissue_boleto_workflow`, `asaas.update_charge_due_date`.
- `SAFE_AGENT_TOOL_NAMES` (LLM planner registry) unchanged — the four anchored flows are
  deterministic and do not depend on the LLM; the LLM path stays as a free-text fallback.
- Dry-run-first, confirmation sheet, and `APROVAR <operationId>` injection are unchanged for all
  four operations. No new IPC method; the existing `window.confere` surface is sufficient.

## Testing strategy

- **`interactive-flow-controller.test.ts`**: anchor entry seeds each flow; each new flow's step
  transitions (search → chips → collect → plan); the zero-result re-prompt loop for every search
  step; the create-customer PF vs PJ branch; the boleto hand-off pre-seeds slots and opens at
  `categorySearch`.
- **`confere-service.test.ts`**: the three newly allow-listed tools can execute live; all other
  tools remain blocked.
- **`confere-ui.test.tsx`**: renders exactly the four explicit starters; renders choice chips;
  **does not** render `InlineSearchField`/`TenantSelector`; zero-result shows the re-prompt, not an
  empty choice; customer-created success shows the boleto offer and "Sim" dispatches the pre-seeded
  anchor.
- `pixelyn-state` and backend safety-gate tests unchanged.

## Build order

1. Unify on the backend: remove the frontend duplicate search + tenant state; render chips only;
   add the shared zero-result re-prompt. (Kills the confusing interaction.)
2. Anchor entry + the four explicit starter buttons.
3. New flows: `asaas_update_charge_due_date`, `contaazul_update_due_date` + their allowlist entries.
4. Deterministic `contaazul_create_customer` flow + allowlist entry + the boleto hand-off
   (pre-seeded `start_with_customer`).

## Non-goals

- No backend safety-model change; no new providers; no official APIs/OAuth/webhooks.
- No editing of Asaas charge value/description (due date only); no cancel-and-reissue.
- No live type-ahead search — grounded choice is "type a term → backend returns chips", matching the
  legacy wizard.

## Items to verify during implementation

- `contaazul.search_financial_statement` parameter shape (relationId + search term vs. list pendentes)
  and the `financialEventId`/`installmentId`/`installmentVersion` fields needed by
  `update_due_date_reissue_boleto_workflow`.
- `asaas.list_pending_charges` parameter shape (customerId) and the chip fields available
  (descrição, valor, vencimento).
- `create_customer_workflow.resolved` payload shape (must yield customerId + customerName for the
  hand-off).
- `ContaAzulCreateCustomerWorkflowParamsSchema` required-vs-optional keys, to drive the deterministic
  field order without drift.
