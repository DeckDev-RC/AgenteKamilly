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
