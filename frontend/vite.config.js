import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-time proxy so the frontend can call same-origin "/api/..." and Vite
// forwards it to the FastAPI backend on :8000 — avoids CORS entirely in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
