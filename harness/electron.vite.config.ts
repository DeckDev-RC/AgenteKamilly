import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/desktop/main.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/desktop/preload.ts")
      }
    }
  },
  renderer: {
    root: ".",
    plugins: [react()],
    build: {
      // Minificação do renderer estava desligada, deixando o react-dom a 554 kB
      // (não-minificado). esbuild derruba isso para ~1/4 — crítico em PC fraco.
      minify: "esbuild",
      rollupOptions: {
        input: resolve(__dirname, "index.html"),
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/lucide-react")) return "vendor-lucide";
            if (
              id.includes("node_modules/react-dom") ||
              id.includes("node_modules/react/") ||
              id.includes("node_modules/scheduler")
            ) {
              return "vendor-react";
            }
            return undefined;
          }
        }
      }
    },
    server: {
      host: "127.0.0.1",
      port: 5173
    }
  }
});
