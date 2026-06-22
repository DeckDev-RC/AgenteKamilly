# Confere Anchored Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four ERP operations (mudar boleto Asaas, emitir boleto Conta Azul, criar cliente Conta Azul, mudar vencimento Conta Azul) explicit anchored entry points driven by a single backend grounded-choice resolver, removing the duplicate frontend search that caused the contradictory "selecione a empresa" warning.

**Architecture:** `src/server/interactive-flow-controller.ts` is the single source of truth: deterministic flows that search server-side and emit `result.choices` chips. The renderer becomes dumb (renders chips + text). Two existing-but-unwired tools (`asaas.update_charge_due_date`, `contaazul.update_due_date_reissue_boleto_workflow`) get interactive flows; `create_customer` becomes a deterministic flow with a boleto hand-off. Dry-run + `APROVAR` gate unchanged; the only safety wiring change is three additions to `LIVE_APPROVAL_TOOL_ALLOWLIST`.

**Tech Stack:** TypeScript, Zod, Vitest (backend `npm run test`), jsdom + `renderToString` (UI `npm run test:ui`), React (renderer).

**Reference spec:** `docs/superpowers/specs/2026-06-21-confere-anchored-operations-design.md`

**Conventions (from the existing code, reuse verbatim):**
- Controller test harness: `tests/server/interactive-flow-controller.test.ts` — `createToolRegistry()`, `registry.register({ name, description, parameters: z.object(...), execute })`, the local `receipt(toolName, data)` helper, and `runInteractiveFlowTurn({ request, registry, sessionId, store, params })`.
- A search/choice step returns `needsInput({ summary, missingFields, questions, choices })`; a chip carries `params.__interactive = { flow, action }` plus the resolved ids.
- A planning step returns `{ handled: true, draftOperationId, draft, result: { status: "executed", receiptStatus: "planned", approvalAvailable: true, ... } }` when the tool receipt `status === "planned"` (see `collectAsaasDescriptionAndPlan`).
- Run a single backend test file: `npm run test -- interactive-flow-controller`. Run all backend: `npm run test`. Typecheck: `npm run typecheck`. UI: `npm run test:ui`.
- The benign `check-sql-files.py` PostToolUse hook errors on every Edit/Write — ignore it.

---

## Phase 1 — Unify on the backend, kill the confusing interaction

### Task 1: Zero-result searches re-prompt instead of showing an empty choice list

**Files:**
- Modify: `src/server/interactive-flow-controller.ts` (`searchCustomers`, `searchCategories`, `searchServiceItems`, `searchAsaasCustomers`)
- Test: `tests/server/interactive-flow-controller.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the top-level `describe`)

```ts
it("re-prompts the customer search when no Conta Azul customer matches", async () => {
  const store = createInteractiveFlowStore();
  const registry = createToolRegistry();
  registerTenantTools(registry);
  registry.register({
    name: "contaazul.search_sale_customers",
    description: "Search customers",
    parameters: z.object({ relationId: z.string(), searchTerm: z.string() }),
    execute: async () => receipt("contaazul.search_sale_customers", [])
  });

  await startAndSelectTenant(store, registry);

  const result = await runInteractiveFlowTurn({
    request: "Irani",
    registry,
    sessionId: "sess_contaazul",
    store
  });

  expect(result.handled).toBe(true);
  if (!result.handled) throw new Error("expected handled result");
  expect(result.result).toMatchObject({
    status: "needs_input",
    missingFields: ["customerSearch"],
    questions: ['Não encontrei ninguém com "Irani". Tente outro nome.']
  });
  expect(result.result.choices ?? []).toEqual([]);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm run test -- interactive-flow-controller`
Expected: FAIL — current code advances to `customerChoice` with `missingFields: ["customerId"]` and an empty `choices` array.

- [ ] **Step 3: Implement the re-prompt guard in `searchCustomers`**

In `searchCustomers`, after `const customers = ... ;` and before `state.step = "customerChoice";`, insert:

```ts
  if (customers.length === 0) {
    state.step = "customerSearch";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        summary: `Não encontrei ninguém com "${searchTerm}".`,
        missingFields: ["customerSearch"],
        questions: [`Não encontrei ninguém com "${searchTerm}". Tente outro nome.`]
      })
    };
  }
```

- [ ] **Step 4: Apply the same guard to the other three search steps**

`searchCategories` (stay on `categorySearch`, `missingFields: ["categorySearch"]`):

```ts
  if (categories.length === 0) {
    state.step = "categorySearch";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        summary: `Não encontrei categoria com "${searchTerm}".`,
        missingFields: ["categorySearch"],
        questions: [`Não encontrei categoria com "${searchTerm}". Tente outro nome.`]
      })
    };
  }
```

`searchServiceItems` (stay on `itemSearch`, `missingFields: ["itemSearch"]`):

```ts
  if (items.length === 0) {
    state.step = "itemSearch";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        summary: `Não encontrei item com "${searchTerm}".`,
        missingFields: ["itemSearch"],
        questions: [`Não encontrei item com "${searchTerm}". Tente outro nome.`]
      })
    };
  }
```

`searchAsaasCustomers` (stay on `asaasCustomerSearch`, `missingFields: ["customerSearch"]`, provider `asaas`) — insert after `const customers = ...` and before the `customers.length === 1` block:

```ts
  if (customers.length === 0) {
    state.step = "asaasCustomerSearch";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        toolName: "asaas.interactive_boleto_charge",
        provider: "asaas",
        intent: "create_boleto_charge",
        summary: `Não encontrei ninguém com "${query}".`,
        missingFields: ["customerSearch"],
        questions: [`Não encontrei ninguém com "${query}". Tente outro nome.`]
      })
    };
  }
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm run test -- interactive-flow-controller`
Expected: PASS (new test + all existing controller tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/interactive-flow-controller.ts tests/server/interactive-flow-controller.test.ts
git commit -m "fix(agent): re-prompt search on zero results instead of empty choices"
```

---

### Task 2: Remove the duplicate frontend search (backend chips become the only path)

**Files:**
- Modify: `src/ui/screens/AssistantScreen.tsx` — delete `InlineSearchField`, `TenantSelector`, the `isSearchField`/`isTenantField` branches in `QuestionChecklist`, the `relationId`/`tenantId`/`tenantName` React state + `onSelectTenant`, and the tenant param merge in `prepare()`.
- Test: `tests/ui/confere-ui.test.tsx`

- [ ] **Step 1: Write the failing test** (add to the UI suite)

```tsx
it("renders backend choice chips and not the legacy inline tenant/customer search", () => {
  const result: AgentResultView = {
    status: "needs_input",
    toolName: "contaazul.interactive_service_sale_boleto",
    missingFields: ["customerId"],
    questions: ["Selecione o cliente para esta venda."],
    warnings: [],
    approvalAvailable: false,
    choices: [
      {
        id: "customer:cust_1",
        label: "AZUOS ASSESSORIA CONTÁBIL LTDA",
        description: "Cliente Conta Azul",
        params: {
          __interactive: { flow: "contaazul_service_sale_boleto", action: "select_customer" },
          customerId: "cust_1",
          customerName: "AZUOS ASSESSORIA CONTÁBIL LTDA"
        }
      }
    ]
  };
  const html = renderToString(
    <AssistantResultMessage
      message={{ id: "m1", role: "assistant", result, timestamp: "21:10" }}
      isLatest
      onReview={() => {}}
      onSend={() => {}}
    />
  );
  expect(html).toContain("AZUOS ASSESSORIA CONTÁBIL LTDA");
  expect(html).not.toContain("Selecione a empresa acima primeiro");
  expect(html).not.toContain("Pesquisar cliente por nome");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm run test:ui -- confere-ui`
Expected: FAIL — `QuestionChecklist` renders `InlineSearchField` for `customerId`, which (with no `relationId`) emits "⚠️ Selecione a empresa acima primeiro"; also TS error on the removed props once Step 3 lands.

