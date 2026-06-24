import type { OperationSummary } from "../../core/operation-summary.js";
import type { Artifact } from "../../core/tool-types.js";

export function artifactsFromReceiptData(receiptData: unknown): OperationSummary["artifacts"] {
  if (!receiptData || typeof receiptData !== "object") return [];
  const artifacts = (receiptData as { artifacts?: OperationSummary["artifacts"] }).artifacts;
  return Array.isArray(artifacts) ? artifacts : [];
}

export function uniqueArtifacts(
  artifacts: OperationSummary["artifacts"] | undefined
): NonNullable<OperationSummary["artifacts"]> {
  const seen = new Set<string>();
  const unique: NonNullable<OperationSummary["artifacts"]> = [];
  for (const artifact of artifacts ?? []) {
    const key = artifact.path?.trim() || `${artifact.kind}:${artifact.label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(artifact);
  }
  return unique;
}

export function mergePdfArtifacts(input: {
  operation?: OperationSummary;
  receiptData?: unknown;
}): NonNullable<OperationSummary["artifacts"]> {
  return uniqueArtifacts([
    ...(input.operation?.artifacts ?? []),
    ...artifactsFromReceiptData(input.receiptData)
  ]).filter((artifact) => artifact.kind === "pdf");
}

export function pdfOpenLabel(artifact: Artifact, hint?: string): string {
  if (hint?.trim()) return `Abrir · ${hint.trim()}`;
  const raw = artifact.label?.trim();
  if (!raw || /^boleto pdf$/i.test(raw)) return "Abrir PDF";
  return `Abrir · ${raw}`;
}

export function pdfDownloadLabel(artifact: Artifact, hint?: string): string {
  if (hint?.trim()) return `Baixar · ${hint.trim()}`;
  const raw = artifact.label?.trim();
  if (!raw || /^boleto pdf$/i.test(raw)) return "Baixar PDF";
  return `Baixar · ${raw}`;
}

export function suggestedPdfFileName(artifact: Artifact, hint?: string): string {
  const fromPath = artifact.path?.split(/[/\\]/).pop()?.trim();
  if (fromPath && /\.pdf$/i.test(fromPath)) return fromPath;
  const base = (hint ?? artifact.label ?? "boleto").replace(/[^\w.\-() ]+/g, "_").trim() || "boleto";
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

export async function openPdfArtifact(filePath: string): Promise<void> {
  if (!filePath.trim()) return;
  if (window.confere?.openPath) {
    await window.confere.openPath(filePath);
    return;
  }
  window.open(`file:///${filePath.replace(/\\/g, "/")}`, "_blank");
}

export async function downloadPdfArtifact(
  filePath: string,
  defaultName?: string
): Promise<"saved" | "cancelled" | "unavailable"> {
  if (!filePath.trim()) return "unavailable";
  if (window.confere?.saveFileAs) {
    const result = await window.confere.saveFileAs({
      sourcePath: filePath,
      defaultName
    });
    return result.status;
  }
  await openPdfArtifact(filePath);
  return "saved";
}
