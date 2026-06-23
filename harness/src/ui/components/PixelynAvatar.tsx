import { useEffect, useRef } from "react";
import type { ReactElement } from "react";

import type { PixelynState } from "../lib/pixelyn-state.js";
import {
  PIXELYN_SIZE,
  PIXELYN_VISUAL_SCALE,
  type PixelynSizeKey
} from "../lib/pixelyn-sizes.js";

const STATE_LABEL: Record<PixelynState, string> = {
  parada: "Pixelyn parada, esperando",
  pensando: "Pixelyn pensando",
  "preciso-de-dado": "Pixelyn precisa de um dado",
  trabalhando: "Pixelyn trabalhando",
  feito: "Pixelyn feliz, tarefa feita",
  bloqueada: "Pixelyn em atenção, bloqueada"
};

const STATE_VIDEO: Record<PixelynState, string> = {
  parada: new URL("../assets/pixelyn/parada.webm", import.meta.url).href,
  pensando: new URL("../assets/pixelyn/pensando.webm", import.meta.url).href,
  "preciso-de-dado": new URL("../assets/pixelyn/preciso-de-dado.webm", import.meta.url).href,
  trabalhando: new URL("../assets/pixelyn/trabalhando.webm", import.meta.url).href,
  feito: new URL("../assets/pixelyn/feito.webm", import.meta.url).href,
  bloqueada: new URL("../assets/pixelyn/bloqueada.webm", import.meta.url).href
};

// Pôster PNG (transparente) por estado: aparece instantaneamente enquanto o webm
// decodifica/inicia, eliminando o "primeiro vídeo não carrega" ao abrir o app.
const STATE_POSTER: Record<PixelynState, string> = {
  parada: new URL("../assets/pixelyn/parada.png", import.meta.url).href,
  pensando: new URL("../assets/pixelyn/pensando.png", import.meta.url).href,
  "preciso-de-dado": new URL("../assets/pixelyn/preciso-de-dado.png", import.meta.url).href,
  trabalhando: new URL("../assets/pixelyn/trabalhando.png", import.meta.url).href,
  feito: new URL("../assets/pixelyn/feito.png", import.meta.url).href,
  bloqueada: new URL("../assets/pixelyn/bloqueada.png", import.meta.url).href
};

export function PixelynAvatar(props: {
  state: PixelynState;
  /** Resolve tamanho de layout + escala visual a partir de pixelyn-sizes. */
  context?: PixelynSizeKey;
  size?: number;
  /** Amplia o vídeo dentro do slot fixo, sem alterar o espaço no layout. */
  visualScale?: number;
}): ReactElement {
  const size = props.size ?? (props.context ? PIXELYN_SIZE[props.context] : 56);
  const visualScale =
    props.visualScale ?? (props.context ? PIXELYN_VISUAL_SCALE[props.context] : 1);
  const scaled = visualScale !== 1;
  const videoRef = useRef<HTMLVideoElement>(null);

  // Autoplay confiável: garante muted (alguns engines ignoram o atributo do React)
  // e força play() após montar/trocar de estado, mesmo se o autoPlay inicial falhar.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    const tryPlay = (): void => {
      void video.play().catch(() => undefined);
    };
    tryPlay();
    video.addEventListener("canplay", tryPlay, { once: true });
    return () => video.removeEventListener("canplay", tryPlay);
  }, [props.state]);

  return (
    <span
      aria-label={STATE_LABEL[props.state]}
      className={`pixelyn-sprite-slot${scaled ? " pixelyn-sprite-slot--scaled" : ""}`}
      role="img"
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    >
      <span
        className={`pixelyn-sprite pixelyn-sprite--${props.state}`}
        style={{
          width: size,
          height: size,
          ...(scaled
            ? { transform: `scale(${visualScale})`, transformOrigin: "center center" }
            : {})
        }}
      >
        <video
          autoPlay
          className="pixelyn-sprite__media"
          height={size}
          key={props.state}
          loop
          muted
          playsInline
          poster={STATE_POSTER[props.state]}
          preload="auto"
          ref={videoRef}
          width={size}
        >
          <source src={STATE_VIDEO[props.state]} type="video/webm" />
        </video>
      </span>
    </span>
  );
}
