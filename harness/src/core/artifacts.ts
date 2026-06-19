import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Artifact, ArtifactKind, Provider } from "./tool-types.js";

export async function saveTextArtifact(input: {
  artifactsDir: string;
  provider: Provider;
  operationId: string;
  label: string;
  fileName: string;
  contents: string;
}): Promise<Artifact> {
  const outputPath = path.join(input.artifactsDir, input.provider, input.operationId, input.fileName);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, input.contents, "utf8");

  return {
    kind: "txt",
    path: outputPath,
    label: input.label,
    sha256: sha256(input.contents)
  };
}

export async function saveJsonArtifact(input: {
  artifactsDir: string;
  provider: Provider;
  operationId: string;
  label: string;
  fileName: string;
  contents: unknown;
}): Promise<Artifact> {
  const outputPath = path.join(input.artifactsDir, input.provider, input.operationId, input.fileName);
  const json = `${JSON.stringify(input.contents, null, 2)}\n`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, json, "utf8");

  return {
    kind: "json",
    path: outputPath,
    label: input.label,
    sha256: sha256(json)
  };
}

export async function saveBinaryArtifact(input: {
  artifactsDir: string;
  provider: Provider;
  operationId: string;
  label: string;
  fileName: string;
  kind: Extract<ArtifactKind, "pdf" | "png" | "json">;
  contents: Buffer | Uint8Array;
}): Promise<Artifact> {
  const outputPath = path.join(input.artifactsDir, input.provider, input.operationId, input.fileName);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, input.contents);

  return {
    kind: input.kind,
    path: outputPath,
    label: input.label,
    sha256: sha256(input.contents)
  };
}

function sha256(contents: string | Buffer | Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}
