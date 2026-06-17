import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// Viewer read-only de la KB Memento. Proxy /api → REST.
// Cible par défaut : Edge Function Deno (port 8001). Override possible via API_TARGET
// (ex. le Fastify legacy sur :3007, ou l'URL Supabase déployée).
const API_TARGET = process.env.API_TARGET ?? "http://localhost:8094";
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5188,
    allowedHosts: ["memento.dev"],
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
    },
  },
});
