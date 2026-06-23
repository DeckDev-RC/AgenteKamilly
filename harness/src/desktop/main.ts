import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, ipcMain, shell } from "electron";

import { resolveProjectRoot } from "../core/project-root.js";
import type { RenewEvent, RenewProvider } from "../server/api-types.js";
import { createConfereService, type ConfereService } from "../server/confere-service.js";
import { startConfereLocalApi, type ConfereLocalApi } from "../server/local-api.js";

const mainModuleDir = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | undefined;
let localApi: ConfereLocalApi | undefined;
let confereService: ConfereService | undefined;

const renewChildren = new Map<RenewProvider, ChildProcess>();

function sendRenewEvent(event: RenewEvent): void {
  mainWindow?.webContents.send("confere:renew-event", event);
}

function routeRenewLine(provider: RenewProvider, line: string): void {
  if (line === "@@READY@@") {
    sendRenewEvent({ provider, type: "ready" });
    return;
  }
  if (line === "@@DONE@@") {
    sendRenewEvent({ provider, type: "done", ok: true });
    return;
  }
  if (line.startsWith("@@ERROR@@")) {
    sendRenewEvent({ provider, type: "done", ok: false, detail: line.replace("@@ERROR@@", "").trim() });
    return;
  }
  sendRenewEvent({ provider, type: "log", line });
}

async function createWindow(): Promise<void> {
  confereService = await createConfereService({ cwd: mainModuleDir });
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

ipcMain.handle("confere:check-connections", async () => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return { status: "ok", connections: await confereService.checkConnections() };
});

ipcMain.handle("confere:renew-connection", async (_event, provider: RenewProvider) => {
  if (renewChildren.has(provider)) {
    return { status: "started" };
  }

  const projectRoot = resolveProjectRoot(mainModuleDir);
  const scriptPath = path.join(projectRoot, "renew-session.cjs");
  if (!existsSync(scriptPath)) {
    return { status: "unavailable", reason: `Script de renovação não encontrado: ${scriptPath}` };
  }

  let child: ChildProcess;
  try {
    // ELECTRON_RUN_AS_NODE roda o binário do Electron como Node puro, então não
    // dependemos de um `node` no PATH e o require('playwright') resolve da raiz.
    child = spawn(process.execPath, [scriptPath, provider], {
      cwd: projectRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : "Falha ao iniciar a renovação."
    };
  }

  renewChildren.set(provider, child);

  let buffer = "";
  const handleChunk = (chunk: Buffer): void => {
    buffer += chunk.toString();
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) routeRenewLine(provider, line);
      index = buffer.indexOf("\n");
    }
  };

  child.stdout?.on("data", handleChunk);
  child.stderr?.on("data", handleChunk);

  child.on("error", (error) => {
    renewChildren.delete(provider);
    sendRenewEvent({ provider, type: "done", ok: false, detail: error.message });
  });

  child.on("close", (code) => {
    renewChildren.delete(provider);
    // Se o script já emitiu @@DONE@@/@@ERROR@@, o "done" abaixo é redundante e a UI
    // ignora; cobre o caso de saída inesperada sem marcador.
    if (code !== 0) {
      sendRenewEvent({ provider, type: "done", ok: false, detail: `Processo encerrou com código ${code}.` });
    }
  });

  return { status: "started" };
});

ipcMain.handle("confere:renew-confirm", async (_event, provider: RenewProvider) => {
  const child = renewChildren.get(provider);
  child?.stdin?.write("\n");
  return { status: "ok" };
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

ipcMain.handle("confere:list-accountancy-clients", async () => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return confereService.listAccountancyClients();
});

ipcMain.handle("confere:search-sale-customers", async (_event, { relationId, searchTerm }) => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return confereService.searchSaleCustomers(relationId, searchTerm);
});

ipcMain.handle("confere:search-financial-categories", async (_event, { relationId, searchTerm }) => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return confereService.searchFinancialCategories(relationId, searchTerm);
});

ipcMain.handle("confere:search-service-items", async (_event, { relationId, searchTerm }) => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return confereService.searchServiceItems(relationId, searchTerm);
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await localApi?.close();
});
