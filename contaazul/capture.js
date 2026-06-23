/*
 * Compatibilidade com scripts legados (contaazul/interativo.js, request.js).
 * A renovação oficial usa perfil persistente via renew-session.cjs (mesmo fluxo do app Confere).
 */
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const script = path.join(root, "renew-session.cjs");

console.log("=== RENOVAÇÃO DE SESSÃO — CONTA AZUL (perfil persistente) ===\n");
console.log("Redirecionando para renew-session.cjs contaazul...\n");

const result = spawnSync(process.execPath, [script, "contaazul"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE ?? "1" }
});

process.exit(result.status ?? 1);