- [ ] **Step 3: Delete the duplicate-search machinery**

In `AssistantScreen.tsx`:
1. Delete the entire `function TenantSelector(...)` and `function InlineSearchField(...)` definitions.
2. In `QuestionChecklist`, delete `isSearchField`, `isTenantField`, and the two trailing conditional blocks that render `<TenantSelector .../>` and `<InlineSearchField .../>`. Keep only the `question-list__item` row (index, label, friendly question, "pendente" tag).
3. Remove the now-unused props `relationId`, `onSelectTenant`, `onSend` from `QuestionChecklist`'s signature and its call site. (Leave `AssistantResultMessage`'s own `onSend` prop in place for the chip + follow-up buttons.)

`QuestionChecklist` becomes:

```tsx
function QuestionChecklist(props: {
  questions: string[];
  missingFields: string[];
}): ReactElement {
  return (
    <div className="question-list" aria-label="Campos faltantes">
      {props.questions.map((question, index) => {
        const fieldName = props.missingFields[index] ?? `Campo ${index + 1}`;
        return (
          <div className="question-list__item" key={fieldName}>
            <span className="question-list__index">{index + 1}</span>
            <div style={{ flex: 1 }}>
              <strong>{formatField(fieldName)}</strong>
              <p>{getFriendlyQuestion(fieldName, question)}</p>
            </div>
            <span className="question-list__tag">pendente</span>
          </div>
        );
      })}
    </div>
  );
}
```

And its call site in `AssistantResultMessage`:

```tsx
{hasQuestions ? (
  <QuestionChecklist questions={result.questions} missingFields={result.missingFields} />
) : null}
```

- [ ] **Step 4: Drop the React tenant state and the `onSelectTenant`/`relationId` props**

In `AssistantScreen`:
1. Delete `const [tenantId, setTenantId] = useState(...)`, `const [relationId, setRelationId] = useState(...)`, `const [tenantName, setTenantName] = useState(...)`.
2. In `prepare()`, change `mergedParams` to `const mergedParams = { ...customParams };` (drop the tenant fields).
3. In `resetConversation()`, delete the three `setTenantId/setRelationId/setTenantName(undefined)` lines.
4. Remove the `relationId` and `onSelectTenant` props from `AssistantResultMessage`'s props type, and in the `messages.map(...)` render drop `relationId={relationId}` and `onSelectTenant={...}`.

> Note: the tenant chip from the backend (`tenantChoice`) already carries `{ __interactive: select_tenant, tenantId, relationId, tenantName }` in `choice.params`, so clicking it sends those to the backend via `onSend(label, params)` → `prepare()` → `customParams`. The backend stores them in `slots`; the frontend no longer needs them.

- [ ] **Step 5: Run UI tests, verify pass**

Run: `npm run test:ui -- confere-ui`
Expected: PASS. Then `npm run typecheck` — fix any references to the deleted props.

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/AssistantScreen.tsx tests/ui/confere-ui.test.tsx
git commit -m "refactor(ui): backend chips are the only grounded-choice path"
```

---

## Phase 2 — Anchor entry + the four explicit starters

### Task 3: Backend anchor entry seeds the right flow deterministically

**Files:**
- Modify: `src/server/interactive-flow-controller.ts` (add `ANCHOR_FLOW` handling near the top of `runInteractiveFlowTurn`, alongside the existing `PROVIDER_CHOICE_FLOW` branch)
- Test: `tests/server/interactive-flow-controller.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("starts the Conta Azul service-sale flow from the anchor marker", async () => {
  const registry = createToolRegistry();
  registerTenantTools(registry);
  const result = await runInteractiveFlowTurn({
    request: "Emitir boleto · Conta Azul",
    registry,
    sessionId: "sess_anchor",
    store: createInteractiveFlowStore(),
    params: { __interactive: { flow: "anchor", action: "start_contaazul_service_sale" } }
  });
  expect(result.handled).toBe(true);
  if (!result.handled) throw new Error("expected handled result");
  expect(result.result).toMatchObject({ missingFields: ["tenantId"] });
});

it.todo("starts the Asaas update-due-date flow from the anchor marker");
it.todo("starts the create-customer flow from the anchor marker");
it.todo("starts the Conta Azul update-due-date flow from the anchor marker");
```

> The three `it.todo`s become real tests in Tasks 5, 9, and 7 respectively (each task converts its `todo` into a full assertion).

- [ ] **Step 2: Run, verify it fails**

Run: `npm run test -- interactive-flow-controller`
Expected: FAIL — anchor marker is unrecognized; `start_contaazul_service_sale` falls through to `{ handled: false }`.

- [ ] **Step 3: Add the constants, the flow-name union, and the anchor branch**

Near the other flow constants:

```ts
const ANCHOR_FLOW = "anchor";
const ASAAS_UPDATE_FLOW = "asaas_update_charge_due_date";
const CONTAZUL_UPDATE_FLOW = "contaazul_update_due_date";
const CONTAZUL_CREATE_CUSTOMER_FLOW = "contaazul_create_customer";
const ASAAS_UPDATE_TOOL_NAME = "asaas.interactive_update_charge_due_date";
const CONTAZUL_UPDATE_TOOL_NAME = "contaazul.interactive_update_due_date";
const CONTAZUL_CREATE_CUSTOMER_TOOL_NAME = "contaazul.interactive_create_customer";
```

Extend `InteractiveFlowName`:

```ts
type InteractiveFlowName =
  | typeof CONTAZUL_FLOW
  | typeof ASAAS_FLOW
  | typeof ASAAS_UPDATE_FLOW
  | typeof CONTAZUL_UPDATE_FLOW
  | typeof CONTAZUL_CREATE_CUSTOMER_FLOW;
```

In `runInteractiveFlowTurn`, immediately after the `PROVIDER_CHOICE_FLOW` block, add (only the service-sale branch is live this task; the other three are wired in Tasks 5/9/7):

```ts
  if (marker.flow === ANCHOR_FLOW) {
    if (marker.action === "start_contaazul_service_sale") {
      input.store.set(sessionKey, { flow: CONTAZUL_FLOW, step: "tenant", slots: {} });
      return promptContaAzulTenant(input.registry);
    }
    // start_asaas_update_due_date     → Task 5
    // start_contaazul_create_customer → Task 9
    // start_contaazul_update_due_date → Task 7
  }
