import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Firebase web config lives in the repo-root .env.local (public identifiers only).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: "..",
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: { port: 5173, strictPort: true }, // the extension allows exactly this dev origin
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
