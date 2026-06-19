import type { RuntimeMode } from "./tool-types.js";

export class MutationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationBlockedError";
  }
}

export function parseRuntimeMode(value: string | undefined): RuntimeMode {
  return value === "live" ? "live" : "dry-run";
}

export function assertLiveMutationAllowed(input: {
  runtimeMode: RuntimeMode;
  allowLiveMutations: boolean;
  operationId: string;
  approvedOperationId?: string;
}): void {
  if (input.runtimeMode !== "live") {
    throw new MutationBlockedError("Mutation blocked: runtime mode is dry-run.");
  }

  if (!input.allowLiveMutations) {
    throw new MutationBlockedError(
      "Mutation blocked: ALLOW_LIVE_MUTATIONS must be true for live writes."
    );
  }

  if (!input.approvedOperationId || input.approvedOperationId !== input.operationId) {
    throw new MutationBlockedError(
      "Mutation blocked: approval must reference the exact operation id."
    );
  }
}
