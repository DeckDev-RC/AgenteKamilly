import { describe, expect, it } from "vitest";

import { parseApprovalText } from "../../src/core/approval.js";

describe("approval parser", () => {
  it("accepts only exact approval text for the operation id", () => {
    expect(parseApprovalText("APROVAR op_20260619_abc123", "op_20260619_abc123")).toEqual({
      approved: true,
      operationId: "op_20260619_abc123"
    });
  });

  it("rejects generic approval and wrong operation ids", () => {
    expect(parseApprovalText("sim", "op_123").approved).toBe(false);
    expect(parseApprovalText("aprovar op_123", "op_123").approved).toBe(false);
    expect(parseApprovalText("APROVAR op_other", "op_123").approved).toBe(false);
  });
});
