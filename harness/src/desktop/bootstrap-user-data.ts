import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const FALLBACK_ENV = [
  "RUNTIME_MODE=dry-run",
  "ALLOW_LIVE_MUTATIONS=false",
  "ARTIFACTS_DIR=artifacts",
  "LEDGER_PATH=artifacts/ledger/operations.jsonl",
  "CONTAAZUL_STATE_PATH=contaazul/state.json",
  ""
].join("\n");

/** Prepara userData na primeira execução do instalador (sem depender do monorepo). */
export function bootstrapPackagedUserData(dataDir: string, resourcesPath: string): void {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(path.join(dataDir, "artifacts", "ledger"), { recursive: true });
  mkdirSync(path.join(dataDir, "artifacts", "conversations"), { recursive: true });
  mkdirSync(path.join(dataDir, "contaazul"), { recursive: true });
  mkdirSync(path.join(dataDir, "asaas"), { recursive: true });

  const envPath = path.join(dataDir, ".env");
  if (existsSync(envPath)) return;

  const templatePath = path.join(resourcesPath, "default.env");
  if (existsSync(templatePath)) {
    copyFileSync(templatePath, envPath);
    return;
  }

  writeFileSync(envPath, FALLBACK_ENV, "utf-8");
}
