import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@client": fileURLToPath(new URL("./src/client", import.meta.url)),
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    // `npm run dev` proxies API calls to `wrangler dev` so the SPA gets hot
    // reload while still talking to a real Worker + local D1.
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
