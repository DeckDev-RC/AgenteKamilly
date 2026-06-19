# Harness Runbook

This MVP is a local orchestration harness for mapped browser-session HTTP flows.
It must not call official Asaas APIs, official Conta Azul APIs/OAuth, provider webhooks, or official provider MCPs.

## Default Mode

The default mode is `dry-run`.

Live mutations require all of these at the same time:

1. `ALLOW_LIVE_MUTATIONS=true`
2. Runtime flag `--live`
3. Exact approval text: `APROVAR <operationId>`

Generic confirmations like `sim`, `ok`, or `pode fazer` are intentionally invalid.

## Commands

From `harness/`:

```powershell
npm run test
npm run typecheck
npm run dev -- --dry-run "buscar cliente no Asaas"
```

Operator output and operation summaries:

```powershell
npm run dev -- --operator --dry-run "criar venda de servico e emitir boleto no Conta Azul" --params '{ ... }'
npm run dev -- --summary op_contaazul_create_service_sale_boleto_workflow_1781903486089_6092b931
npm run dev -- --json --summary op_contaazul_create_service_sale_boleto_workflow_1781903486089_6092b931
```

Use `--operator` for concise human-readable status. Use `--json` for full machine-readable output. Summary reads only the append-only ledger and does not call providers.

Conta Azul service-sale workflow by names:

```powershell
npm run dev -- --dry-run "criar venda de servico e emitir boleto no Conta Azul" --params '{ "tenantId": 3047702, "customerName": "AZUOS ASSESSORIA CONTABIL LTDA", "categoryName": "Honorario contabil mensal", "itemName": "Honorario Contabil", "serviceDescription": "Honorario mensal", "unitValue": 10, "dueDateIso": "2026-06-30", "notification": { "email": "cliente@example.test", "phone": "62999999999", "replyTo": "financeiro@example.test", "companyDisplayName": "MAIS NEGOCIOS" } }'
```

The workflow resolves the Conta Azul Mais tenant, switches to the Pro session, resolves customer/category/service item/operation nature, gets the next sale number, then calls the mapped sale/boleto/notification/PDF tool. The planned receipt includes an `idempotencyKey`; a later live retry with the same logical sale is blocked if a succeeded ledger entry already exists.

Asaas boleto workflow by customer name:

```powershell
npm run dev -- --dry-run "criar boleto no Asaas" --params '{ "customerName": "Cliente Exemplo Ltda", "valueBr": "120,50", "dueDateBr": "20/07/2026", "description": "Honorarios" }'
```

The workflow resolves the customer through the mapped customer table, then calls the mapped boleto creation tool. The planned receipt includes an `idempotencyKey`; a later retry with the same customer/value/due date/description is blocked after a succeeded ledger entry exists.

For a future live operation:

```powershell
$env:ALLOW_LIVE_MUTATIONS="true"
npm run dev -- --live "alterar vencimento da cobranca ..."
```

The tool must still stop on an approval preview and require `APROVAR <operationId>` before any mapped POST/PATCH/DELETE request.

## Session Recapture

Asaas:

1. Refresh the browser session manually.
2. Update the configured `ASAAS_ENV_PATH` with `COOKIE_STRING`.
3. Do not paste the cookie into chat, logs, tests, docs, or artifacts.
4. Run a read-only health check before any live mutation.

Conta Azul:

1. Use `contaazul/capture.js` to refresh the Conta Azul Mais browser session.
2. Confirm `CONTAAZUL_STATE_PATH` points to `contaazul/state.json`.
3. Confirm `CONTAAZUL_ENV_PATH` points to `contaazul/.env` when needed.
4. Run the session-switch read flow for the selected `relationId`.
5. If relation identity is ambiguous, stale, or missing, stop and ask the operator to recapture or select the client again.

## Operator Flow

1. Ask the user for the business action.
2. Run read-only discovery tools to resolve customer, charge, sale, installment, value, due date, email, phone, category, and service item.
3. If there are multiple matches, ask the user to choose. Do not infer.
4. For any side effect, produce an approval preview with:
   - provider
   - operation id
   - target customer/charge/sale/installment
   - exact changes
   - endpoint family
   - rollback limitation
5. In `dry-run`, stop after the preview and ledger receipt.
6. In `live`, require exact approval text.
7. Write a final ledger entry and store artifacts under `artifacts/<provider>/<operationId>/`.

## Side Effects

These always require approval:

- create customer
- edit customer
- delete customer
- create charge
- edit due date
- cancel charge request
- reissue boleto
- create service sale
- send billing notification
- confirm received in cash
- delete anything

Downloads alone are read-only at the provider level, but if a download is part of a create/update/reissue/send flow, the parent operation approval covers it.

## Failure Handling

Use operational error categories:

- `session_missing`: session file or cookie missing.
- `session_expired`: provider rejected the mapped session.
- `wrong_relation`: Conta Azul relation/client is not the intended one.
- `endpoint_changed`: mapped HTML/private JSON shape changed.
- `validation_error`: user input is missing or invalid.
- `target_not_found`: customer/charge/installment/sale was not found.
- `rate_limited`: provider returned 429 or equivalent.
- `provider_rejected`: provider returned a validation or business-rule error.

When a mapped endpoint changes, use Playwright or the legacy discovery scripts to remap it, then update tests and `docs/mapped-endpoints.md` before promoting the fix.

## Artifacts And Ledger

Default paths:

- `ARTIFACTS_DIR=artifacts`
- `LEDGER_PATH=artifacts/ledger/operations.jsonl`

Rules:

- Ledger is append-only.
- Store raw provider data only if redacted or operationally necessary.
- PDFs and HTML snapshots belong in artifacts, not tests.
- Sanitized fixtures live in `tests/fixtures/`.
- Never store cookies, auth tokens, passwords, full emails, phones, CPF/CNPJ, or full session state in fixtures.

## Adding A New Module

Each new module should add:

1. `src/modules/<provider>/client.ts`
2. `src/modules/<provider>/parsers.ts`
3. `src/modules/<provider>/tools.ts`
4. Agent instruction file under `src/agent/instructions/`
5. Sanitized fixtures under `tests/fixtures/<provider>/`
6. Parser and dry-run tests
7. Endpoint rows in `docs/mapped-endpoints.md`

Keep provider-specific behavior inside module tools. The orchestrator should route, ask questions, request approvals, and return receipts.
