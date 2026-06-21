import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("confere", {
  getStatus: () => ipcRenderer.invoke("confere:get-status"),
  runAgentTurn: (input: import("../server/api-types.js").AgentTurnApiRequest) =>
    ipcRenderer.invoke("confere:run-agent-turn", input),
  listOperations: () => ipcRenderer.invoke("confere:list-operations"),
  getOperation: (operationId: string) => ipcRenderer.invoke("confere:get-operation", operationId),
  getConfirmationSheet: (operationId: string) =>
    ipcRenderer.invoke("confere:get-confirmation-sheet", operationId),
  executeApprovedOperation: (operationId: string) =>
    ipcRenderer.invoke("confere:execute-approved-operation", operationId),
  openExternal: (url: string) => ipcRenderer.invoke("confere:open-external", url),
  openPath: (filePath: string) => ipcRenderer.invoke("confere:open-path", filePath)
});
