import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${process.env.API_PORT || 3000}`,
      // Blog e SEO são renderizados pela API (HTML no servidor).
      "/blog": `http://localhost:${process.env.API_PORT || 3000}`,
      "/sitemap.xml": `http://localhost:${process.env.API_PORT || 3000}`,
      "/interno": `http://localhost:${process.env.API_PORT || 3000}`,
      "/llms.txt": `http://localhost:${process.env.API_PORT || 3000}`,
      "/robots.txt": `http://localhost:${process.env.API_PORT || 3000}`,
    },
  },
});
