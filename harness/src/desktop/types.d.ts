export {};

declare global {
  interface Window {
    confere?: {
      getStatus(): Promise<import("../server/api-types.js").ConfereStatus>;
      checkConnections(): Promise<import("../server/api-types.js").CheckConnectionsApiResponse>;
      renewConnection(
        provider: import("../server/api-types.js").RenewProvider
      ): Promise<import("../server/api-types.js").RenewStartApiResponse>;
      confirmRenew(
        provider: import("../server/api-types.js").RenewProvider
      ): Promise<{ status: "ok" }>;
      onRenewEvent(
        callback: (event: import("../server/api-types.js").RenewEvent) => void
      ): () => void;
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
      listAccountancyClients(): Promise<any[]>;
      searchSaleCustomers(relationId: string, searchTerm: string): Promise<any[]>;
      searchFinancialCategories(relationId: string, searchTerm: string): Promise<any[]>;
      searchServiceItems(relationId: string, searchTerm: string): Promise<any[]>;
    };
  }
}
