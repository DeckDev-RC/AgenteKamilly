export type ApprovalParseResult =
  | { approved: true; operationId: string }
  | { approved: false; operationId?: string };

export function parseApprovalText(input: string, operationId: string): ApprovalParseResult {
  const expected = `APROVAR ${operationId}`;
  if (input === expected) {
    return { approved: true, operationId };
  }
  return { approved: false };
}
