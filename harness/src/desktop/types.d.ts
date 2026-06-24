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
      saveFileAs(input: {
        sourcePath: string;
        defaultName?: string;
      }): Promise<{ status: "saved" | "cancelled"; path?: string }>;
      listAccountancyClients(): Promise<any[]>;
      searchSaleCustomers(relationId: string, searchTerm: string): Promise<any[]>;
      searchFinancialCategories(relationId: string, searchTerm: string): Promise<any[]>;
      searchServiceItems(relationId: string, searchTerm: string): Promise<any[]>;
      getAppSettings(): Promise<import("../server/api-types.js").AppSettingsView>;
      updateAppSettings(
        input: import("../server/api-types.js").UpdateAppSettingsRequest
      ): Promise<import("../server/api-types.js").UpdateAppSettingsResponse>;
      listConversations(): Promise<import("../server/api-types.js").ConversationListApiResponse>;
      getConversation(
        id: string
      ): Promise<import("../server/api-types.js").ConversationGetApiResponse>;
      saveConversation(
        input: import("../server/api-types.js").ConversationSaveApiRequest
      ): Promise<import("../server/api-types.js").ConversationSaveApiResponse>;
      deleteConversation(
        id: string
      ): Promise<import("../server/api-types.js").ConversationDeleteApiResponse>;
    };
  }
}
