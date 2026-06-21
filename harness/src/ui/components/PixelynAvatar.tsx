import type { ReactElement } from "react";

import type { PixelynState } from "../lib/pixelyn-state.js";

const STATE_LABEL: Record<PixelynState, string> = {
  parada: "Pixelyn parada, esperando",
  pensando: "Pixelyn pensando",
  "preciso-de-dado": "Pixelyn precisa de um dado",
  trabalhando: "Pixelyn trabalhando",
  feito: "Pixelyn feliz, tarefa feita",
  bloqueada: "Pixelyn em atenção, bloqueada"
};

export function PixelynAvatar(props: {
  state: PixelynState;
  size?: number;
}): ReactElement {
  const size = props.size ?? 56;
  return (
    <div
      aria-label={STATE_LABEL[props.state]}
      className={`px px--${props.state}`}
      role="img"
      style={{ width: size, height: size }}
    >
      <span className="px__ant" aria-hidden="true" />
      <span className="px__plus" aria-hidden="true" />
      <span className="px__face" aria-hidden="true">
        <span className="px__eye px__eye--l" />
        <span className="px__eye px__eye--r" />
        <span className="px__cheek px__cheek--l" />
        <span className="px__cheek px__cheek--r" />
        <span className="px__mouth" />
      </span>
    </div>
  );
}
