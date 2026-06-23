import { existsSync } from "node:fs";
import path from "node:path";

/** Raiz do monorepo Kamilly (onde ficam `.env` e `harness/`). */
export function resolveProjectRoot(cwd = process.cwd()): string {
  let current = path.resolve(cwd);
  const fsRoot = path.parse(current).root;

  while (true) {
    if (path.basename(current).toLowerCase() === "harness") {
      return path.resolve(current, "..");
    }

    const envFile = path.join(current, ".env");
    const harnessDir = path.join(current, "harness");
    if (existsSync(envFile) && existsSync(harnessDir)) {
      return current;
    }

    if (current === fsRoot) break;
    current = path.dirname(current);
  }

  return path.resolve(cwd);
}
