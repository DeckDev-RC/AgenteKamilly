# Confere UI Redesign — Living Assistant (Pixelyn) Design

## Status

Approved design (brainstorming). This is a **renderer-only redesign** of the Confere desktop UI. The backend, safety model, and IPC contracts are unchanged.

## Problem

The current Confere UI is confusing and not minimal: five competing top-level tabs (Início / Conta Azul / Asaas / Operações / Sessões), a workflow screen that dumps raw `JSON.stringify(agent result)` in a `<pre>`, and dense technical panels. It reads as a dashboard with a chat box bolted on — not as the "living assistant" the product wants.

## Vision

Confere becomes an **assistant-first** app where **Pixelyn** (the ERP automation agent/mascot) is always present and visibly *alive*, reacting to what is happening. The operator works mostly by talking to her. The result is minimal, calm, and less confusing — while the agent still never executes live without the existing human gates.

## Non-Goals

- No change to the backend: `confere-service`, IPC handlers, draft store, agent dry-run gate, safe-workflow allowlist, redaction, and ledger are reused as-is.
- No change to the safety model: dry-run by default; live execution only via Electron IPC + `ALLOW_LIVE_MUTATIONS` + confirmation sheet + `APROVAR <operationId>`.
- Not the floating-overlay / desktop-pet form factor (evaluated and rejected for a finance tool — undermines trust and cramps the business-fact/confirmation/audit surfaces).
- No new providers, no official APIs.
- Scope is the renderer (`harness/src/ui/**`). No new IPC method is expected; the existing `window.confere` surface is sufficient.

## Form Factor — B+C

Single-window, assistant-first (B), with a persistent Pixelyn presence and a real operational space (C):

- **Slim rail (left, ~64px):** Pixelyn avatar at the top, always present and *alive* (status dot). Below: three destinations — **Conversa** (default), **Operações**, **Sessões**. No five loud tabs.
- **Center — assistant surface:** the conversation is the home. The operator asks in natural language; the agent replies, collects missing fields one at a time, and presents the plan as a clean card.
- **Inline plan card** replaces the raw JSON dump: shows business facts (cliente, valor, vencimento, ação) + "Aprovar execução" + a collapsible "ver resumo técnico" for the audit-minded.
- **Confirmation sheet (modal)** for live execution — the human gate, mapping to the existing live-execute IPC.
- **Operações / Sessões** are rail destinations (lighter than today), not top-level competing tabs.

## Pixelyn — the living layer

A `PixelynAvatar` component with **states** that reflect the agent/operation lifecycle. **Tone of voice: informal** (e.g., "E aí, o que vamos resolver hoje?").

| State | Trigger | Example copy |
| --- | --- | --- |
| Parada | ocioso, esperando | "E aí, o que vamos resolver hoje?" |
| Pensando | planejando / resolvendo (dry-run) | "Achando o cliente e montando o plano…" |
| Preciso de um dado | slot-filling: falta um campo | "Fechou! Só me diz: qual o vencimento?" |
| Trabalhando | executando ao vivo (com progresso) | "Gerando o boleto e enviando a cobrança…" |
| Feito | sucesso, boleto/PDF pronto | "Pronto! Boleto gerado 🎉" |
| Bloqueada | duplicata / órfã / sessão expirou / alto risco | "Opa — já existe uma venda dessa. Não vou repetir sem você confirmar." |

- **"Sessão expirou"** is a sub-tone of Bloqueada that points to the recapture action.
- **Contextual poses** (segurando boleto, calendário, cliente+) are optional flavor mapping to operation type, using the Pixelyn sprite sheet.
- **State source of truth:** derived from data `confere-service` already returns — `AgentRunResult` status (`planned` / `needs_input` / `blocked` / `executed`) and `ToolReceipt`/operation status (`succeeded` / `failed` / `blocked`). No new backend data is required. A small pure mapper (`pixelynStateFromResult`) converts an agent/exec result into a `PixelynState`.

## Interaction Flow (the money path)

