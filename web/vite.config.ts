import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.RESENHA_API ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Em desenvolvimento o Vite repassa API e WebSocket para o servidor Node.
    proxy: {
      "/api": { target: API },
      "/ws": { target: API.replace(/^http/, "ws"), ws: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
