import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function resolveEnvFilePath(cwd: string): string {
  return path.resolve(cwd, ".env");
}

export function upsertEnvKey(envPath: string, key: string, value: string): void {
  const line = `${key}="${String(value).replace(/"/g, '\\"')}"`;
  let content = "";
  try {
    content = readFileSync(envPath, "utf-8");
  } catch {
    content = "";
  }
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
  if (pattern.test(content)) {
    content = content.replace(pattern, line);
  } else {
    content =
      content.length && !content.endsWith("\n") ? `${content}\n${line}\n` : `${content}${line}\n`;
  }
  mkdirSync(path.dirname(envPath), { recursive: true });
  writeFileSync(envPath, content, "utf-8");
}

export function readEnvKey(envPath: string, key: string): string | undefined {
  if (!existsSync(envPath)) return undefined;
  try {
    const content = readFileSync(envPath, "utf-8");
    const pattern = new RegExp(`^${escapeRegExp(key)}=(?:"([^"]*)"|([^\\n#]*))`, "m");
    const match = pattern.exec(content);
    if (!match) return undefined;
    return (match[1] ?? match[2] ?? "").trim() || undefined;
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
