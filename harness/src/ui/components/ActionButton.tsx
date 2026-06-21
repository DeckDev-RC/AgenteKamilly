import type { LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

export function ActionButton(props: {
  icon?: LucideIcon;
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  onClick?: () => void;
}): ReactElement {
  const Icon = props.icon;
  return (
    <button
      className={`action-button action-button--${props.variant ?? "secondary"}`}
      disabled={props.disabled}
      onClick={props.onClick}
      type="button"
    >
      {Icon ? <Icon aria-hidden="true" size={16} /> : null}
      <span>{props.children}</span>
    </button>
  );
}
