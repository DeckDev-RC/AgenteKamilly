import { AlertTriangle } from "lucide-react";
import type { ReactElement } from "react";

import type { ConnectionHealth } from "../../server/api-types.js";

export function ConnectionBanner(props: {
  connections: ConnectionHealth[];
  onOpen: () => void;
}): ReactElement | null {
  const broken = props.connections.filter((connection) => connection.status !== "healthy");
  if (broken.length === 0) return null;

  const names = broken.map((connection) => connection.label).join(" e ");
  const message =
    broken.length === 1
      ? `A conexão ${names} precisa de atenção.`
      : `As conexões ${names} precisam de atenção.`;

  return (
    <div className="conn-banner" role="alert">
      <AlertTriangle aria-hidden="true" size={16} />
      <span className="conn-banner__text">{message}</span>
      <button className="conn-banner__btn" onClick={props.onOpen} type="button">
        Renovar credenciais
      </button>
    </div>
  );
}
