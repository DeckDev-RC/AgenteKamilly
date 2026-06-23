import { contextBridge, ipcRenderer } from "electron";

type RenewProvider = import("../server/api-types.js").RenewProvider;
type RenewEvent = import("../server/api-types.js").RenewEvent;

contextBridge.exposeInMainWorld("confere", {
  getStatus: () => ipcRenderer.invoke("confere:get-status"),
  checkConnections: () => ipcRenderer.invoke("confere:check-connections"),
  renewConnection: (provider: RenewProvider) =>
    ipcRenderer.invoke("confere:renew-connection", provider),
  confirmRenew: (provider: RenewProvider) =>
    ipcRenderer.invoke("confere:renew-confirm", provider),
  onRenewEvent: (callback: (event: RenewEvent) => void) => {
    const handler = (_event: unknown, payload: RenewEvent): void => callback(payload);
    ipcRenderer.on("confere:renew-event", handler);
    return () => ipcRenderer.removeListener("confere:renew-event", handler);
  },
  runAgentTurn: (input: import("../server/api-types.js").AgentTurnApiRequest) =>
    ipcRenderer.invoke("confere:run-agent-turn", input),
  listOperations: () => ipcRenderer.invoke("confere:list-operations"),
  getOperation: (operationId: string) => ipcRenderer.invoke("confere:get-operation", operationId),
  getConfirmationSheet: (operationId: string) =>
    ipcRenderer.invoke("confere:get-confirmation-sheet", operationId),
  executeApprovedOperation: (operationId: string) =>
    ipcRenderer.invoke("confere:execute-approved-operation", operationId),
  openExternal: (url: string) => ipcRenderer.invoke("confere:open-external", url),
  openPath: (filePath: string) => ipcRenderer.invoke("confere:open-path", filePath),
  listAccountancyClients: () => ipcRenderer.invoke("confere:list-accountancy-clients"),
  searchSaleCustomers: (relationId: string, searchTerm: string) =>
    ipcRenderer.invoke("confere:search-sale-customers", { relationId, searchTerm }),
  searchFinancialCategories: (relationId: string, searchTerm: string) =>
    ipcRenderer.invoke("confere:search-financial-categories", { relationId, searchTerm }),
  searchServiceItems: (relationId: string, searchTerm: string) =>
    ipcRenderer.invoke("confere:search-service-items", { relationId, searchTerm })
});
