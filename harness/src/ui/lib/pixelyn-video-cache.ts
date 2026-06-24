import type { PixelynState } from "./pixelyn-state.js";

// Estados mostrados logo no início (saudação/digitação). O resto carrega sob
// demanda quando o avatar entra naquele estado — sem segurar 6 vídeos no boot.
const DEFAULT_WARMUP: PixelynState[] = ["parada", "pensando"];

const VIDEO_URL: Record<PixelynState, string> = {
  parada: new URL("../assets/pixelyn/parada.webm", import.meta.url).href,
  pensando: new URL("../assets/pixelyn/pensando.webm", import.meta.url).href,
  "preciso-de-dado": new URL("../assets/pixelyn/preciso-de-dado.webm", import.meta.url).href,
  trabalhando: new URL("../assets/pixelyn/trabalhando.webm", import.meta.url).href,
  feito: new URL("../assets/pixelyn/feito.webm", import.meta.url).href,
  bloqueada: new URL("../assets/pixelyn/bloqueada.webm", import.meta.url).href
};

const warmed = new Set<PixelynState>();

/** Pré-carrega WebMs em segundo plano para reduzir falhas de play() na 1ª
 *  exibição. Por padrão aquece só os estados comuns; passe uma lista para mais. */
export function warmupPixelynVideos(states: PixelynState[] = DEFAULT_WARMUP): void {
  if (typeof document === "undefined") return;

  for (const state of states) {
    if (warmed.has(state)) continue;
    warmed.add(state);

    const probe = document.createElement("video");
    probe.muted = true;
    probe.preload = "auto";
    probe.playsInline = true;
    probe.src = VIDEO_URL[state];
    probe.load();
  }
}

export function pixelynVideoUrl(state: PixelynState): string {
  return VIDEO_URL[state];
}
