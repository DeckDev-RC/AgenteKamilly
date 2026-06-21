import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ModelUsageSnapshot = {
  dailyKey: string;
  dailyRequests: number;
  requestTimestamps: number[];
  inputTokenEvents: Array<{ timestamp: number; tokens: number }>;
};

export type ModelUsageStore = {
  load(scope: string): Promise<ModelUsageSnapshot | undefined>;
  save(scope: string, snapshot: ModelUsageSnapshot): Promise<void>;
};

type UsageFile = {
  scopes?: Record<string, ModelUsageSnapshot>;
};

export function createJsonFileModelUsageStore(filePath: string): ModelUsageStore {
  return {
    async load(scope) {
      const file = await readUsageFile(filePath);
      return file.scopes?.[scope];
    },
    async save(scope, snapshot) {
      const file = await readUsageFile(filePath);
      const next: UsageFile = {
        scopes: {
          ...(file.scopes ?? {}),
          [scope]: snapshot
        }
      };
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    }
  };
}

async function readUsageFile(filePath: string): Promise<UsageFile> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as UsageFile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (isMissingFile(error)) return {};
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
  );
}
