import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";

import { createConfereService, type ConfereService } from "../server/confere-service.js";
import { startConfereLocalApi, type ConfereLocalApi } from "../server/local-api.js";

let mainWindow: BrowserWindow | undefined;
let localApi: ConfereLocalApi | undefined;
let confereService: ConfereService | undefined;

async function createWindow(): Promise<void> {
  confereService = await createConfereService();
  if (process.env.CONFERE_START_HTTP_API === "true") {
    localApi = await startConfereLocalApi({ service: confereService });
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    title: "Confere",
    backgroundColor: "#f7f8fb",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Sandbox disabled because the ESM (.mjs) preload emitted by electron-vite
      // cannot run in a sandboxed renderer. The renderer only loads local bundled
      // content (no remote/untrusted web), so contextIsolation + nodeIntegration:false
      // remain the effective boundary keeping Node out of the renderer.
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

ipcMain.handle("confere:get-status", async () => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return confereService.getStatus();
});

ipcMain.handle("confere:run-agent-turn", async (_event, input) => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return confereService.runAgentTurn(input);
});

ipcMain.handle("confere:list-operations", async () => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return { status: "ok", operations: await confereService.listOperations(50) };
});

ipcMain.handle("confere:get-operation", async (_event, operationId: string) => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return { status: "ok", operation: await confereService.summarizeOperation(operationId) };
});

ipcMain.handle("confere:get-confirmation-sheet", async (_event, operationId: string) => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return confereService.getConfirmationSheet(operationId);
});

ipcMain.handle("confere:execute-approved-operation", async (_event, operationId: string) => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return confereService.executeApprovedOperation({ operationId });
});

ipcMain.handle("confere:open-external", async (_event, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle("confere:open-path", async (_event, filePath: string) => {
  await shell.openPath(filePath);
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await localApi?.close();
});
