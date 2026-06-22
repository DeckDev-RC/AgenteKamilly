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
