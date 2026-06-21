# Confere Desktop MVP Design

## Status

Approved design for the MVP specification. This document intentionally describes product and architecture decisions only; implementation planning comes next.

## Product Name

The MVP product name is **Confere**.

The name must be used as a single, neutral product identity. It must not depend on any person-specific brand. The tone should feel natural for Brazilian operators: short, easy to say, and aligned with checking, validating, and approving financial work.

## Goal

Build a local desktop MVP that turns the existing harness into a presentable, real operational product. The app must support a guided demo for clients, partners, and internal operators while keeping the existing safety model: agent planning in dry-run, live execution only after explicit human approval, local audit artifacts, idempotency, and redaction.

The MVP must create a professional "wow" effect without pretending to be a finished multi-user SaaS platform.

## Non-Goals

- Do not use official APIs, official webhooks, or official MCPs from Asaas or Conta Azul.
- Do not deploy the product to cloud for this MVP.
- Do not build login, multi-user permissions, or organization management.
- Do not build a complete financial dashboard.
- Do not expose all mapped low-level endpoints as UI actions.
- Do not let the model call provider-level tools directly.
- Do not replace the existing CLI/harness safety mechanisms.

## Chosen Approach

Use **Electron + a local harness API**.

The Confere desktop app will run locally on the operator's machine. The UI will be an Electron desktop shell with a React/Vite renderer. The UI will not talk directly to Conta Azul, Asaas, Gemini, or mapped HTTP endpoints. It will call a thin local API exposed by the harness.

High-level flow:

```text
Confere UI
  -> local harness API
  -> safe workflow router
  -> existing workflow tools
  -> mapped HTTP/session scripts
  -> ledger and artifacts
```

This preserves the current trust boundary. The UI becomes a product layer on top of the hardened harness, not a second implementation of financial automation.

## Initial Code Boundaries

The expected boundaries are:

- `harness/src/server`: local HTTP or IPC-facing API used by the desktop app.
- `harness/src/desktop`: Electron main process and preload bridge.
- `harness/src/ui`: React/Vite renderer.
- `harness/src/agent`: existing agent planning and conversational logic.
- `harness/src/modules`: existing workflow modules for Conta Azul and Asaas.
- `harness/src/ledger`: existing ledger, redaction, idempotency, summaries, and operation history.

The exact file split can be adjusted during implementation planning, but the core rule is fixed: the renderer consumes product-level workflow APIs only.

## Screens

### Start

The app opens directly into an operational shell, not a marketing landing page. The start screen lets the operator choose the module:

- Conta Azul
- Asaas
- Operações
- Sessões

It also shows compact status signals:

- current mode: dry-run or live enabled
- Conta Azul session status
- Asaas session status
- model quota status
- latest relevant operation or warning

### Conta Azul

The MVP Conta Azul screen focuses on the proven workflow: service sale plus boleto.

The screen combines a conversational input with structured field review. The operator can ask in natural language, and the app shows extracted fields, missing fields, dry-run status, and the next allowed action.

Required MVP fields include tenant/company, customer, financial category, item, service description, unit value, due date, and notification contact data.

### Asaas

The MVP Asaas screen follows the same interaction model, focused on cobrança/boleto generation through the existing mapped-session harness path.

The first version should cover the safest, most demonstrable billing workflow rather than every mapped endpoint.

### Operações

The operations screen reads from the ledger and artifacts. It should make it easy to inspect:

- operation id
- module
- workflow
- status
- created sale or charge references
- invoice or boleto links
- local PDF path when available
- warnings
- duplicate/idempotency signals
- orphaned-operation signals
- approval state

It should include a compact operation summary view so the operator does not need to open JSONL or artifact JSON files manually.

### Sessões

The sessions screen is an operator-facing technical panel. It should show whether required local sessions and environment settings are present without exposing secret values.

It should include:

- Conta Azul session health
- Asaas session health
- live mutation guard state
- Gemini/free-tier quota state
- artifacts directory status
- latest recoverable error

## Interaction Model

Confere is an operational assistant, not a generic chat app.

The agent should:

