# Confere UI Redesign (Living Assistant) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose the Confere desktop renderer into an assistant-first, single-window UI where Pixelyn is always present and visibly alive, replacing the five-tab dashboard with a conversation + slim rail.

**Architecture:** Renderer-only change under `harness/src/ui/**`. The backend, IPC contracts (`window.confere` / `src/ui/api.ts`), agent dry-run gate, confirmation flow, and safety model are reused unchanged. New pieces: a pure `pixelynState` mapper, a `PixelynAvatar`, a `SlimRail`, a `PlanCard`, and an `AssistantScreen` that replaces `WorkflowScreen`/`HomeScreen`.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), React 19, Vitest (jsdom config `vitest.ui.config.ts`, scoped to `tests/ui/**`), `renderToString` for renderer tests, lucide-react, existing `src/ui/api.ts`.

---

## Context For The Executor

The Confere app is a local Electron + React renderer in `harness/`. The renderer talks to the backend only through `src/ui/api.ts` (which uses `window.confere` IPC, with an HTTP fallback for browser-dev). The contract the UI consumes is in `src/server/api-types.ts` — notably `AgentResultView` (the per-turn result: `status` is `needs_input | planned | blocked | unsupported | executed`, plus `missingFields`, `questions`, `warnings`, `risk`, `confidence`, `approvalAvailable`, `summary`, `toolName`, `operationId`, `receiptStatus`) and `ConfirmationSheetView`.

Commands run from `C:\Kamilly\harness`. UI tests: `npm run test:ui` (jsdom, scoped to `tests/ui/**`). Backend tests: `npm run test`. Typecheck: `npm run typecheck`. UI tests render components with `renderToString` (no jsdom DOM events, no live backend — `window.confere` is undefined, so components must render their initial/empty state without throwing).

Do NOT change any file under `src/server/**`, `src/agent/**`, `src/core/**`, `src/modules/**`, or `src/desktop/**`. This plan only touches `src/ui/**` and `tests/ui/**`.

Work on the current branch `confere-ui-redesign`. Baseline: backend suite green; UI suite currently green against the OLD UI — several existing UI tests assert the old structure and WILL be rewritten in this plan (that is expected, not a regression).

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/ui/lib/pixelyn-state.ts` (create) | Pure mapper: agent phase + result → `PixelynState` | 1 |
| `tests/ui/pixelyn-state.test.ts` (create) | Unit tests for the mapper | 1 |
| `src/ui/components/PixelynAvatar.tsx` (create) | The mascot, rendered per state (CSS/SVG) + idle animation | 2 |
| `src/ui/components/SlimRail.tsx` (create) | Pixelyn + 3 destinations (Conversa/Operações/Sessões) | 3 |
| `src/ui/types.ts` (modify) | `ScreenId` → `conversa | operacoes | sessoes` | 3 |
| `src/ui/App.tsx` (modify) | Assistant-first routing via the rail | 3 |
| `src/ui/components/PlanCard.tsx` (create) | Clean business-facts plan card + collapsible technical detail | 4 |
| `src/ui/screens/AssistantScreen.tsx` (create) | Conversation home; wires agent turn, PlanCard, ConfirmationSheet, PixelynAvatar | 5 |
| `src/ui/screens/WorkflowScreen.tsx` (delete) | Replaced by AssistantScreen | 5 |
| `src/ui/screens/HomeScreen.tsx` (delete) | Assistant is the home | 5 |
| `src/ui/styles.css` (modify) | Rail, conversation, plan card, avatar styles + idle animation | 6 |
| `tests/ui/confere-ui.test.tsx` (modify) | Rewrite assertions for the new structure | 7 |

`ConfirmationSheet.tsx`, `OperationsScreen.tsx`, `SessionsScreen.tsx`, `ActionButton.tsx`, `StatusPill.tsx`, `api.ts`, `api-types.ts` are reused as-is (OperationsScreen/SessionsScreen are reachable via the rail; only styling in Task 6 may touch them, no logic).

---

## Task 1: Pixelyn State Mapper

**Files:**
- Create: `harness/src/ui/lib/pixelyn-state.ts`
- Test: `harness/tests/ui/pixelyn-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `harness/tests/ui/pixelyn-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { pixelynStateFromResult } from "../../src/ui/lib/pixelyn-state.js";
import type { AgentResultView } from "../../src/server/api-types.js";

function result(partial: Partial<AgentResultView>): AgentResultView {
  return {
    status: "planned",
    missingFields: [],
    questions: [],
    warnings: [],
    approvalAvailable: true,
    ...partial
  };
}

describe("pixelynStateFromResult", () => {
  it("is parada when idle with no result", () => {
    expect(pixelynStateFromResult(undefined, "idle")).toBe("parada");
  });

  it("is pensando while preparing", () => {
    expect(pixelynStateFromResult(undefined, "preparing")).toBe("pensando");
  });

  it("is trabalhando while executing", () => {
    expect(pixelynStateFromResult(result({ status: "planned" }), "executing")).toBe("trabalhando");
  });

  it("is preciso-de-dado when the agent needs input", () => {
    expect(pixelynStateFromResult(result({ status: "needs_input" }), "idle")).toBe("preciso-de-dado");
  });

  it("is parada when a plan is ready and waiting", () => {
    expect(pixelynStateFromResult(result({ status: "planned" }), "idle")).toBe("parada");
  });

  it("is feito when execution succeeded", () => {
    expect(
      pixelynStateFromResult(result({ status: "executed", receiptStatus: "succeeded" }), "idle")
    ).toBe("feito");
  });

  it("is bloqueada when blocked, unsupported, or executed-but-not-succeeded", () => {
    expect(pixelynStateFromResult(result({ status: "blocked" }), "idle")).toBe("bloqueada");
    expect(pixelynStateFromResult(result({ status: "unsupported" }), "idle")).toBe("bloqueada");
    expect(
      pixelynStateFromResult(result({ status: "executed", receiptStatus: "failed" }), "idle")
    ).toBe("bloqueada");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `C:\Kamilly\harness`): `npm run test:ui -- tests/ui/pixelyn-state.test.ts`
Expected: FAIL — `src/ui/lib/pixelyn-state.ts` does not exist.

- [ ] **Step 3: Implement the mapper**

Create `harness/src/ui/lib/pixelyn-state.ts`:

```ts
import type { AgentResultView } from "../../server/api-types.js";

