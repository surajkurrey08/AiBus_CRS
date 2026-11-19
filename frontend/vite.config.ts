import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: process.env.VITE_API_TARGET || "http://127.0.0.1:4000", changeOrigin: false },
      "/socket.io": {
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:4000",
        ws: true,
        changeOrigin: false,
      },
    },
  },
  build: {
    rollupOptions: { output: { manualChunks: { charts: ["recharts"] } } },
  },
});
