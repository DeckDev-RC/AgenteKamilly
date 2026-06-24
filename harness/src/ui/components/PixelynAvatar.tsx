import { useEffect, useRef } from "react";
import type { ReactElement } from "react";

import type { PixelynState } from "../lib/pixelyn-state.js";
import { ASSISTANT_NAME } from "../lib/assistant-brand.js";
import {
  PIXELYN_SIZE,
  PIXELYN_VISUAL_SCALE,
  type PixelynSizeKey
} from "../lib/pixelyn-sizes.js";
import { pixelynVideoUrl } from "../lib/pixelyn-video-cache.js";

const STATE_LABEL: Record<PixelynState, string> = {
  parada: `${ASSISTANT_NAME} parada, esperando`,
  pensando: `${ASSISTANT_NAME} pensando`,
  "preciso-de-dado": `${ASSISTANT_NAME} precisa de um dado`,
  trabalhando: `${ASSISTANT_NAME} trabalhando`,
  feito: `${ASSISTANT_NAME} feliz, tarefa feita`,
  bloqueada: `${ASSISTANT_NAME} em atenção, bloqueada`
};

const STATE_POSTER: Record<PixelynState, string> = {
  parada: new URL("../assets/pixelyn/parada.png", import.meta.url).href,
  pensando: new URL("../assets/pixelyn/pensando.png", import.meta.url).href,
  "preciso-de-dado": new URL("../assets/pixelyn/preciso-de-dado.png", import.meta.url).href,
  trabalhando: new URL("../assets/pixelyn/trabalhando.png", import.meta.url).href,
  feito: new URL("../assets/pixelyn/feito.png", import.meta.url).href,
  bloqueada: new URL("../assets/pixelyn/bloqueada.png", import.meta.url).href
};

async function tryPlay(video: HTMLVideoElement): Promise<void> {
  if (video.paused === false) return;
  video.muted = true;
  try {
    await video.play();
  } catch {
    // Chromium/Electron pode rejeitar play() até loadeddata; o listener retenta.
  }
}

export function PixelynAvatar(props: {
  state: PixelynState;
  /** Resolve tamanho de layout + escala visual a partir de pixelyn-sizes. */
  context?: PixelynSizeKey;
  size?: number;
  /** Amplia o vídeo dentro do slot fixo, sem alterar o espaço no layout. */
  visualScale?: number;
  /** Quando false, pausa o vídeo (economiza decoders GPU — útil em avatares fora de foco). */
  playing?: boolean;
}): ReactElement {
  const size = props.size ?? (props.context ? PIXELYN_SIZE[props.context] : 56);
  const visualScale =
    props.visualScale ?? (props.context ? PIXELYN_VISUAL_SCALE[props.context] : 1);
  const scaled = visualScale !== 1;
  const playing = props.playing !== false;
  const videoRef = useRef<HTMLVideoElement>(null);
  const slotRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let disposed = false;
    const src = pixelynVideoUrl(props.state);

    const pause = (): void => {
      video.pause();
    };

    const resume = (): void => {
      if (disposed || !playing) return;
      void tryPlay(video);
    };

    const syncSource = (): void => {
      if (video.dataset.pixelynSrc !== src) {
        video.dataset.pixelynSrc = src;
        video.src = src;
        video.load();
      }
    };

    const onReady = (): void => resume();

    syncSource();

    if (!playing) {
      pause();
    } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      void tryPlay(video);
    }

    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);

    return () => {
      disposed = true;
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      pause();
    };
  }, [props.state, playing]);

  useEffect(() => {
    const slot = slotRef.current;
    const video = videoRef.current;
    if (!slot || !video || !playing) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          video.pause();
          return;
        }
        void tryPlay(video);
      },
      { root: null, threshold: 0.12, rootMargin: "0px" }
    );

    observer.observe(slot);
    return () => observer.disconnect();
  }, [playing, props.state]);

  return (
    <span
      aria-label={STATE_LABEL[props.state]}
      className={`pixelyn-sprite-slot${scaled ? " pixelyn-sprite-slot--scaled" : ""}`}
      ref={slotRef}
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
        {playing ? (
          <video
            className="pixelyn-sprite__media"
            height={size}
            loop
            muted
            playsInline
            poster={STATE_POSTER[props.state]}
            preload="auto"
            ref={videoRef}
            width={size}
          />
        ) : (
          // Avatar inativo vira poster estático (PNG ~28 KB): nenhum decoder de
          // vídeo e nenhum buffer na memória. Só o avatar que está tocando monta
          // o <video>, então uma conversa longa não acumula N decoders.
          <img
            alt=""
            className="pixelyn-sprite__media"
            draggable={false}
            height={size}
            src={STATE_POSTER[props.state]}
            width={size}
          />
        )}
      </span>
    </span>
  );
}