export type PixelynState =
  | "parada"
  | "pensando"
  | "preciso-de-dado"
  | "trabalhando"
  | "feito"
  | "bloqueada";

export type PixelynPhase = "idle" | "preparing" | "executing";

export function pixelynStateFromResult(
  result: AgentResultView | undefined,
  phase: PixelynPhase
): PixelynState {
  if (phase === "preparing") return "pensando";
  if (phase === "executing") return "trabalhando";
  if (!result) return "parada";

  switch (result.status) {
    case "needs_input":
      return "preciso-de-dado";
    case "executed":
      return result.receiptStatus === "succeeded" ? "feito" : "bloqueada";
    case "blocked":
    case "unsupported":
      return "bloqueada";
    case "planned":
    default:
      return "parada";
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `C:\Kamilly\harness`): `npm run test:ui -- tests/ui/pixelyn-state.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck and commit**

Run (from `C:\Kamilly\harness`): `npm run typecheck`
```bash
cd C:/Kamilly && git add harness/src/ui/lib/pixelyn-state.ts harness/tests/ui/pixelyn-state.test.ts && git commit -m "feat(ui): pixelyn state mapper"
```

---

## Task 2: PixelynAvatar Component

**Files:**
- Create: `harness/src/ui/components/PixelynAvatar.tsx`
- Test: `harness/tests/ui/confere-ui.test.tsx` (add one test; full rewrite happens in Task 7 — here only append)

- [ ] **Step 1: Write the failing test**

Append this test inside the `describe("Confere UI", ...)` block in `harness/tests/ui/confere-ui.test.tsx` (and add the import `import { PixelynAvatar } from "../../src/ui/components/PixelynAvatar.js";` at the top with the other imports):

```tsx
  it("renders the Pixelyn avatar with a state label for accessibility", () => {
    const happy = renderToString(<PixelynAvatar state="feito" />);
    expect(happy).toContain("Pixelyn");
    expect(happy).toContain("feito");

    const blocked = renderToString(<PixelynAvatar state="bloqueada" />);
    expect(blocked).toContain("bloqueada");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `C:\Kamilly\harness`): `npm run test:ui -- tests/ui/confere-ui.test.tsx -t "Pixelyn avatar"`
Expected: FAIL — `PixelynAvatar` does not exist.

- [ ] **Step 3: Implement the avatar**

Create `harness/src/ui/components/PixelynAvatar.tsx`. The avatar is pure CSS/SVG (no asset dependency), keyed by `state`. Classes are styled in Task 6; the `aria-label` carries the state for tests and accessibility.

```tsx
import type { ReactElement } from "react";

import type { PixelynState } from "../lib/pixelyn-state.js";

const STATE_LABEL: Record<PixelynState, string> = {
  parada: "Pixelyn parada, esperando",
  pensando: "Pixelyn pensando",
  "preciso-de-dado": "Pixelyn precisa de um dado",
  trabalhando: "Pixelyn trabalhando",
  feito: "Pixelyn feliz, tarefa feita",
  bloqueada: "Pixelyn em atenção, bloqueada"
};

export function PixelynAvatar(props: {
  state: PixelynState;
  size?: number;
}): ReactElement {
  const size = props.size ?? 56;
  return (
    <div
      aria-label={STATE_LABEL[props.state]}
      className={`px px--${props.state}`}
      role="img"
      style={{ width: size, height: size }}
    >
      <span className="px__ant" aria-hidden="true" />
      <span className="px__plus" aria-hidden="true" />
      <span className="px__face" aria-hidden="true">
        <span className="px__eye px__eye--l" />
        <span className="px__eye px__eye--r" />
        <span className="px__cheek px__cheek--l" />
        <span className="px__cheek px__cheek--r" />
        <span className="px__mouth" />
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `C:\Kamilly\harness`): `npm run test:ui -- tests/ui/confere-ui.test.tsx -t "Pixelyn avatar"`
Expected: PASS. (The avatar is unstyled until Task 6 — that is fine; the test only checks the label text.)

- [ ] **Step 5: Typecheck and commit**

Run (from `C:\Kamilly\harness`): `npm run typecheck`
```bash
cd C:/Kamilly && git add harness/src/ui/components/PixelynAvatar.tsx harness/tests/ui/confere-ui.test.tsx && git commit -m "feat(ui): pixelyn avatar component"
```

---

## Task 3: Slim Rail + Assistant-First Routing

**Files:**
- Create: `harness/src/ui/components/SlimRail.tsx`
- Modify: `harness/src/ui/types.ts`
- Modify: `harness/src/ui/App.tsx`

Note: `App.tsx` will import `AssistantScreen` which is created in Task 5. To keep this task self-contained and compiling, App routes Operações/Sessões now and renders a minimal inline placeholder for Conversa; Task 5 swaps in `AssistantScreen`. (The placeholder is replaced in Task 5, not left behind.)

- [ ] **Step 1: Update `ScreenId`**

Replace the entire contents of `harness/src/ui/types.ts` with:

```ts
export type ScreenId = "conversa" | "operacoes" | "sessoes";
```

- [ ] **Step 2: Create the slim rail**

Create `harness/src/ui/components/SlimRail.tsx`:

```tsx
import { ClipboardList, MessageSquare, RadioTower } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import type { PixelynState } from "../lib/pixelyn-state.js";
import type { ScreenId } from "../types.js";
import { PixelynAvatar } from "./PixelynAvatar.js";

const DESTINATIONS: Array<{ id: ScreenId; label: string; icon: typeof MessageSquare }> = [
  { id: "conversa", label: "Conversa", icon: MessageSquare },
  { id: "operacoes", label: "Operações", icon: ClipboardList },
  { id: "sessoes", label: "Sessões", icon: RadioTower }
];

export function SlimRail(props: {
  activeScreen: ScreenId;
  pixelynState: PixelynState;
  onNavigate: (screen: ScreenId) => void;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Navegação principal">
        <div className="rail__pixelyn">
          <PixelynAvatar state={props.pixelynState} size={40} />
          <span className="rail__alive">viva</span>
        </div>
        <nav className="rail__nav">
          {DESTINATIONS.map((dest) => {
            const Icon = dest.icon;
            const active = props.activeScreen === dest.id;
            return (
              <button
                aria-current={active ? "page" : undefined}
                className={`rail__item ${active ? "rail__item--active" : ""}`}
                key={dest.id}
                onClick={() => props.onNavigate(dest.id)}
                title={dest.label}
                type="button"
              >
                <Icon aria-hidden="true" size={18} />
                <span className="rail__label">{dest.label}</span>
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

- [ ] **Step 3: Rewrite `App.tsx` for assistant-first routing**

Replace the entire contents of `harness/src/ui/App.tsx` with (note the temporary Conversa placeholder, replaced in Task 5):

```tsx
import { useState } from "react";
import type { ReactElement } from "react";

import { SlimRail } from "./components/SlimRail.js";
import { OperationsScreen } from "./screens/OperationsScreen.js";
import { SessionsScreen } from "./screens/SessionsScreen.js";
import type { ScreenId } from "./types.js";

export function App(): ReactElement {
  const [screen, setScreen] = useState<ScreenId>("conversa");

  return (
    <SlimRail activeScreen={screen} onNavigate={setScreen} pixelynState="parada">
      {screen === "conversa" ? (
        <section className="screen">
          <p className="eyebrow">Confere</p>
          <h1>Conversa</h1>
          <p className="screen-lead">Assistente em preparação.</p>
        </section>
      ) : null}
      {screen === "operacoes" ? <OperationsScreen /> : null}
      {screen === "sessoes" ? <SessionsScreen /> : null}
    </SlimRail>
  );
}
```

- [ ] **Step 4: Typecheck (expect failures only from the old UI test, not from src)**

Run (from `C:\Kamilly\harness`): `npm run typecheck`
Expected: PASS for `src/**`. If `tsc` flags `tests/ui/confere-ui.test.tsx` (it still references the old structure), that is fixed in Task 7 — but typecheck should not fail on the new `src` files. If `src` fails, fix before continuing.

- [ ] **Step 5: Commit**

```bash
cd C:/Kamilly && git add harness/src/ui/components/SlimRail.tsx harness/src/ui/types.ts harness/src/ui/App.tsx && git commit -m "feat(ui): slim rail + assistant-first routing"
```

---

## Task 4: PlanCard Component

**Files:**
- Create: `harness/src/ui/components/PlanCard.tsx`
- Test: `harness/tests/ui/confere-ui.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

Append inside `describe("Confere UI", ...)` in `harness/tests/ui/confere-ui.test.tsx` (and add `import { PlanCard } from "../../src/ui/components/PlanCard.js";` to the imports):

```tsx
  it("renders the plan card with business facts and no raw json", () => {
    const html = renderToString(
      <PlanCard
        facts={{
          customerName: "AZUOS ASSESSORIA",
          value: "R$ 250,00",
          dueDate: "30/06/2026",
          action: "Gerar boleto · Asaas"
        }}
        approvalAvailable
        onApprove={() => undefined}
      />
    );

    expect(html).toContain("AZUOS ASSESSORIA");
    expect(html).toContain("R$ 250,00");
    expect(html).toContain("Aprovar execução");
    expect(html).not.toContain("{\"");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `C:\Kamilly\harness`): `npm run test:ui -- tests/ui/confere-ui.test.tsx -t "plan card"`
Expected: FAIL — `PlanCard` does not exist.

- [ ] **Step 3: Implement PlanCard**

Create `harness/src/ui/components/PlanCard.tsx`:

```tsx
import { useState } from "react";
import type { ReactElement } from "react";

import { ActionButton } from "./ActionButton.js";

export type PlanFacts = {
  customerName?: string;
  value?: string;
  dueDate?: string;
  action?: string;
};

export function PlanCard(props: {
  facts: PlanFacts;
  approvalAvailable: boolean;
  technicalDetail?: string;
  onApprove: () => void;
}): ReactElement {
  const [showDetail, setShowDetail] = useState(false);
  const rows: Array<[string, string | undefined]> = [
    ["Cliente", props.facts.customerName],
    ["Valor", props.facts.value],
    ["Vencimento", props.facts.dueDate],
    ["Ação", props.facts.action]
  ];

  return (
    <div className="plan-card">
      <dl className="plan-card__facts">
        {rows
          .filter(([, value]) => Boolean(value))
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      <div className="plan-card__actions">
        <ActionButton disabled={!props.approvalAvailable} onClick={props.onApprove} variant="primary">
          Aprovar execução
        </ActionButton>
        {props.technicalDetail ? (
          <button className="plan-card__detail-toggle" onClick={() => setShowDetail((v) => !v)} type="button">
            {showDetail ? "ocultar resumo técnico" : "ver resumo técnico"}
          </button>
        ) : null}
      </div>
      {showDetail && props.technicalDetail ? (
        <pre className="plan-card__detail">{props.technicalDetail}</pre>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `C:\Kamilly\harness`): `npm run test:ui -- tests/ui/confere-ui.test.tsx -t "plan card"`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run (from `C:\Kamilly\harness`): `npm run typecheck`
```bash
cd C:/Kamilly && git add harness/src/ui/components/PlanCard.tsx harness/tests/ui/confere-ui.test.tsx && git commit -m "feat(ui): plan card with business facts"
```

---

## Task 5: AssistantScreen (Conversation Home)

**Files:**
- Create: `harness/src/ui/screens/AssistantScreen.tsx`
- Modify: `harness/src/ui/App.tsx`
- Delete: `harness/src/ui/screens/WorkflowScreen.tsx`, `harness/src/ui/screens/HomeScreen.tsx`

The AssistantScreen recasts `WorkflowScreen` as a single conversation (no per-module pre-selection — the agent infers the module from the request). It owns the Pixelyn phase, surfaces the agent's questions/summary, shows `PlanCard` when a draft exists, and opens `ConfirmationSheet` for the live gate. It exposes a callback so `App` can reflect Pixelyn's state in the rail.

- [ ] **Step 1: Create AssistantScreen**

Create `harness/src/ui/screens/AssistantScreen.tsx`:

```tsx
import { Send } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";

import type { OperationSummary } from "../../core/operation-summary.js";
import type { AgentResultView, ConfirmationSheetView } from "../../server/api-types.js";
import { executeOperation, getConfirmationSheet, getOperation, runAgentTurn } from "../api.js";
import { ActionButton } from "../components/ActionButton.js";
import { ConfirmationSheet } from "../components/ConfirmationSheet.js";
import { PixelynAvatar } from "../components/PixelynAvatar.js";
import { PlanCard, type PlanFacts } from "../components/PlanCard.js";
import { pixelynStateFromResult, type PixelynPhase, type PixelynState } from "../lib/pixelyn-state.js";

function factsFromOperation(operation: OperationSummary | undefined, result: AgentResultView): PlanFacts {
  return {
    customerName: operation?.customerName,
    value: operation?.unitValue !== undefined ? `R$ ${operation.unitValue}` : undefined,
    dueDate: operation?.dueDateIso,
    action: result.toolName?.includes("asaas") ? "Gerar boleto · Asaas" : "Venda + boleto · Conta Azul"
  };
}

export function AssistantScreen(props: {
  onPixelynState?: (state: PixelynState) => void;
}): ReactElement {
  const [request, setRequest] = useState("");
  const [sessionId] = useState(() => `confere_${Date.now()}`);
  const [result, setResult] = useState<AgentResultView | undefined>();
  const [draftOperationId, setDraftOperationId] = useState<string | undefined>();
  const [operation, setOperation] = useState<OperationSummary | undefined>();
  const [confirmationSheet, setConfirmationSheet] = useState<ConfirmationSheetView | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phase, setPhase] = useState<PixelynPhase>("idle");
  const [error, setError] = useState<string | undefined>();

  const pixelynState = pixelynStateFromResult(result, phase);
  useEffect(() => {
    props.onPixelynState?.(pixelynState);
  }, [pixelynState, props]);

  async function prepare(): Promise<void> {
    setPhase("preparing");
    setError(undefined);
    setConfirmOpen(false);
    setConfirmationSheet(undefined);
    try {
      const response = await runAgentTurn({ request, sessionId });
      setResult(response.result);
      setDraftOperationId(response.draftOperationId);
      if (response.draftOperationId) {
        const summary = await getOperation(response.draftOperationId);
        setOperation(summary.operation);
      } else {
        setOperation(undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao preparar operação.");
    } finally {
      setPhase("idle");
    }
  }

  async function reviewExecution(): Promise<void> {
    if (!draftOperationId) return;
    setError(undefined);
    try {
      const sheetResponse = await getConfirmationSheet(draftOperationId);
      if (sheetResponse.status === "blocked") {
        setError(sheetResponse.reason);
        return;
      }
      setConfirmationSheet(sheetResponse.sheet);
      setConfirmOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar confirmação.");
    }
  }

  async function approve(): Promise<void> {
    if (!draftOperationId) return;
    setPhase("executing");
    setError(undefined);
    try {
      const executed = await executeOperation(draftOperationId);
      if (executed.status === "blocked") {
        setError(executed.reason);
        return;
      }
      setOperation(executed.operation);
      setResult((prev) => (prev ? { ...prev, status: "executed", receiptStatus: executed.receiptStatus } : prev));
      setConfirmOpen(false);
      setDraftOperationId(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao executar operação.");
    } finally {
      setPhase("idle");
    }
  }

  return (
    <section className="assistant">
      <header className="assistant__top">
        <div className="assistant__title">Conversa</div>
      </header>

      <div className="assistant__thread">
        {!result ? (
          <div className="assistant__greeting">
            <PixelynAvatar state={pixelynState} size={64} />
            <p>E aí, o que vamos resolver hoje?</p>
          </div>
        ) : null}

        {result ? (
          <div className="assistant__turn">
            <PixelynAvatar state={pixelynState} size={36} />
            <div className="assistant__bubble">
              {result.summary ? <p className="assistant__say">{result.summary}</p> : null}
              {result.questions.map((q) => (
                <p className="assistant__say" key={q}>{q}</p>
              ))}
              {result.warnings.map((w) => (
                <p className="assistant__warn" key={w}>{w}</p>
              ))}
              {draftOperationId ? (
                <PlanCard
                  approvalAvailable={result.approvalAvailable}
                  facts={factsFromOperation(operation, result)}
                  onApprove={() => void reviewExecution()}
                  technicalDetail={operation ? JSON.stringify(operation, null, 2) : undefined}
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {error ? <div className="notice notice--danger">{error}</div> : null}
      </div>

      <div className="assistant__composer">
        <input
          aria-label="Peça algo à Pixelyn"
          className="assistant__input"
          onChange={(event) => setRequest(event.target.value)}
          placeholder="Peça algo à Pixelyn…"
          value={request}
        />
        <ActionButton
          disabled={!request.trim() || phase !== "idle"}
          icon={Send}
          onClick={() => void prepare()}
          variant="primary"
        >
          Enviar
        </ActionButton>
      </div>

      <ConfirmationSheet
        busy={phase === "executing"}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void approve()}
        open={confirmOpen}
        sheet={confirmationSheet}
      />
    </section>
  );
}
```

- [ ] **Step 2: Wire AssistantScreen into App and lift Pixelyn state to the rail**

Replace the entire contents of `harness/src/ui/App.tsx` with:

```tsx
import { useState } from "react";
import type { ReactElement } from "react";

import { SlimRail } from "./components/SlimRail.js";
import { AssistantScreen } from "./screens/AssistantScreen.js";
import { OperationsScreen } from "./screens/OperationsScreen.js";
import { SessionsScreen } from "./screens/SessionsScreen.js";
import type { PixelynState } from "./lib/pixelyn-state.js";
import type { ScreenId } from "./types.js";

export function App(): ReactElement {
  const [screen, setScreen] = useState<ScreenId>("conversa");
  const [pixelynState, setPixelynState] = useState<PixelynState>("parada");

  return (
    <SlimRail activeScreen={screen} onNavigate={setScreen} pixelynState={pixelynState}>
      {screen === "conversa" ? <AssistantScreen onPixelynState={setPixelynState} /> : null}
      {screen === "operacoes" ? <OperationsScreen /> : null}
      {screen === "sessoes" ? <SessionsScreen /> : null}
    </SlimRail>
  );
}
```

- [ ] **Step 3: Delete the replaced screens**

```bash
cd C:/Kamilly && git rm harness/src/ui/screens/WorkflowScreen.tsx harness/src/ui/screens/HomeScreen.tsx
```

- [ ] **Step 4: Typecheck**

Run (from `C:\Kamilly\harness`): `npm run typecheck`
Expected: PASS for `src/**`. (`tests/ui/confere-ui.test.tsx` is rewritten in Task 7; if it still imports a deleted screen, that is fixed there. `src` must compile cleanly.)

- [ ] **Step 5: Commit**

```bash
cd C:/Kamilly && git add harness/src/ui/screens/AssistantScreen.tsx harness/src/ui/App.tsx && git commit -m "feat(ui): assistant conversation screen replaces per-module workflow"
```

---

## Task 6: Visual System — Finance OS claro + Pixelyn

**Files:**
- Modify: `harness/src/ui/styles.css`

Add the rail, conversation, plan-card, and avatar styles (including the idle animation). Keep the existing Finance OS claro tokens already in the file; append the new blocks. Do not remove existing classes still used by `OperationsScreen`/`SessionsScreen`/`StatusPill`/`ActionButton`.

- [ ] **Step 1: Append the new styles**

Append to `harness/src/ui/styles.css`:

```css
/* ---- Slim rail ---- */
.rail {
  width: 64px;
  background: #ffffff;
  border-right: 1px solid #e6eaf0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 0;
  gap: 14px;
}
.rail__pixelyn { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.rail__alive { font-size: 9px; font-weight: 800; letter-spacing: .3px; color: #8a93a3; }
.rail__nav { display: flex; flex-direction: column; gap: 6px; width: 100%; align-items: center; }
.rail__item {
  width: 44px; height: 44px; border: 0; border-radius: 10px; background: transparent;
  color: #8a93a3; cursor: pointer; display: grid; place-items: center; position: relative;
}
.rail__item:hover { background: #f1f4f8; color: #123c69; }
.rail__item--active { background: #eaf0f7; color: #123c69; }
.rail__label {
  position: absolute; left: 52px; white-space: nowrap; background: #18202f; color: #fff;
  font-size: 11px; padding: 4px 8px; border-radius: 6px; opacity: 0; pointer-events: none;
  transition: opacity .12s;
}
.rail__item:hover .rail__label { opacity: 1; }

/* ---- Pixelyn avatar ---- */
.px {
  position: relative; border-radius: 26%; background: #F2911B; flex: none;
  box-shadow: 0 5px 12px rgba(242,145,27,.35);
}
.px--parada { animation: px-breathe 3.4s ease-in-out infinite; }
.px__ant { position: absolute; top: -22%; left: 50%; width: 3.5%; min-width: 2px; height: 20%; background: #df7f0d; transform: translateX(-50%); }
.px__plus { position: absolute; top: -34%; left: 50%; width: 14%; aspect-ratio: 1; background: #F2911B; border-radius: 18%; transform: translateX(-50%) rotate(45deg); }
.px--parada .px__plus { animation: px-pulse 1.9s ease-in-out infinite; }
.px__face { position: absolute; inset: 20% 16% 22%; background: #FBE6CC; border-radius: 16%; }
.px__eye { position: absolute; top: 16%; width: 9%; height: 11%; min-width: 4px; min-height: 5px; border-radius: 40%; background: #3a2410; }
.px__eye--l { left: 15%; }
.px__eye--r { right: 15%; }
.px--parada .px__eye { animation: px-blink 4.2s steps(1) infinite; }
.px__cheek { position: absolute; top: 33%; width: 9%; height: 5%; min-height: 3px; border-radius: 50%; background: #f3a39c; }
.px__cheek--l { left: 6%; }
.px__cheek--r { right: 6%; }
.px__mouth { position: absolute; bottom: 14%; left: 50%; transform: translateX(-50%); width: 20%; height: 9%; min-width: 9px; border: 1.6px solid #3a2410; border-top: 0; border-radius: 0 0 60% 60%; }
.px--feito { background: #F2911B; }
.px--feito .px__mouth { height: 13%; background: #3a2410; border: 0; border-radius: 0 0 60% 60%; }
.px--feito .px__eye { height: 7%; border-radius: 50% 50% 0 0; top: 18%; }
.px--pensando .px__mouth, .px--preciso-de-dado .px__mouth { width: 12%; height: 0; border-bottom: 1.6px solid #3a2410; border-radius: 0; bottom: 18%; }
.px--trabalhando .px__mouth { width: 11%; height: 11%; border: 1.6px solid #3a2410; border-radius: 50%; bottom: 14%; }
.px--bloqueada { background: #e8862a; }
.px--bloqueada .px__mouth { width: 20%; height: 0; border-bottom: 1.6px solid #3a2410; border-radius: 0; bottom: 18%; }

@keyframes px-breathe { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.5px); } }
@keyframes px-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(242,145,27,.5); } 50% { box-shadow: 0 0 0 5px rgba(242,145,27,0); } }
@keyframes px-blink { 0%,96%,100% { transform: scaleY(1); } 98% { transform: scaleY(.15); } }

/* ---- Assistant conversation ---- */
.assistant { display: flex; flex-direction: column; height: 100%; max-width: 880px; margin: 0 auto; }
.assistant__top { padding: 14px 4px; border-bottom: 1px solid #e6eaf0; }
.assistant__title { font-weight: 800; color: #18202f; }
.assistant__thread { flex: 1; overflow: auto; padding: 18px 4px; display: flex; flex-direction: column; gap: 14px; }
.assistant__greeting { display: flex; flex-direction: column; align-items: center; gap: 12px; color: #5d6878; margin: auto 0; }
.assistant__turn { display: flex; gap: 10px; align-items: flex-start; }
.assistant__bubble { max-width: 80%; }
.assistant__say { font-size: 13px; color: #3a4658; margin: 0 0 8px; line-height: 1.45; }
.assistant__warn { font-size: 12px; color: #a05a00; background: #fff7e6; border-radius: 8px; padding: 7px 10px; margin: 0 0 8px; }
.assistant__composer { display: flex; gap: 10px; align-items: center; padding: 12px 4px; border-top: 1px solid #e6eaf0; }
.assistant__input { flex: 1; height: 42px; border: 1px solid #e6eaf0; border-radius: 10px; padding: 0 14px; background: #f7f9fb; color: #18202f; }

/* ---- Plan card ---- */
.plan-card { background: #fff; border: 1px solid #dce1e8; border-radius: 12px; padding: 15px; box-shadow: 0 2px 8px rgba(20,30,50,.05); }
.plan-card__facts { display: grid; grid-template-columns: 1fr 1fr; gap: 11px 20px; margin: 0 0 13px; }
.plan-card__facts dt { font-size: 10px; color: #8a93a3; margin-bottom: 2px; }
.plan-card__facts dd { font-size: 13px; color: #18202f; font-weight: 600; margin: 0; }
.plan-card__actions { display: flex; gap: 12px; align-items: center; }
.plan-card__detail-toggle { background: none; border: 0; color: #5d6878; font-size: 12px; cursor: pointer; padding: 6px 2px; }
.plan-card__detail { background: #f1f4f8; border-radius: 8px; padding: 10px; font-size: 11px; color: #465065; margin: 10px 0 0; max-height: 220px; overflow: auto; white-space: pre-wrap; }
```

- [ ] **Step 2: Manual visual sanity (optional but recommended)**

Run (from `C:\Kamilly\harness`): `npm run desktop:dev`. Expect the window to open with the slim rail, the Pixelyn avatar breathing in the rail, and the conversation greeting. Close it. (No automated assertion; the renderer tests cover structure.)

- [ ] **Step 3: Typecheck and commit**

Run (from `C:\Kamilly\harness`): `npm run typecheck`
```bash
cd C:/Kamilly && git add harness/src/ui/styles.css && git commit -m "style(ui): finance-os-claro rail, conversation, plan card, pixelyn avatar"
```

---

## Task 7: Rewrite UI Tests For The New Structure

**Files:**
- Modify: `harness/tests/ui/confere-ui.test.tsx`

The existing top-level structure tests assert the OLD UI (5 tabs, HomeScreen "Modo de operação"/"Quota do modelo"). Rewrite them for the assistant-first shell while keeping the new component tests added in Tasks 2 and 4 and the ConfirmationSheet/OperationsScreen tests that still pass.

- [ ] **Step 1: Replace the test file**

Replace the entire contents of `harness/tests/ui/confere-ui.test.tsx` with:

```tsx
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../../src/ui/App.js";
import { ConfirmationSheet } from "../../src/ui/components/ConfirmationSheet.js";
import { PixelynAvatar } from "../../src/ui/components/PixelynAvatar.js";
import { PlanCard } from "../../src/ui/components/PlanCard.js";
import { OperationsScreen } from "../../src/ui/screens/OperationsScreen.js";

describe("Confere UI", () => {
  it("renders the assistant-first shell with the three rail destinations", () => {
    const html = renderToString(<App />);
    expect(html).toContain("Confere");
    expect(html).toContain("Conversa");
    expect(html).toContain("Operações");
    expect(html).toContain("Sessões");
  });

  it("renders the Pixelyn presence in the rail", () => {
    const html = renderToString(<App />);
    expect(html).toContain("viva");
    expect(html).toContain("Pixelyn");
  });

  it("greets the operator with the informal tone by default", () => {
    const html = renderToString(<App />);
    expect(html).toContain("o que vamos resolver hoje");
  });

  it("renders the Pixelyn avatar with a state label for accessibility", () => {
    expect(renderToString(<PixelynAvatar state="feito" />)).toContain("feito");
    expect(renderToString(<PixelynAvatar state="bloqueada" />)).toContain("bloqueada");
  });

  it("renders the plan card with business facts and no raw json", () => {
    const html = renderToString(
      <PlanCard
        facts={{
          customerName: "AZUOS ASSESSORIA",
          value: "R$ 250,00",
          dueDate: "30/06/2026",
          action: "Gerar boleto · Asaas"
        }}
        approvalAvailable
        onApprove={() => undefined}
      />
    );
    expect(html).toContain("AZUOS ASSESSORIA");
    expect(html).toContain("Aprovar execução");
    expect(html).not.toContain("{\"");
  });

  it("renders the final confirmation sheet before live approval", () => {
    const html = renderToString(
      <ConfirmationSheet
        onCancel={() => undefined}
        onConfirm={() => undefined}
        open
        sheet={{
          operationId: "op_demo",
          toolName: "contaazul.create_service_sale_boleto_workflow",
          tenantId: 3047702,
          customerName: "Cliente Demonstração",
          itemName: "Honorário Contábil",
          value: "10,00",
          dueDate: "30/06/2026",
          warnings: ["Revise antes de executar."]
        }}
      />
    );
    expect(html).toContain("Confirmar execução real");
    expect(html).toContain("Cliente Demonstração");
    expect(html).toContain("Aprovar execução real");
  });

  it("renders the operations history screen", () => {
    const html = renderToString(<OperationsScreen />);
    expect(html).toContain("Histórico auditável");
    expect(html).toContain("Ledger redigido");
  });
});
```

- [ ] **Step 2: Run the full UI suite**

Run (from `C:\Kamilly\harness`): `npm run test:ui`
Expected: PASS — all UI tests (the rewritten structure tests + the pixelyn-state mapper + avatar/plan-card component tests).

Note: if `OperationsScreen` renderToString fails because it calls `listOperations()` in a `useEffect` (effects do not run under `renderToString`, so this should be safe) or reads `window.confere` at module/render time, wrap the call in the existing `if (window.confere)` guard already present in `api.ts` — do not change `OperationsScreen` logic otherwise. If the two assertions ("Histórico auditável"/"Ledger redigido") are not present in the current `OperationsScreen`, adjust the assertions to match the actual static copy rendered by that screen (read it first; do not invent copy).

- [ ] **Step 3: Run backend suite + typecheck (no regressions)**

Run (from `C:\Kamilly\harness`): `npm run test` then `npm run typecheck`
Expected: backend 157 tests pass; typecheck clean.

- [ ] **Step 4: Commit**

```bash
cd C:/Kamilly && git add harness/tests/ui/confere-ui.test.tsx && git commit -m "test(ui): cover assistant-first shell, pixelyn avatar, plan card"
```

---

## Task 8: Final Verification

**Files:** none (verification only)

- [ ] **Step 1: Full suites + typecheck**

Run (from `C:\Kamilly\harness`):
```powershell
npm run test
npm run test:ui
npm run typecheck
```
Expected: backend green; UI green; typecheck clean.

- [ ] **Step 2: No leftover references to deleted screens**

Run (from `C:\Kamilly\harness`):
```bash
grep -rnE "WorkflowScreen|HomeScreen" src tests
```
Expected: no matches (both screens were deleted and their imports removed).

- [ ] **Step 3: Manual launch smoke**

Run (from `C:\Kamilly\harness`): `npm run desktop:dev`. Confirm: slim rail with a breathing Pixelyn; "Conversa" greeting ("o que vamos resolver hoje?"); typing a request and sending shows a thinking → plan-card flow in dry-run; Operações and Sessões reachable from the rail. Close the window.

---

## Self-Review

**Spec coverage:**
- Renderer-only, backend untouched → all tasks under `src/ui/**`/`tests/ui/**`; explicit "do not touch" note. ✓
- Form factor B+C (slim rail + assistant center) → Tasks 3, 5. ✓
- Inline plan card replacing JSON dump → Task 4 + AssistantScreen; PlanCard test asserts no raw JSON. ✓
- Confirmation sheet reused as the gate → Task 5 wires existing `ConfirmationSheet`. ✓
- Pixelyn states (6, incl. preciso-de-dado + bloqueada/sessão) + informal tone → Tasks 1, 2; mapper test covers all states; greeting test covers tone. ✓
- Mascot built in code (CSS/SVG) + idle animation in v1 → Tasks 2, 6 (px-breathe/px-pulse/px-blink). ✓
- Operações/Sessões as rail destinations → Task 3 routing; reused screens. ✓
- Testing strategy (renderer + pure mapper) → Tasks 1–7. ✓

**Placeholder scan:** No TBD/TODO. Task 3's temporary Conversa placeholder is explicitly replaced in Task 5 (not left behind). Task 7 Step 2 instructs reading `OperationsScreen` copy before asserting, rather than inventing it.

**Type consistency:** `PixelynState` and `PixelynPhase` defined in Task 1 and imported consistently in Tasks 2, 3, 5. `PlanFacts` defined in Task 4 and consumed in Task 5. `AgentResultView`/`ConfirmationSheetView`/`OperationSummary` come from existing `api-types.ts`/`operation-summary.ts`. `SlimRail` prop names (`activeScreen`, `pixelynState`, `onNavigate`) match `App.tsx` usage.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-confere-ui-redesign.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, with review between tasks and fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, with checkpoints for review.

Which approach?