1. **Pede** — operator asks in natural language.
2. **Preciso de um dado** — agent asks the single missing field at a time (slot-filling), with quick-pick shortcuts where possible.
3. **Plano (dry-run)** — inline plan card with business facts; "Aprovar execução".
4. **Confirma** — confirmation sheet (modal) with the business facts; confirming calls the existing `executeApprovedOperation` IPC, which injects `APROVAR <operationId>` server-side.
5. **Trabalha** — Pixelyn "Trabalhando", per-step progress.
6. **Feito** — boleto/PDF link (abrir/copiar); recorded to Operações (history).

Blocked path: any guard (duplicate, orphan, expired session, high-risk needing confirmation) → Pixelyn "Bloqueada", explains why in plain language, and offers the safe next action (e.g., reconhecer limpeza de venda órfã, recapturar sessão).

## Component Plan (renderer)

Reuse `src/ui/api.ts` and the API types untouched. Recompose the views:

- **Create `components/PixelynAvatar.tsx`** — renders the mascot + state. Single prop: `state: PixelynState`. Sprite-backed when assets exist; CSS/SVG fallback otherwise behind the same API.
- **Create `components/SlimRail.tsx`** — Pixelyn at top + the three destinations. Replaces `AppShell`'s sidebar.
- **Create `lib/pixelynState.ts`** — pure `pixelynStateFromResult(result)` mapper + `PixelynState` type. Unit-testable in isolation.
- **Recast `screens/WorkflowScreen.tsx` → `screens/AssistantScreen.tsx`** — the conversation home: message list, slot-filling input, inline `PlanCard`. **Remove the raw `<pre>{JSON.stringify(...)}</pre>`.**
- **Create `components/PlanCard.tsx`** — business-facts card + actions; "ver resumo técnico" collapsible (the only place raw detail is reachable, on demand).
- **Reuse/restyle `components/ConfirmationSheet.tsx`** (already exists) as the modal gate.
- **Lighten `screens/OperationsScreen.tsx` and `screens/SessionsScreen.tsx`** into rail destinations; **drop `screens/HomeScreen.tsx`** (the assistant is the home).
- **`App.tsx` routing:** default = Assistant (Conversa); Operações / Sessões via the rail.
- **`styles.css`:** Finance OS claro + Pixelyn orange — `#F2911B` as the brand/mascot accent, navy `#123c69` reserved for serious/live actions; calm, light, minimal, dense-but-readable.

## Mascot Assets

The Pixelyn avatar is **built in code (CSS/SVG) by the implementer** for v1 — no dependency on an external sprite export. `PixelynAvatar` exposes a stable `state` prop, so exported sprite art can replace the CSS/SVG internals later without touching any consumer. The reference character guides the look (orange body, cream face panel, antenna with a small cross, blush, simple expressions per state). A subtle **idle animation** (breathing + occasional blink) ships in v1 to sell the "alive" feel; other states use light transitions/affordances (e.g., a progress bar while Trabalhando).

## Visual Direction

Finance OS claro: light surfaces, restrained color, clear status pills, generous spacing in the conversation, dense-but-scannable tables in Operações. Pixelyn orange is the warm "alive" accent; navy signals the serious money actions. No marketing landing page, no heavy gradients, no uncanny-valley realism — the mascot stays simple and subtle.

## Testing Strategy

- **Renderer tests** (`renderToString`, existing jsdom config scoped to `tests/ui/`):
  - Assistant view renders the conversation shell and input.
  - `PlanCard` shows the business facts (cliente/valor/vencimento/ação) and **does not** render a raw JSON blob.
  - `PixelynAvatar` renders each `PixelynState` with the right label/affordance.
  - Blocked results render the explanatory copy and the safe next action, not a stack trace.
  - `SlimRail` shows exactly the three destinations plus the Pixelyn presence.
- **`lib/pixelynState.ts`** gets pure unit tests mapping each result shape → expected state.
- **Backend contract tests unchanged** — the `confere-service`/IPC tests already cover the safety gates.

## Resolved Decisions

1. **Mascot rendering** — built in code (CSS/SVG) by the implementer for v1, behind a stable `state` prop. Exported sprite art can swap in later with no consumer changes. No external asset export blocks v1.
2. **Idle animation** — in scope for v1: a subtle breathing + occasional blink on the avatar.
