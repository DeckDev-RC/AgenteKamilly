import { Download, FileText } from "lucide-react";
import type { ReactElement } from "react";

import type { Artifact } from "../../core/tool-types.js";
import {
  downloadPdfArtifact,
  openPdfArtifact,
  pdfDownloadLabel,
  pdfOpenLabel,
  suggestedPdfFileName,
  uniqueArtifacts
} from "../lib/pdf-artifacts.js";

export function PdfArtifactActions(props: {
  artifacts: Artifact[];
  hint?: string;
  className?: string;
}): ReactElement | null {
  const pdfArtifacts = uniqueArtifacts(props.artifacts).filter((artifact) => artifact.kind === "pdf");
  if (pdfArtifacts.length === 0) return null;

  const className = ["pdf-artifact-actions", props.className].filter(Boolean).join(" ");

  return (
    <div className={className}>
      {pdfArtifacts.map((artifact) => (
        <div className="pdf-artifact-actions__group" key={artifact.path || artifact.label}>
          <button
            className="pill-btn pill-btn--primary"
            onClick={() => void openPdfArtifact(artifact.path)}
            type="button"
          >
            <FileText aria-hidden="true" size={16} />
            {pdfOpenLabel(artifact, props.hint)}
          </button>
          <button
            className="pill-btn pill-btn--ghost"
            onClick={() =>
              void downloadPdfArtifact(artifact.path, suggestedPdfFileName(artifact, props.hint))
            }
            type="button"
          >
            <Download aria-hidden="true" size={16} />
            {pdfDownloadLabel(artifact, props.hint)}
          </button>
        </div>
      ))}
    </div>
  );
}
