export {};

declare global {
  interface Window {
    confere?: {
      getStatus(): Promise<import("../server/api-types.js").ConfereStatus>;
      runAgentTurn(
        input: import("../server/api-types.js").AgentTurnApiRequest
      ): Promise<import("../server/api-types.js").AgentTurnApiResponse>;
      listOperations(): Promise<import("../server/api-types.js").OperationListApiResponse>;
      getOperation(
        operationId: string
      ): Promise<import("../server/api-types.js").OperationSummaryApiResponse>;
      getConfirmationSheet(
        operationId: string
      ): Promise<import("../server/api-types.js").ConfirmationSheetApiResponse>;
      executeApprovedOperation(
        operationId: string
      ): Promise<import("../server/api-types.js").ExecuteOperationApiResponse>;
      openExternal(url: string): Promise<void>;
      openPath(path: string): Promise<void>;
    };
  }
}
