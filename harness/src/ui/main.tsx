import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Subconjunto latin cobre o português (acentos em Latin-1). Sem os pesos/subsets
// não usados (600 não aparece no CSS; cyrillic/greek/vietnamese eram peso morto).
import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-500.css";
import "@fontsource/poppins/latin-700.css";
import "@fontsource/poppins/latin-800.css";

import { App } from "./App.js";
import appLogoUrl from "./assets/logo/logo.png";
import "./omie-tokens.css";
import "./styles.css";
import { warmupPixelynVideos } from "./lib/pixelyn-video-cache.js";

function ensureFavicon(href: string): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/png";
  link.href = href;
}

ensureFavicon(appLogoUrl);

// Aquece os vídeos fora do caminho crítico do boot: espera a janela ficar ociosa
// (com fallback) em vez de segurar megabytes de vídeo durante o primeiro paint.
function whenIdle(callback: () => void): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: 4000 });
  } else {
    window.setTimeout(callback, 1500);
  }
}

whenIdle(() => warmupPixelynVideos());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
