import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: false,
    environment: "jsdom",
    include: ["tests/ui/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["tests/setup/no-live-network.ts"]
  }
});
