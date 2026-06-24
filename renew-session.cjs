/*
 * Renovação de sessão NÃO-DESTRUTIVA para o app Confere.
 *
 * Asaas: perfil persistente do Chromium (userDataDir) + storageState completo.
 *   - MFA costuma ser pedido só na 1ª vez neste computador.
 *   - Renovações seguintes reutilizam cookies/localStorage do perfil.
 *
 * Conta Azul: perfil persistente + contaazul/state.json (como antes).
 *
 * Protocolo com o app (linhas em stdout):
 *   @@READY@@            -> navegador aberto, usuário pode logar
 *   @@DONE@@             -> sessão capturada e salva com sucesso
 *   @@ERROR@@ <mensagem> -> falhou
 *
 * Uso: node renew-session.cjs <asaas|contaazul>
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// No app empacotado, o processo main passa CONFERE_DATA_DIR = userData (gravável
// em qualquer máquina) — onde o app TAMBÉM lê .env e contaazul/state.json. Em dev,
// cai no __dirname (raiz do monorepo), preservando o comportamento atual.
const ROOT = process.env.CONFERE_DATA_DIR || __dirname;

const PROVIDERS = {
  asaas: {
    label: "Asaas",
    loginUrl: "https://www.asaas.com/login",
    homeUrl: "https://www.asaas.com/dashboard/home",
    profileDir: path.join(ROOT, "asaas", "browser-profile"),
    statePath: path.join(ROOT, "asaas", "state.json"),
    envPath: path.join(ROOT, ".env")
  },
  contaazul: {
    label: "Conta Azul",
    loginUrl: "https://mais.contaazul.com/#/login",
    homeUrl: "https://mais.contaazul.com/#/dashboard",
    profileDir: path.join(ROOT, "contaazul", "browser-profile"),
    statePath: path.join(ROOT, "contaazul", "state.json"),
    envPath: null
  }
};

function log(line) {
  process.stdout.write(`${line}\n`);
}

function waitForEnter() {
  const rl = readline.createInterface({ input: process.stdin });
  return new Promise((resolve) => {
    rl.once("line", () => {
      rl.close();
      resolve();
    });
  });
}

function upsertEnvKey(envPath, key, value) {
  const line = `${key}="${String(value).replace(/"/g, '\\"')}"`;
  let content = "";
  try {
    content = fs.readFileSync(envPath, "utf-8");
  } catch {
    content = "";
  }
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    content = content.replace(pattern, line);
  } else {
    content = content.length && !content.endsWith("\n") ? `${content}\n${line}\n` : `${content}${line}\n`;
  }
  fs.writeFileSync(envPath, content, "utf-8");
}

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function openPersistentSession(chromium, config) {
  ensureDirFor(config.statePath);
  const returning = fs.existsSync(config.profileDir);

  if (returning) {
    log(
      `Perfil persistente do ${config.label} encontrado — nas próximas vezes costuma bastar login e senha (sem MFA).`
    );
  } else {
    log(
      `Primeira renovação do ${config.label} neste computador — faça login completo (incluindo MFA se solicitado).`
    );
  }

  // Usa o navegador JÁ instalado na máquina: Edge (vem no Windows 10/11) → Chrome
  // → Chromium do Playwright (só existe em dev/full). Nada de baixar navegador.
  const launchBase = { headless: false, viewport: null, args: ["--start-maximized"] };
  const channels = ["msedge", "chrome", undefined];
  let context;
  let lastError;
  for (const channel of channels) {
    try {
      context = await chromium.launchPersistentContext(
        config.profileDir,
        channel ? { ...launchBase, channel } : launchBase
      );
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!context) {
    throw new Error(
      `Não foi possível abrir um navegador (Edge/Chrome). ${lastError instanceof Error ? lastError.message : ""}`.trim()
    );
  }

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(config.homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() =>
    page.goto(config.loginUrl, { waitUntil: "domcontentloaded", timeout: 60_000 })
  );

  const currentUrl = page.url();
  if (currentUrl.includes("login") || currentUrl.includes("/mfa")) {
    log(
      `Faça login no ${config.label}. MFA só deve aparecer se o ${config.label} ainda não confiou neste perfil.`
    );
  } else {
    log(`Sessão ativa detectada no ${config.label} — confirme abaixo para atualizar os cookies do app.`);
  }

  return { context, page, returning };
}

async function captureAsaas(context, config) {
  await context.storageState({ path: config.statePath });
  const cookies = await context.cookies();
  const cookieString = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  upsertEnvKey(config.envPath, "COOKIE_STRING", cookieString);
  upsertEnvKey(config.envPath, "ASAAS_SESSION_CAPTURED_AT", new Date().toISOString());
  log(`Estado completo salvo em ${config.statePath}`);
  log("COOKIE_STRING atualizado no .env (demais chaves preservadas).");
}

async function captureContaAzul(context, config) {
  await context.storageState({ path: config.statePath });
  log(`Estado completo salvo em ${config.statePath}`);
}

async function renewProvider(chromium, providerKey) {
  const config = PROVIDERS[providerKey];
  log(`Abrindo navegador para renovar a sessão do ${config.label}...`);

  const { context } = await openPersistentSession(chromium, config);
  log("@@READY@@");

  try {
    await waitForEnter();
    log("Capturando a sessão...");

    if (providerKey === "asaas") {
      await captureAsaas(context, config);
    } else {
      await captureContaAzul(context, config);
    }

    log("@@DONE@@");
  } catch (error) {
    log(`@@ERROR@@ ${error instanceof Error ? error.message : String(error)}`);
    await context.close().catch(() => {});
    process.exit(1);
    return;
  }

  await context.close().catch(() => {});
  process.exit(0);
}

async function main() {
  const provider = (process.argv[2] || "").toLowerCase();
  if (provider !== "asaas" && provider !== "contaazul") {
    log("@@ERROR@@ provider inválido (use asaas ou contaazul)");
    process.exit(1);
    return;
  }

  // playwright-core (empacotado no app, sem navegador embutido) tem prioridade;
  // playwright completo cobre o dev. O navegador vem do sistema (Edge/Chrome).
  let chromium;
  try {
    ({ chromium } = require("playwright-core"));
  } catch {
    try {
      ({ chromium } = require("playwright"));
    } catch {
      log("@@ERROR@@ Playwright não está disponível neste ambiente.");
      process.exit(1);
      return;
    }
  }

  await renewProvider(chromium, provider);
}

main().catch((error) => {
  log(`@@ERROR@@ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
