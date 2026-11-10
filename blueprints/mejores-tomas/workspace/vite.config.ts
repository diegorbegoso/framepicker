import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const ignored = ["**/src-tauri/**", "**/engine/**", "**/blueprints/**"];

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored },
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**", ...ignored],
  },
});