- identify the likely module and workflow
- use only workflow-level tools
- extract fields from the operator request
- use short local memory for fields already collected
- ask only for missing fields
- summarize the plan before execution
- avoid offering actions that do not exist in the harness

The UI should show both the conversational response and the structured state of the operation. The operator should always be able to see what will happen before approving execution.

## Approval Flow

The approval flow has two visible stages.

### Prepare

The operator asks for an operation. The agent collects fields and runs the workflow in dry-run. The output includes:

- operation id
- module and workflow
- fields used
- planned actions
- expected side effects
- risk/warning state
- duplicate/idempotency status when known

### Execute

When the plan is complete, the UI shows a contextual action button such as:

- `Executar venda e gerar boleto`
- `Executar cobrança`
- `Abrir boleto`
- `Copiar link`
- `Ver resumo técnico`

Live execution requires a final confirmation sheet. The confirmation sheet must show the relevant business facts: tenant/company, customer, value, due date, item or description, workflow, warnings, and idempotency state.

When the operator clicks the final approval button, the UI sends the equivalent of:

```text
APROVAR <operationId>
```

The operator should not need to type this token in the primary UI, but the backend must preserve the same audit semantics as the CLI.

If the operation is blocked by duplicate detection, orphan handling, invalid session, missing fields, or high-risk state, the primary action should be disabled or replaced by a safer review action.

## Data and Privacy

The MVP continues using controlled free-tier Gemini access for planning, with the existing minimization protections.

Rules:

- Keep provider secrets out of UI output, logs, and summaries.
- Do not send raw stored `knownParams` with PII to the model.
- Keep low-level tool details hidden from model-visible capabilities.
- Keep ledger output redacted.
- Store live handoff data outside the redacted ledger when exact values are needed for execution.
- Treat local drafts as sensitive data.

For the MVP, live handoff should use either in-memory state for the active operation or a protected local draft store. The implementation must not reconstruct sensitive fields from redacted ledger entries.

## Visual Direction

Use a **Finance OS claro** visual direction.

The app should feel professional, calm, and operational:

- light interface
- dense but readable layouts
- restrained colors
- clear status indicators
- tables and split panes for scanning
- contextual icon/text buttons
- no marketing-style landing page
- no decorative heavy gradients or overly playful visuals

The design should work for three audiences in the same presentation: the accounting company/client, a partner or investor, and the internal operator.

## MVP Scope

Included:

- local Electron desktop app
- React/Vite renderer
- local harness API
- module chooser
- Conta Azul service sale plus boleto workflow
- Asaas cobrança/boleto workflow
- conversational field collection
- dry-run planning
- contextual live approval button
- operation history and summary
- session and quota panel
- workflow-only model exposure
- minimal protected handoff state

Excluded:

- cloud deployment
- multi-user login
- role-based permissions
- recurring scheduled automations
- full financial analytics dashboard
- official provider APIs, webhooks, or MCPs
- broad low-level endpoint explorer

## Presentation Success Criteria

The MVP is ready for presentation when an operator can:

1. Open Confere locally.
2. Pick Conta Azul or Asaas.
3. Ask for a real supported operation in natural language.
4. See only missing fields requested.
5. Review a complete dry-run plan.
6. Approve live execution through a contextual button.
7. See the resulting boleto, PDF, or invoice link.
8. Open the operation summary from history.
9. Explain that the model never receives low-level tools and never bypasses human approval.

## Testing Strategy

Implementation planning should include:

- unit tests for local API request/response contracts
- tests proving only workflow tools are exposed to model-facing code
- tests for dry-run to live handoff behavior
- tests for button approval mapping to `APROVAR <operationId>`
- tests for blocked states: duplicate, orphan, missing session, missing fields, and high-risk plans
- renderer tests for field collection and contextual actions where practical
- at least one controlled manual demo run per provider before presentation

## Open Implementation Notes

- Electron is chosen for the MVP. Tauri can remain a future option after the product flow is validated.
- The local API may be HTTP or IPC-backed; the implementation plan should choose the simplest approach that keeps boundaries testable.
- The UI should not require the operator to read JSON artifacts, but artifacts remain available for audit.
- `.superpowers/` brainstorming artifacts are local scratch data and should not be committed as product source.
