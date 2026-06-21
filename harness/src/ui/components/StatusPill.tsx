import type { ReactElement, ReactNode } from "react";

export function StatusPill(props: {
  tone: "neutral" | "good" | "warn" | "danger";
  children: ReactNode;
}): ReactElement {
  return <span className={`status-pill status-pill--${props.tone}`}>{props.children}</span>;
}