```

Generalize `tenantChoice` to take the flow (so the chip points at the right flow):

```ts
function tenantChoice(client: AccountancyClient, flow: InteractiveFlowName): AgentChoiceView {
  return {
    id: `tenant:${client.tenantId}`,
    label: client.name,
    description: `Tenant ${client.tenantId}`,
    params: {
      __interactive: { flow, action: "select_tenant" },
      tenantId: client.tenantId,
      relationId: client.relationId,
      tenantName: client.name
    }
  };
}
```

And `promptContaAzulTenant` takes a flow (default `CONTAZUL_FLOW` keeps existing callers/tests green):

```ts
async function promptContaAzulTenant(
  registry: ToolRegistry,
  flow: InteractiveFlowName = CONTAZUL_FLOW
): Promise<InteractiveFlowResult> {
  // ...unchanged lookup/guards...
  return {
    handled: true,
    result: needsInput({
      summary: "Selecione a empresa do Conta Azul antes de continuar.",
      missingFields: ["tenantId"],
      questions: ["Selecione a empresa para esta operação."],
      choices: clients.map((client) => tenantChoice(client, flow))
    })
  };
}
```

- [ ] **Step 4: Run, verify the active test passes**

Run: `npm run test -- interactive-flow-controller`
Expected: PASS for the service-sale anchor test and all existing tests (the existing tenant-choice test still expects `flow: "contaazul_service_sale_boleto"`, which the default arg preserves).

- [ ] **Step 5: Commit**

```bash
git add src/server/interactive-flow-controller.ts tests/server/interactive-flow-controller.test.ts
git commit -m "feat(agent): anchor markers start flows deterministically"
```

---

### Task 4: Four explicit starter buttons in the renderer

**Files:**
- Modify: `src/ui/screens/AssistantScreen.tsx` (`QUICK_PROMPTS` → anchored buttons; the greeting `starter-grid`; the "Atalhos" composer button)
- Test: `tests/ui/confere-ui.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("shows the four explicit anchored operations on the empty conversation", () => {
  const html = renderToString(<AssistantScreen />);
  expect(html).toContain("Mudar boleto · Asaas");
  expect(html).toContain("Emitir boleto · Conta Azul");
  expect(html).toContain("Criar cliente · Conta Azul");
  expect(html).toContain("Mudar vencimento · Conta Azul");
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm run test:ui -- confere-ui`
Expected: FAIL — current `QUICK_PROMPTS` are different strings.

- [ ] **Step 3: Replace the starter definitions**

Replace the `QUICK_PROMPTS` constant with anchored actions:

```tsx
const ANCHORED_OPERATIONS: { label: string; action: string }[] = [
  { label: "Mudar boleto · Asaas", action: "start_asaas_update_due_date" },
  { label: "Emitir boleto · Conta Azul", action: "start_contaazul_service_sale" },
  { label: "Criar cliente · Conta Azul", action: "start_contaazul_create_customer" },
  { label: "Mudar vencimento · Conta Azul", action: "start_contaazul_update_due_date" }
];
```

In the greeting grid, dispatch the anchor marker:

```tsx
<div className="assistant__starter-grid">
  {ANCHORED_OPERATIONS.map((op) => (
    <button
      key={op.action}
      onClick={() =>
        void prepare(op.label, { __interactive: { flow: "anchor", action: op.action } })
      }
      type="button"
    >
      {op.label}
    </button>
  ))}
</div>
```

Update the composer "Atalhos" button that referenced `QUICK_PROMPTS[0]` to `setRequest(ANCHORED_OPERATIONS[0]!.label)`.

- [ ] **Step 4: Run, verify pass**

Run: `npm run test:ui -- confere-ui` then `npm run typecheck`
Expected: PASS, no dangling `QUICK_PROMPTS` references.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/AssistantScreen.tsx tests/ui/confere-ui.test.tsx
git commit -m "feat(ui): four explicit anchored operation starters"
```

---

## Phase 3 — The two unwired operations

### Task 5: Asaas "mudar boleto" (alterar vencimento) flow

**Files:**
- Modify: `src/server/interactive-flow-controller.ts` (new `ASAAS_UPDATE_FLOW`: steps + `promptAsaasUpdateCustomerSearch`, `continueAsaasUpdateFlow`, search/charge/plan helpers; extend the step union, the dispatch, and the Task-3 anchor branch)
- Modify: `tests/server/interactive-flow-controller.test.ts` (replace the `it.todo("starts the Asaas update-due-date flow...")` with the real test below)
- Test: `tests/server/interactive-flow-controller.test.ts`

- [ ] **Step 1: Write the failing test (full flow → dry-run plan)**

```ts
it("runs the Asaas update-due-date flow from anchor through dry-run", async () => {
  const store = createInteractiveFlowStore();
  const registry = createToolRegistry();
  const calls: unknown[] = [];
  registry.register({
    name: "asaas.search_customers",
    description: "Search Asaas customers",
    parameters: z.object({ query: z.string() }),
    execute: async () => receipt("asaas.search_customers", [{ id: "ac_1", name: "JOÃO LTDA" }])
  });
  registry.register({
    name: "asaas.list_pending_charges",
    description: "List pending charges",
    parameters: z.object({ customerId: z.string() }),
    execute: async () =>
      receipt("asaas.list_pending_charges", [
        { id: "ch_1", customerId: "ac_1", valueBr: "150,00", dueDateBr: "10/06/2026", status: "PENDING", description: "Mensalidade" }
      ])
  });
  registry.register({
    name: "asaas.update_charge_due_date",
    description: "Update charge due date",
    parameters: z.object({}).passthrough(),
    execute: async (params) => {
      calls.push(params);
      return {
        ...receipt("asaas.update_charge_due_date", { approvalPreview: { operationId: "op_asaas_update" } }),
        status: "planned"
      } satisfies ToolReceipt;
    }
  });

  await runInteractiveFlowTurn({
    request: "Mudar boleto · Asaas",
    registry, sessionId: "sess_au", store,
    params: { __interactive: { flow: "anchor", action: "start_asaas_update_due_date" } }
  });

  const charges = await runInteractiveFlowTurn({ request: "JOÃO", registry, sessionId: "sess_au", store });
  expect(charges.handled).toBe(true);
  if (!charges.handled) throw new Error("expected handled result");
  expect(charges.result.choices?.[0]).toMatchObject({
    id: "asaas-charge:ch_1",
    label: "Mensalidade",
    params: {
      __interactive: { flow: "asaas_update_charge_due_date", action: "select_charge" },
      chargeId: "ch_1"
    }
  });

  const askDate = await runInteractiveFlowTurn({
    request: "Mensalidade", registry, sessionId: "sess_au", store,
    params: { __interactive: { flow: "asaas_update_charge_due_date", action: "select_charge" }, chargeId: "ch_1" }
  });
  expect(askDate.result).toMatchObject({ missingFields: ["dueDateBr"] });

  const planned = await runInteractiveFlowTurn({ request: "20/07/2026", registry, sessionId: "sess_au", store });
  expect(planned.handled).toBe(true);
  if (!planned.handled) throw new Error("expected handled result");
  expect(planned.draftOperationId).toBe("op_asaas_update");
  expect(planned.result).toMatchObject({ status: "executed", receiptStatus: "planned", approvalAvailable: true });
  expect(calls).toEqual([{ chargeId: "ch_1", dueDateBr: "20/07/2026" }]);
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm run test -- interactive-flow-controller`
Expected: FAIL — flow and helpers do not exist.

- [ ] **Step 3: Extend the step union and imports**

Add to `InteractiveFlowState["step"]`: `"asaasUpdateCustomerSearch" | "asaasUpdateChargeChoice" | "asaasUpdateDueDate"`. Add `PendingCharge` to the existing tool-types import:

```ts
import type { AccountancyClient, CustomerMatch, PendingCharge, ToolReceipt } from "../core/tool-types.js";
```

- [ ] **Step 4: Add the dispatch branches and the anchor branch**

After the existing `ASAAS_FLOW` dispatch branch:

```ts
  if (marker.flow === ASAAS_UPDATE_FLOW) {
    const state = existing ?? { flow: ASAAS_UPDATE_FLOW, step: "asaasUpdateCustomerSearch" as const, slots: {} };
    return continueAsaasUpdateFlow(input, sessionKey, state, marker);
  }
```

In the "resume existing" section:

```ts
  if (existing?.flow === ASAAS_UPDATE_FLOW) {
    return continueAsaasUpdateFlow(input, sessionKey, existing, marker);
  }
```

In the Task-3 anchor branch, replace the `// start_asaas_update_due_date → Task 5` comment with:

```ts
    if (marker.action === "start_asaas_update_due_date") {
      input.store.set(sessionKey, { flow: ASAAS_UPDATE_FLOW, step: "asaasUpdateCustomerSearch", slots: {} });
      return promptAsaasUpdateCustomerSearch();
    }
```

- [ ] **Step 5: Implement the flow helpers**

```ts
function promptAsaasUpdateCustomerSearch(): InteractiveFlowResult {
  return {
    handled: true,
    result: needsInput({
      toolName: ASAAS_UPDATE_TOOL_NAME,
      provider: "asaas",
      intent: "update_charge_due_date",
      summary: "Vamos alterar o vencimento de uma cobrança no Asaas.",
      missingFields: ["customerSearch"],
      questions: ["Digite o nome do cliente para pesquisa."]
    })
  };
}

async function continueAsaasUpdateFlow(
  input: InteractiveFlowInput,
  sessionKey: string,
  state: InteractiveFlowState,
  marker: InteractiveMarker
): Promise<InteractiveFlowResult> {
  if (marker.action === "select_customer") {
    state.slots = { ...state.slots, customerId: stringValue(input.params?.customerId), customerName: stringValue(input.params?.customerName) };
    state.step = "asaasUpdateChargeChoice";
    input.store.set(sessionKey, state);
    return listAsaasChargesForChoice(input, state, sessionKey);
  }
  if (marker.action === "select_charge") {
    state.slots = { ...state.slots, chargeId: stringValue(input.params?.chargeId) };
    state.step = "asaasUpdateDueDate";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        toolName: ASAAS_UPDATE_TOOL_NAME, provider: "asaas", intent: "update_charge_due_date",
        summary: "Cobrança selecionada.", missingFields: ["dueDateBr"],
        questions: ["Digite o novo vencimento (DD/MM/AAAA)."]
      })
    };
  }
  if (state.step === "asaasUpdateCustomerSearch") return searchAsaasUpdateCustomers(input, state, sessionKey);
  if (state.step === "asaasUpdateChargeChoice") return listAsaasChargesForChoice(input, state, sessionKey);
  if (state.step === "asaasUpdateDueDate") return collectAsaasUpdateDueDateAndPlan(input, state, sessionKey);
  return promptAsaasUpdateCustomerSearch();
}

async function searchAsaasUpdateCustomers(input: InteractiveFlowInput, state: InteractiveFlowState, sessionKey: string): Promise<InteractiveFlowResult> {
  const query = input.request.trim();
  if (!query) return promptAsaasUpdateCustomerSearch();
  const receipt = await executeTool<CustomerMatch[]>(input.registry, "asaas.search_customers", { query });
  const customers = Array.isArray(receipt.data) ? receipt.data : [];
  if (customers.length === 0) {
    state.step = "asaasUpdateCustomerSearch";
    input.store.set(sessionKey, state);
    return { handled: true, result: needsInput({ toolName: ASAAS_UPDATE_TOOL_NAME, provider: "asaas", intent: "update_charge_due_date", summary: `Não encontrei ninguém com "${query}".`, missingFields: ["customerSearch"], questions: [`Não encontrei ninguém com "${query}". Tente outro nome.`] }) };
  }
  if (customers.length === 1) {
    state.slots = { ...state.slots, customerId: customers[0]!.id, customerName: customers[0]!.name };
    state.step = "asaasUpdateChargeChoice";
    input.store.set(sessionKey, state);
    return listAsaasChargesForChoice(input, state, sessionKey);
  }
  state.step = "asaasUpdateChargeChoice";
  input.store.set(sessionKey, state);
  return { handled: true, result: needsInput({ toolName: ASAAS_UPDATE_TOOL_NAME, provider: "asaas", intent: "update_charge_due_date", summary: `Encontrei ${customers.length} cliente(s) para "${query}".`, missingFields: ["customerId"], questions: ["Selecione o cliente."], choices: customers.map((c) => ({ id: `asaas-customer:${c.id}`, label: c.name, description: "Cliente Asaas", params: { __interactive: { flow: ASAAS_UPDATE_FLOW, action: "select_customer" }, customerId: c.id, customerName: c.name } })) }) };
}

async function listAsaasChargesForChoice(input: InteractiveFlowInput, state: InteractiveFlowState, sessionKey: string): Promise<InteractiveFlowResult> {
  const customerId = stringValue(state.slots.customerId);
  if (!customerId) return promptAsaasUpdateCustomerSearch();
  const receipt = await executeTool<PendingCharge[]>(input.registry, "asaas.list_pending_charges", { customerId });
  const charges = Array.isArray(receipt.data) ? receipt.data : [];
  if (charges.length === 0) {
    state.step = "asaasUpdateCustomerSearch";
    input.store.set(sessionKey, state);
    return { handled: true, result: needsInput({ toolName: ASAAS_UPDATE_TOOL_NAME, provider: "asaas", intent: "update_charge_due_date", summary: `Nenhuma cobrança pendente para ${state.slots.customerName ?? "este cliente"}.`, missingFields: ["customerSearch"], questions: ["Tente outro cliente."] }) };
  }
  state.step = "asaasUpdateChargeChoice";
  input.store.set(sessionKey, state);
  return { handled: true, result: needsInput({ toolName: ASAAS_UPDATE_TOOL_NAME, provider: "asaas", intent: "update_charge_due_date", summary: `Cobranças pendentes de ${state.slots.customerName ?? "este cliente"}.`, missingFields: ["chargeId"], questions: ["Selecione a cobrança."], choices: charges.map((ch) => ({ id: `asaas-charge:${ch.id}`, label: ch.description ?? `Cobrança ${ch.id}`, description: `R$ ${ch.valueBr} · vence ${ch.dueDateBr}`, params: { __interactive: { flow: ASAAS_UPDATE_FLOW, action: "select_charge" }, chargeId: ch.id } })) }) };
}

async function collectAsaasUpdateDueDateAndPlan(input: InteractiveFlowInput, state: InteractiveFlowState, sessionKey: string): Promise<InteractiveFlowResult> {
  const dueDateBr = input.request.trim();
  if (!isValidDateBr(dueDateBr)) {
    return { handled: true, result: needsInput({ toolName: ASAAS_UPDATE_TOOL_NAME, provider: "asaas", intent: "update_charge_due_date", summary: "Data inválida.", missingFields: ["dueDateBr"], questions: ["Digite o novo vencimento no formato DD/MM/AAAA."] }) };
  }
  input.store.delete(sessionKey);
  const params = { chargeId: state.slots.chargeId, dueDateBr };
  const receipt = await executeTool<unknown>(input.registry, "asaas.update_charge_due_date", params);
  const operationId = operationIdFromReceipt(receipt);
  return {
    handled: true,
    draftOperationId: receipt.status === "planned" ? operationId : undefined,
    draft: receipt.status === "planned" ? { operationId, toolName: receipt.toolName, params } : undefined,
    result: {
      status: "executed", provider: "asaas", intent: "update_charge_due_date", toolName: receipt.toolName,
      operationId, receiptStatus: receipt.status,
      summary: receipt.status === "planned" ? "Dry-run preparado para revisão." : receipt.summary,
      missingFields: [], questions: [], warnings: receipt.warnings, approvalAvailable: receipt.status === "planned", receiptData: receipt.data
    }
  };
}
```

- [ ] **Step 6: Run, verify pass; typecheck**

Run: `npm run test -- interactive-flow-controller` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/interactive-flow-controller.ts tests/server/interactive-flow-controller.test.ts
git commit -m "feat(agent): Asaas alterar-vencimento interactive flow"
```

---

### Task 6: Allow `asaas.update_charge_due_date` to execute live

**Files:**
- Modify: `src/server/confere-service.ts` (`LIVE_APPROVAL_TOOL_ALLOWLIST`)
- Test: `tests/server/confere-service.test.ts`

- [ ] **Step 1: Write the failing test** — locate the existing allowlist/live-execute coverage in `confere-service.test.ts` and add a case that asserts `asaas.update_charge_due_date` is live-approvable, mirroring whatever assertion style that file already uses for `asaas.create_boleto_charge_workflow` (do not invent a new harness; if `isLiveApprovalToolAllowed` is not exported, assert through the same public path the neighbouring test uses).

```ts
it("allows live execution of the Asaas update-charge-due-date tool", () => {
  // mirror the existing create_boleto_charge_workflow assertion in this file
  expect(isLiveApprovalToolAllowed("asaas.update_charge_due_date")).toBe(true);
});
```

- [ ] **Step 2: Run, verify it fails** — `npm run test -- confere-service` → FAIL.

- [ ] **Step 3: Add the entry**

```ts
const LIVE_APPROVAL_TOOL_ALLOWLIST = new Set([
  "asaas.create_boleto_charge_workflow",
  "asaas.update_charge_due_date",
  "contaazul.create_service_sale_boleto_workflow",
  "contaazul.acknowledge_orphan_cleanup"
]);
```

- [ ] **Step 4: Run, verify pass** — `npm run test -- confere-service` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/confere-service.ts tests/server/confere-service.test.ts
git commit -m "feat(safety): allow live Asaas due-date update behind APROVAR"
```

---

### Task 7: Conta Azul "mudar vencimento" flow

**Files:**
- Modify: `src/server/interactive-flow-controller.ts` (new `CONTAZUL_UPDATE_FLOW`; extend step union + dispatch; fill the `start_contaazul_update_due_date` anchor branch; add `formatIsoToBr` helper)
- Modify: `tests/server/interactive-flow-controller.test.ts` (replace the `it.todo("...Conta Azul update-due-date...")`)
- Test: `tests/server/interactive-flow-controller.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("runs the Conta Azul update-due-date flow through dry-run", async () => {
  const store = createInteractiveFlowStore();
  const registry = createToolRegistry();
  const calls: unknown[] = [];
  registerTenantTools(registry);
  registry.register({
    name: "contaazul.search_financial_statement",
    description: "Search statement",
    parameters: z.object({ relationId: z.string(), query: z.string().optional() }),
    execute: async () =>
      receipt("contaazul.search_financial_statement", [
        { id: "inst_1", financialEventId: "fe_1", installmentId: "inst_1", description: "Mensalidade junho", value: 150, dueDateIso: "2026-06-10", customerName: "JOÃO LTDA", status: "PENDING" }
      ])
  });
  registry.register({
    name: "contaazul.update_due_date_reissue_boleto_workflow",
    description: "Update due date workflow",
    parameters: z.object({}).passthrough(),
    execute: async (params) => {
      calls.push(params);
      return { ...receipt("contaazul.update_due_date_reissue_boleto_workflow", { approvalPreview: { operationId: "op_ca_update" } }), status: "planned" } satisfies ToolReceipt;
    }
  });

  await runInteractiveFlowTurn({
    request: "Mudar vencimento · Conta Azul", registry, sessionId: "sess_cu", store,
    params: { __interactive: { flow: "anchor", action: "start_contaazul_update_due_date" } }
  });
  await runInteractiveFlowTurn({
    request: "MAIS NEGOCIOS", registry, sessionId: "sess_cu", store,
    params: { __interactive: { flow: "contaazul_update_due_date", action: "select_tenant" }, tenantId: 3047702, relationId: "rel_mais", tenantName: "MAIS NEGOCIOS" }
  });
  const choices = await runInteractiveFlowTurn({ request: "JOÃO", registry, sessionId: "sess_cu", store });
  expect(choices.handled).toBe(true);
  if (!choices.handled) throw new Error("expected handled result");
  expect(choices.result.choices?.[0]).toMatchObject({
    id: "statement:inst_1",
    params: { __interactive: { flow: "contaazul_update_due_date", action: "select_statement" }, financialEventId: "fe_1", installmentId: "inst_1" }
  });
  const askDate = await runInteractiveFlowTurn({
    request: "Mensalidade junho", registry, sessionId: "sess_cu", store,
    params: { __interactive: { flow: "contaazul_update_due_date", action: "select_statement" }, financialEventId: "fe_1", installmentId: "inst_1" }
  });
  expect(askDate.result).toMatchObject({ missingFields: ["dueDateBr"] });
  const planned = await runInteractiveFlowTurn({ request: "20/07/2026", registry, sessionId: "sess_cu", store });
  expect(planned.handled).toBe(true);
  if (!planned.handled) throw new Error("expected handled result");
  expect(planned.draftOperationId).toBe("op_ca_update");
  expect(calls).toEqual([{ tenantId: 3047702, financialEventId: "fe_1", installmentId: "inst_1", dueDateIso: "2026-07-20" }]);
});
```

- [ ] **Step 2: Run, verify it fails** — `npm run test -- interactive-flow-controller` → FAIL.

- [ ] **Step 3: Extend step union + dispatch + anchor branch + import**

Add steps `"caUpdateStatementSearch" | "caUpdateStatementChoice" | "caUpdateDueDate"`. Add `FinancialStatementItem` to the tool-types import. Add dispatch branches mirroring Task 5 (`marker.flow === CONTAZUL_UPDATE_FLOW` and `existing?.flow === CONTAZUL_UPDATE_FLOW` → `continueContaAzulUpdateFlow`). Fill the anchor branch:

```ts
    if (marker.action === "start_contaazul_update_due_date") {
      input.store.set(sessionKey, { flow: CONTAZUL_UPDATE_FLOW, step: "tenant", slots: {} });
      return promptContaAzulTenant(input.registry, CONTAZUL_UPDATE_FLOW);
    }
```

- [ ] **Step 4: Implement the flow**

```ts
async function continueContaAzulUpdateFlow(input: InteractiveFlowInput, sessionKey: string, state: InteractiveFlowState, marker: InteractiveMarker): Promise<InteractiveFlowResult> {
  if (marker.action === "select_tenant") {
    const relationId = stringValue(input.params?.relationId);
    if (!relationId) return { handled: true, result: blocked("A empresa selecionada não possui relationId.") };
    const sw = await executeTool<unknown>(input.registry, "contaazul.switch_to_pro_session", { relationId });
    if (sw.status !== "succeeded") return { handled: true, result: blocked(sw.summary) };
    state.slots = { ...state.slots, tenantId: input.params?.tenantId, relationId, tenantName: stringValue(input.params?.tenantName) };
    state.step = "caUpdateStatementSearch";
    input.store.set(sessionKey, state);
    return { handled: true, result: needsInput({ toolName: CONTAZUL_UPDATE_TOOL_NAME, summary: "Empresa selecionada.", missingFields: ["statementSearch"], questions: ["Digite o nome do cliente ou descrição do lançamento."] }) };
  }
  if (marker.action === "select_statement") {
    state.slots = { ...state.slots, financialEventId: stringValue(input.params?.financialEventId), installmentId: stringValue(input.params?.installmentId) };
    state.step = "caUpdateDueDate";
    input.store.set(sessionKey, state);
    return { handled: true, result: needsInput({ toolName: CONTAZUL_UPDATE_TOOL_NAME, summary: "Lançamento selecionado.", missingFields: ["dueDateBr"], questions: ["Digite o novo vencimento (DD/MM/AAAA)."] }) };
  }
  if (state.step === "tenant") return promptContaAzulTenant(input.registry, CONTAZUL_UPDATE_FLOW);
  if (state.step === "caUpdateStatementSearch") return searchContaAzulStatement(input, state, sessionKey);
  if (state.step === "caUpdateDueDate") return collectContaAzulUpdateDueDateAndPlan(input, state, sessionKey);
  return promptContaAzulTenant(input.registry, CONTAZUL_UPDATE_FLOW);
}

async function searchContaAzulStatement(input: InteractiveFlowInput, state: InteractiveFlowState, sessionKey: string): Promise<InteractiveFlowResult> {
  const query = input.request.trim();
  const relationId = stringValue(state.slots.relationId);
  if (!relationId) return { handled: true, result: blocked("Sessão da empresa não está ativa.") };
  if (!query) return { handled: true, result: needsInput({ toolName: CONTAZUL_UPDATE_TOOL_NAME, summary: "Aguardando busca.", missingFields: ["statementSearch"], questions: ["Digite o nome do cliente ou descrição."] }) };
  const receipt = await executeTool<FinancialStatementItem[]>(input.registry, "contaazul.search_financial_statement", { relationId, query });
  const items = Array.isArray(receipt.data) ? receipt.data : [];
  if (items.length === 0) {
    state.step = "caUpdateStatementSearch";
    input.store.set(sessionKey, state);
    return { handled: true, result: needsInput({ toolName: CONTAZUL_UPDATE_TOOL_NAME, summary: `Não encontrei lançamento com "${query}".`, missingFields: ["statementSearch"], questions: [`Não encontrei lançamento com "${query}". Tente outro termo.`] }) };
  }
  state.step = "caUpdateStatementChoice";
  input.store.set(sessionKey, state);
  return { handled: true, result: needsInput({ toolName: CONTAZUL_UPDATE_TOOL_NAME, summary: `Encontrei ${items.length} lançamento(s).`, missingFields: ["statementId"], questions: ["Selecione o lançamento."], choices: items.map((it) => ({ id: `statement:${it.installmentId ?? it.id}`, label: `${it.customerName ? it.customerName + " · " : ""}${it.description}`, description: `R$ ${it.value.toFixed(2).replace(".", ",")}${it.dueDateIso ? " · vence " + formatIsoToBr(it.dueDateIso) : ""}`, params: { __interactive: { flow: CONTAZUL_UPDATE_FLOW, action: "select_statement" }, financialEventId: it.financialEventId, installmentId: it.installmentId ?? it.id } })) }) };
}

async function collectContaAzulUpdateDueDateAndPlan(input: InteractiveFlowInput, state: InteractiveFlowState, sessionKey: string): Promise<InteractiveFlowResult> {
  const dueDateBr = input.request.trim();
  if (!isValidDateBr(dueDateBr)) return { handled: true, result: needsInput({ toolName: CONTAZUL_UPDATE_TOOL_NAME, summary: "Data inválida.", missingFields: ["dueDateBr"], questions: ["Digite o novo vencimento no formato DD/MM/AAAA."] }) };
  input.store.delete(sessionKey);
  const [d, m, y] = dueDateBr.split("/");
  const params = { tenantId: state.slots.tenantId, financialEventId: state.slots.financialEventId, installmentId: state.slots.installmentId, dueDateIso: `${y}-${m}-${d}` };
  const receipt = await executeTool<unknown>(input.registry, "contaazul.update_due_date_reissue_boleto_workflow", params);
  const operationId = operationIdFromReceipt(receipt);
  return {
    handled: true,
    draftOperationId: receipt.status === "planned" ? operationId : undefined,
    draft: receipt.status === "planned" ? { operationId, toolName: receipt.toolName, params } : undefined,
    result: { status: "executed", provider: "contaazul", intent: "update_due_date_reissue_boleto", toolName: receipt.toolName, operationId, receiptStatus: receipt.status, summary: receipt.status === "planned" ? "Dry-run preparado para revisão." : receipt.summary, missingFields: [], questions: [], warnings: receipt.warnings, approvalAvailable: receipt.status === "planned", receiptData: receipt.data }
  };
}

function formatIsoToBr(iso: string): string {
  const parts = iso.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : iso;
}
```

- [ ] **Step 5: Run, verify pass; typecheck**

Run: `npm run test -- interactive-flow-controller` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/interactive-flow-controller.ts tests/server/interactive-flow-controller.test.ts
git commit -m "feat(agent): Conta Azul alterar-vencimento interactive flow"
```

---

### Task 8: Allow `contaazul.update_due_date_reissue_boleto_workflow` to execute live

**Files:**
- Modify: `src/server/confere-service.ts`
- Test: `tests/server/confere-service.test.ts`

- [ ] **Step 1: Failing test** (mirror Task 6's pattern)

```ts
it("allows live execution of the Conta Azul due-date reissue workflow", () => {
  expect(isLiveApprovalToolAllowed("contaazul.update_due_date_reissue_boleto_workflow")).toBe(true);
});
```

- [ ] **Step 2: Run, verify fail** — `npm run test -- confere-service` → FAIL.

- [ ] **Step 3: Add to the allowlist set** the string `"contaazul.update_due_date_reissue_boleto_workflow"`.

- [ ] **Step 4: Run, verify pass** — `npm run test -- confere-service` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/confere-service.ts tests/server/confere-service.test.ts
git commit -m "feat(safety): allow live Conta Azul due-date reissue behind APROVAR"
```

---

## Phase 4 — Deterministic create-customer + boleto hand-off

### Task 9: Deterministic create-customer flow (data-driven field collection)

**Files:**
- Modify: `src/server/interactive-flow-controller.ts` (new `CONTAZUL_CREATE_CUSTOMER_FLOW`; `CUSTOMER_FIELDS` table; tenant chip → personType chip → ordered fields → plan `create_customer_workflow`; extend step union + dispatch; fill the `start_contaazul_create_customer` anchor branch)
- Modify: `tests/server/interactive-flow-controller.test.ts` (replace the `it.todo("...create-customer...")`)
- Test: `tests/server/interactive-flow-controller.test.ts`

- [ ] **Step 1: Write the failing test (happy path, Física)**

```ts
it("collects a Física customer and plans the create-customer workflow", async () => {
  const store = createInteractiveFlowStore();
  const registry = createToolRegistry();
  const calls: unknown[] = [];
  registerTenantTools(registry);
  registry.register({
    name: "contaazul.create_customer_workflow",
    description: "Create customer workflow",
    parameters: z.object({}).passthrough(),
    execute: async (params) => {
      calls.push(params);
      return { ...receipt("contaazul.create_customer_workflow", { approvalPreview: { operationId: "op_cust" }, resolved: { customerId: "new_cust", customerName: "MARIA SILVA" } }), status: "planned" } satisfies ToolReceipt;
    }
  });

  await runInteractiveFlowTurn({ request: "Criar cliente · Conta Azul", registry, sessionId: "sess_cc", store, params: { __interactive: { flow: "anchor", action: "start_contaazul_create_customer" } } });
  await runInteractiveFlowTurn({ request: "MAIS NEGOCIOS", registry, sessionId: "sess_cc", store, params: { __interactive: { flow: "contaazul_create_customer", action: "select_tenant" }, tenantId: 3047702, relationId: "rel_mais", tenantName: "MAIS NEGOCIOS" } });

  const docPrompt = await runInteractiveFlowTurn({ request: "Física", registry, sessionId: "sess_cc", store, params: { __interactive: { flow: "contaazul_create_customer", action: "select_person_type" }, personType: "Física" } });
  expect(docPrompt.result).toMatchObject({ missingFields: ["document"] });

  // Walk CUSTOMER_FIELDS for Física, in order. "pular" skips optionals.
  // Order: document, name, email, cellPhone, commercialPhone, zipcode, street,
  //        numberAddress, neighborhood, complement, billingEmail, billingPhone (12 fields)
  const seq = ["123.456.789-00", "MARIA SILVA", "maria@example.com", "62999990000", "pular", "74000000", "Rua A", "100", "Centro", "pular", "maria@example.com", "62999990000"];
  let last;
  for (const value of seq) {
    last = await runInteractiveFlowTurn({ request: value, registry, sessionId: "sess_cc", store });
  }
  expect(last!.handled).toBe(true);
  if (!last!.handled) throw new Error("expected handled result");
  expect(last!.draftOperationId).toBe("op_cust");
  expect(calls[0]).toMatchObject({ tenantId: 3047702, personType: "Física", document: "123.456.789-00", name: "MARIA SILVA", billingEmail: "maria@example.com", billingPhone: "62999990000" });
});
```

- [ ] **Step 2: Run, verify it fails** — `npm run test -- interactive-flow-controller` → FAIL.

- [ ] **Step 3: Add the step union, the field table, dispatch, anchor branch, and the flow**

Add steps `"customerPersonType" | "customerField"` (tenant reuses the shared `"tenant"` step). Add dispatch branches (`marker.flow === CONTAZUL_CREATE_CUSTOMER_FLOW` and `existing?.flow === CONTAZUL_CREATE_CUSTOMER_FLOW` → `continueContaAzulCreateCustomerFlow`). Fill the anchor branch:

```ts
    if (marker.action === "start_contaazul_create_customer") {
      input.store.set(sessionKey, { flow: CONTAZUL_CREATE_CUSTOMER_FLOW, step: "tenant", slots: {} });
      return promptContaAzulTenant(input.registry, CONTAZUL_CREATE_CUSTOMER_FLOW);
    }
```

```ts
const CUSTOMER_FIELDS: { key: string; question: string; required: boolean; onlyIf?: "Jurídica" }[] = [
  { key: "document", question: "Informe o CPF (Física) ou CNPJ (Jurídica).", required: true },
  { key: "companyName", question: "Qual a razão social?", required: true, onlyIf: "Jurídica" },
  { key: "name", question: "Qual o nome completo (ou nome fantasia)?", required: true },
  { key: "email", question: "Qual o e-mail do cliente? (ou 'pular')", required: false },
  { key: "cellPhone", question: "Qual o celular com DDD? (ou 'pular')", required: false },
  { key: "commercialPhone", question: "Qual o telefone comercial? (ou 'pular')", required: false },
  { key: "zipcode", question: "Qual o CEP? (ou 'pular')", required: false },
  { key: "street", question: "Qual a rua/avenida? (ou 'pular')", required: false },
  { key: "numberAddress", question: "Qual o número? (ou 'pular')", required: false },
  { key: "neighborhood", question: "Qual o bairro? (ou 'pular')", required: false },
  { key: "complement", question: "Qual o complemento? (ou 'pular')", required: false },
  { key: "billingEmail", question: "Qual o e-mail de cobrança?", required: true },
  { key: "billingPhone", question: "Qual o telefone de cobrança?", required: true }
];

function customerFieldsFor(personType: string): typeof CUSTOMER_FIELDS {
  return CUSTOMER_FIELDS.filter((f) => !f.onlyIf || f.onlyIf === personType);
}

async function continueContaAzulCreateCustomerFlow(input: InteractiveFlowInput, sessionKey: string, state: InteractiveFlowState, marker: InteractiveMarker): Promise<InteractiveFlowResult> {
  if (marker.action === "select_tenant") {
    const relationId = stringValue(input.params?.relationId);
    if (!relationId) return { handled: true, result: blocked("Empresa sem relationId.") };
    const sw = await executeTool<unknown>(input.registry, "contaazul.switch_to_pro_session", { relationId });
    if (sw.status !== "succeeded") return { handled: true, result: blocked(sw.summary) };
    state.slots = { ...state.slots, tenantId: input.params?.tenantId, relationId, tenantName: stringValue(input.params?.tenantName) };
    state.step = "customerPersonType";
    input.store.set(sessionKey, state);
    return { handled: true, result: needsInput({ toolName: CONTAZUL_CREATE_CUSTOMER_TOOL_NAME, summary: "Empresa selecionada.", missingFields: ["personType"], questions: ["O cliente é Pessoa Física ou Jurídica?"], choices: [
      { id: "person:fisica", label: "Física", params: { __interactive: { flow: CONTAZUL_CREATE_CUSTOMER_FLOW, action: "select_person_type" }, personType: "Física" } },
      { id: "person:juridica", label: "Jurídica", params: { __interactive: { flow: CONTAZUL_CREATE_CUSTOMER_FLOW, action: "select_person_type" }, personType: "Jurídica" } }
    ] }) };
  }
  if (marker.action === "select_person_type") {
    state.slots = { ...state.slots, personType: stringValue(input.params?.personType), fieldIndex: 0 };
    state.step = "customerField";
    input.store.set(sessionKey, state);
    return askCustomerField(state, 0);
  }
  if (state.step === "tenant") return promptContaAzulTenant(input.registry, CONTAZUL_CREATE_CUSTOMER_FLOW);
  if (state.step === "customerField") return collectCustomerField(input, state, sessionKey);
  return promptContaAzulTenant(input.registry, CONTAZUL_CREATE_CUSTOMER_FLOW);
}

function askCustomerField(state: InteractiveFlowState, index: number): InteractiveFlowResult {
  const fields = customerFieldsFor(String(state.slots.personType));
  const field = fields[index]!;
  return { handled: true, result: needsInput({ toolName: CONTAZUL_CREATE_CUSTOMER_TOOL_NAME, summary: "Cadastro de cliente.", missingFields: [field.key], questions: [field.question] }) };
}

async function collectCustomerField(input: InteractiveFlowInput, state: InteractiveFlowState, sessionKey: string): Promise<InteractiveFlowResult> {
  const fields = customerFieldsFor(String(state.slots.personType));
  const index = Number(state.slots.fieldIndex ?? 0);
  const field = fields[index]!;
  const raw = input.request.trim();
  const skipped = !field.required && /^pular$/i.test(raw);
  if (field.required && !raw) return askCustomerField(state, index);
  if (!skipped) state.slots = { ...state.slots, [field.key]: raw };
  const nextIndex = index + 1;
  if (nextIndex < fields.length) {
    state.slots = { ...state.slots, fieldIndex: nextIndex };
    input.store.set(sessionKey, state);
    return askCustomerField(state, nextIndex);
  }
  input.store.delete(sessionKey);
  const params = createCustomerWorkflowParams(state.slots);
  const receipt = await executeTool<unknown>(input.registry, "contaazul.create_customer_workflow", params);
  const operationId = operationIdFromReceipt(receipt);
  return {
    handled: true,
    draftOperationId: receipt.status === "planned" ? operationId : undefined,
    draft: receipt.status === "planned" ? { operationId, toolName: receipt.toolName, params } : undefined,
    result: { status: "executed", provider: "contaazul", intent: "create_customer", toolName: receipt.toolName, operationId, receiptStatus: receipt.status, summary: receipt.status === "planned" ? "Dry-run preparado para revisão." : receipt.summary, missingFields: [], questions: [], warnings: receipt.warnings, approvalAvailable: receipt.status === "planned", receiptData: receipt.data }
  };
}

function createCustomerWorkflowParams(slots: Record<string, unknown>): Record<string, unknown> {
  return {
    tenantId: slots.tenantId,
    personType: slots.personType,
    document: slots.document,
    name: slots.name,
    companyName: slots.companyName,
    email: slots.email,
    commercialPhone: slots.commercialPhone,
    cellPhone: slots.cellPhone,
    zipcode: slots.zipcode,
    street: slots.street,
    numberAddress: slots.numberAddress,
    neighborhood: slots.neighborhood,
    complement: slots.complement,
    billingEmail: slots.billingEmail,
    billingPhone: slots.billingPhone
  };
}
```

> `fieldIndex` is stored in the untyped `slots` record — no `InteractiveFlowState` change needed beyond the two new step strings.

- [ ] **Step 4: Run, verify pass; typecheck**

Run: `npm run test -- interactive-flow-controller` then `npm run typecheck`
Expected: PASS. (If the `seq` walk lands on the wrong field, align it to `CUSTOMER_FIELDS` — Física skips `companyName`, so 12 fields after personType.)

- [ ] **Step 5: Commit**

```bash
git add src/server/interactive-flow-controller.ts tests/server/interactive-flow-controller.test.ts
git commit -m "feat(agent): deterministic Conta Azul create-customer flow"
```

---

### Task 10: Live allowlist for create-customer + boleto hand-off pre-seed

**Files:**
- Modify: `src/server/confere-service.ts` (`LIVE_APPROVAL_TOOL_ALLOWLIST`)
- Modify: `src/server/interactive-flow-controller.ts` (`continueContaAzulFlow`: handle `marker.action === "start_with_customer"`)
- Test: `tests/server/confere-service.test.ts`, `tests/server/interactive-flow-controller.test.ts`

- [ ] **Step 1: Failing allowlist test** (mirror Task 6)

```ts
it("allows live execution of the Conta Azul create-customer workflow", () => {
  expect(isLiveApprovalToolAllowed("contaazul.create_customer_workflow")).toBe(true);
});
```

- [ ] **Step 2: Failing hand-off test**

```ts
it("opens the boleto flow at the category step when pre-seeded with a customer", async () => {
  const store = createInteractiveFlowStore();
  const registry = createToolRegistry();
  registerTenantTools(registry);
  registerSearchTools(registry);
  const result = await runInteractiveFlowTurn({
    request: "Emitir boleto de serviço",
    registry, sessionId: "sess_seed", store,
    params: { __interactive: { flow: "contaazul_service_sale_boleto", action: "start_with_customer" }, tenantId: 3047702, relationId: "rel_mais", customerId: "new_cust", customerName: "MARIA SILVA" }
  });
  expect(result.handled).toBe(true);
  if (!result.handled) throw new Error("expected handled result");
  expect(result.result).toMatchObject({ missingFields: ["categorySearch"], questions: ["Digite o nome da categoria financeira."] });
});
```

- [ ] **Step 3: Run, verify both fail** — `npm run test -- confere-service` and `npm run test -- interactive-flow-controller` → FAIL.

- [ ] **Step 4: Implement**

In `confere-service.ts` add `"contaazul.create_customer_workflow"` to `LIVE_APPROVAL_TOOL_ALLOWLIST`.

In `interactive-flow-controller.ts` `continueContaAzulFlow`, at the very top (before the `select_tenant` handler), add:

```ts
  if (marker.action === "start_with_customer") {
    const relationId = stringValue(input.params?.relationId);
    if (relationId) {
      await executeTool<unknown>(input.registry, "contaazul.switch_to_pro_session", { relationId });
    }
    state.slots = {
      ...state.slots,
      tenantId: input.params?.tenantId,
      relationId,
      customerId: stringValue(input.params?.customerId),
      customerName: stringValue(input.params?.customerName)
    };
    state.step = "categorySearch";
    input.store.set(sessionKey, state);
    return {
      handled: true,
      result: needsInput({
        summary: `Cliente ${state.slots.customerName ?? ""} selecionado. Agora a categoria financeira.`,
        missingFields: ["categorySearch"],
        questions: ["Digite o nome da categoria financeira."]
      })
    };
  }
```

> Routing: a `start_with_customer` marker has `flow === CONTAZUL_FLOW`, so it already hits the existing `if (marker.flow === CONTAZUL_FLOW)` dispatch branch, which seeds a fresh `{ flow: CONTAZUL_FLOW, step: "tenant", slots: {} }` state and calls `continueContaAzulFlow(input, sessionKey, state, marker)` — the new handler then overrides the step to `categorySearch`. Confirm that dispatch branch passes `marker` through (it does in the current code).

- [ ] **Step 5: Run, verify pass; full backend suite; typecheck**

Run: `npm run test` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/confere-service.ts src/server/interactive-flow-controller.ts tests/server/confere-service.test.ts tests/server/interactive-flow-controller.test.ts
git commit -m "feat(agent): create-customer live gate + boleto hand-off pre-seed"
```

---

### Task 11: Renderer hand-off — "Sim, emitir boleto" sends the pre-seed marker

**Files:**
- Modify: `src/ui/screens/AssistantScreen.tsx` (extract `buildBoletoHandoffParams`; repoint the `resolvedCustomer` follow-up "Sim" button)
- Test: `tests/ui/confere-ui.test.tsx`

- [ ] **Step 1: Write the failing test** (unit-test the pure marker builder — works regardless of whether the UI suite simulates clicks)

```tsx
it("builds the boleto hand-off marker from the resolved customer", () => {
  const params = buildBoletoHandoffParams({ customerId: "new_cust", customerName: "MARIA SILVA", tenantId: 3047702, relationId: "rel_mais" });
  expect(params).toEqual({
    __interactive: { flow: "contaazul_service_sale_boleto", action: "start_with_customer" },
    tenantId: 3047702,
    relationId: "rel_mais",
    customerId: "new_cust",
    customerName: "MARIA SILVA"
  });
});

it("renders the boleto offer after a successful cadastro", () => {
  const result: AgentResultView = {
    status: "executed",
    toolName: "contaazul.create_customer_workflow",
    receiptStatus: "succeeded",
    missingFields: [], questions: [], warnings: [], approvalAvailable: false,
    receiptData: { resolved: { customerId: "new_cust", customerName: "MARIA SILVA", tenantId: 3047702, relationId: "rel_mais" } }
  };
  const html = renderToString(
    <AssistantResultMessage
      message={{ id: "m", role: "assistant", result, timestamp: "21:11" }}
      isLatest onReview={() => {}} onSend={() => {}}
    />
  );
  expect(html).toContain("Deseja emitir um novo boleto");
  expect(html).toContain("Sim, emitir boleto");
});
```

> Import `buildBoletoHandoffParams` from `../../src/ui/screens/AssistantScreen.js` (match the existing import style/path used by the suite for `AssistantResultMessage`).

- [ ] **Step 2: Run, verify it fails** — `npm run test:ui -- confere-ui` → FAIL (`buildBoletoHandoffParams` undefined).

- [ ] **Step 3: Implement**

Add the exported pure helper near the top of `AssistantScreen.tsx`:

```tsx
export function buildBoletoHandoffParams(resolved: {
  customerId?: string; customerName?: string; tenantId?: string | number; relationId?: string;
}): Record<string, unknown> {
  return {
    __interactive: { flow: "contaazul_service_sale_boleto", action: "start_with_customer" },
    tenantId: resolved.tenantId,
    relationId: resolved.relationId,
    customerId: resolved.customerId,
    customerName: resolved.customerName
  };
}
```

Repoint the existing "Sim, emitir boleto" button's `onClick` to:

```tsx
onClick={() => props.onSend("Emitir boleto de serviço", buildBoletoHandoffParams(resolvedCustomer))}
```

- [ ] **Step 4: Run, verify pass; typecheck; full UI suite**

Run: `npm run test:ui` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/AssistantScreen.tsx tests/ui/confere-ui.test.tsx
git commit -m "feat(ui): cadastro success pre-seeds the boleto flow"
```

---

## Final verification

- [ ] **Step 1: Full backend suite** — `npm run test` → all green (expect the prior 182 + the new tests).
- [ ] **Step 2: UI suite** — `npm run test:ui` → all green.
- [ ] **Step 3: Typecheck** — `npm run typecheck` → clean.
- [ ] **Step 4: Manual smoke** — `npm run desktop:dev`, click each of the four anchored starters, confirm: chips render (no inline search box), a zero-result search re-prompts, and a cadastro success offers the boleto. (No live execution without `APROVAR`.)

## Items to verify during implementation (from the spec)

- `create_customer_workflow`'s `resolved` payload: confirm it carries `customerId` + `customerName`. If it lacks `tenantId`/`relationId`, source those in `AssistantScreen` from the create flow's known tenant rather than from `resolved` (pass them through `receiptData` or hold them in component state set when the create flow started).
- `contaazul.search_financial_statement` returns `installmentId` per item often enough for the chip; when absent, the chip falls back to `it.id` (already handled in `searchContaAzulStatement`). Confirm `update_due_date_reissue_boleto_workflow` accepts `installmentId === id` in that fallback, else require a richer statement lookup.
- Pro-session persistence across turns: confirm `runtime("dry-run")` reuses the same registry/`proSessions` across turns in one `sessionId` (the existing service-sale flow relies on this). The `start_with_customer` re-switch and the update flows' `select_tenant` switch both re-establish the session defensively.

## Self-review notes

- **Spec coverage:** Approach A unify (Tasks 1–2) ✓; four explicit starters + anchor (Tasks 3–4) ✓; Mudar boleto Asaas (Tasks 5–6) ✓; Mudar vencimento CA (Tasks 7–8) ✓; deterministic create-customer (Task 9) ✓; live-allowlist trio (Tasks 6, 8, 10) ✓; hand-off (Tasks 10–11) ✓; zero-result fix (Task 1) ✓.
- **Type consistency:** flow names used as marker `flow` values match the `InteractiveFlowName` union; chip `action` strings (`select_tenant`/`select_customer`/`select_charge`/`select_statement`/`select_person_type`/`start_with_customer`) are each handled in their flow's `continue*` function; `LIVE_APPROVAL_TOOL_ALLOWLIST` strings match the tool names the controller calls; `formatIsoToBr` uses `split`, no regex.
