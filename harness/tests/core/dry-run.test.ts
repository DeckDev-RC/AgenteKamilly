import { describe, expect, it } from "vitest";

import {
  assertLiveMutationAllowed,
  MutationBlockedError,
  parseRuntimeMode
} from "../../src/core/dry-run.js";

describe("dry-run mutation gate", () => {
  it("defaults unknown runtime values to dry-run", () => {
    expect(parseRuntimeMode(undefined)).toBe("dry-run");
    expect(parseRuntimeMode("")).toBe("dry-run");
    expect(parseRuntimeMode("live")).toBe("live");
  });

  it("blocks mutations in dry-run mode", () => {
    expect(() =>
      assertLiveMutationAllowed({
        runtimeMode: "dry-run",
        allowLiveMutations: true,
        operationId: "op_123",
        approvedOperationId: "op_123"
      })
    ).toThrow(MutationBlockedError);
  });

  it("blocks live mode when the environment gate is disabled", () => {
    expect(() =>
      assertLiveMutationAllowed({
        runtimeMode: "live",
        allowLiveMutations: false,
        operationId: "op_123",
        approvedOperationId: "op_123"
      })
    ).toThrow("ALLOW_LIVE_MUTATIONS");
  });

  it("blocks live mode when the approved operation id does not match", () => {
    expect(() =>
      assertLiveMutationAllowed({
        runtimeMode: "live",
        allowLiveMutations: true,
        operationId: "op_123",
        approvedOperationId: "op_other"
      })
    ).toThrow("exact operation");
  });

  it("allows mutation only when live mode, env gate, and exact approval match", () => {
    expect(() =>
      assertLiveMutationAllowed({
        runtimeMode: "live",
        allowLiveMutations: true,
        operationId: "op_123",
        approvedOperationId: "op_123"
      })
    ).not.toThrow();
  });
});
