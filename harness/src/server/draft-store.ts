export type OperationDraft = {
  operationId: string;
  toolName: string;
  request: string;
  params: Record<string, unknown>;
  createdAt: string;
};

export type DraftStore = {
  save(draft: OperationDraft): void;
  get(operationId: string): OperationDraft | undefined;
  consume(operationId: string): OperationDraft | undefined;
  list(): OperationDraft[];
};

export function createDraftStore(): DraftStore {
  const drafts = new Map<string, OperationDraft>();

  return {
    save(draft) {
      drafts.set(draft.operationId, structuredClone(draft));
    },
    get(operationId) {
      const draft = drafts.get(operationId);
      return draft ? structuredClone(draft) : undefined;
    },
    consume(operationId) {
      const draft = drafts.get(operationId);
      if (!draft) return undefined;
      drafts.delete(operationId);
      return structuredClone(draft);
    },
    list() {
      return Array.from(drafts.values()).map((draft) => structuredClone(draft));
    }
  };
}
