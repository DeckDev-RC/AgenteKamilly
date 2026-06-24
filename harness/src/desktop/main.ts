import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { copyFile } from "node:fs/promises";

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

import { resolveProjectRoot } from "../core/project-root.js";
import type { RenewEvent, RenewProvider } from "../server/api-types.js";
import { createConfereService, type ConfereService } from "../server/confere-service.js";
import { startConfereLocalApi, type ConfereLocalApi } from "../server/local-api.js";
import { bootstrapPackagedUserData } from "./bootstrap-user-data.js";

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

function resolveAppIconPath(): string | undefined {
  // Empacotado: logo.png é copiado para resources (extraResources do electron-builder).
  // Dev: o asset vive no source. Pega o primeiro que existir.
  const candidates = [
    path.join(process.resourcesPath, "logo.png"),
    path.join(resolveProjectRoot(mainModuleDir), "harness", "src/ui/assets/logo/logo.png")
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function resolveDataDir(): string {
  // Empacotado: dados graváveis (artifacts, ledger, sessões, preferences) e
  // credenciais (.env, contaazul/state.json) vivem em userData — gravável em
  // qualquer máquina. resolveProjectRoot não acha `harness/` aqui e cai no
  // fallback, devolvendo a própria userData. Em dev, a raiz do monorepo.
  // Base ÚNICA: o serviço (leitura) e o renovador de sessão (escrita) usam a mesma.
  return app.isPackaged ? app.getPath("userData") : resolveProjectRoot(mainModuleDir);
}

function resolveRenewScriptPath(): string {
  // Empacotado: renew-session.cjs é copiado para resources (extraResources).
  // Dev: vive na raiz do monorepo.
  return app.isPackaged
    ? path.join(process.resourcesPath, "renew-session.cjs")
    : path.join(resolveProjectRoot(mainModuleDir), "renew-session.cjs");
}

async function createWindow(): Promise<void> {
  const dataDir = resolveDataDir();
  if (app.isPackaged) {
    bootstrapPackagedUserData(dataDir, process.resourcesPath);
  }
  confereService = await createConfereService({ cwd: dataDir });
  if (process.env.CONFERE_START_HTTP_API === "true") {
    localApi = await startConfereLocalApi({ service: confereService });
  }

  const iconPath = resolveAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Confere",
    ...(iconPath ? { icon: iconPath } : {}),
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

  const scriptPath = resolveRenewScriptPath();
  if (!existsSync(scriptPath)) {
    return { status: "unavailable", reason: `Script de renovação não encontrado: ${scriptPath}` };
  }

  const dataDir = resolveDataDir();
  // ELECTRON_RUN_AS_NODE roda o Electron como Node puro (sem depender de `node` no
  // PATH). CONFERE_DATA_DIR diz onde gravar perfil/.env/state (userData no
  // empacotado). No empacotado, NODE_PATH expõe o playwright-core que o
  // electron-builder desempacota do asar (asarUnpack); em dev ele resolve da raiz.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    CONFERE_DATA_DIR: dataDir
  };
  if (app.isPackaged) {
    childEnv.NODE_PATH = path.join(process.resourcesPath, "app.asar.unpacked", "node_modules");
  }

  let child: ChildProcess;
  try {
    child = spawn(process.execPath, [scriptPath, provider], {
      cwd: dataDir,
      env: childEnv,
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

ipcMain.handle(
  "confere:save-file-as",
  async (event, input: { sourcePath: string; defaultName?: string }) => {
    const sourcePath = String(input.sourcePath ?? "").trim();
    if (!sourcePath) {
      return { status: "cancelled" as const };
    }

    const window = BrowserWindow.fromWebContents(event.sender);
    const defaultName = input.defaultName?.trim() || path.basename(sourcePath);
    const result = window
      ? await dialog.showSaveDialog(window, {
          defaultPath: defaultName,
          filters: [{ name: "PDF", extensions: ["pdf"] }]
        })
      : await dialog.showSaveDialog({
          defaultPath: defaultName,
          filters: [{ name: "PDF", extensions: ["pdf"] }]
        });

    if (result.canceled || !result.filePath) {
      return { status: "cancelled" as const };
    }

    await copyFile(sourcePath, result.filePath);
    return { status: "saved" as const, path: result.filePath };
  }
);

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

ipcMain.handle("confere:get-app-settings", async () => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return confereService.getAppSettings();
});

ipcMain.handle("confere:update-app-settings", async (_event, input) => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return confereService.updateAppSettings(input);
});

ipcMain.handle("confere:list-conversations", async () => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return confereService.listConversations();
});

ipcMain.handle("confere:get-conversation", async (_event, id: string) => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return confereService.getConversation(id);
});

ipcMain.handle("confere:save-conversation", async (_event, input) => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return confereService.saveConversation(input);
});

ipcMain.handle("confere:delete-conversation", async (_event, id: string) => {
  if (!confereService) throw new Error("Confere service is not ready.");
  return confereService.deleteConversation(id);
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await localApi?.close();
});
