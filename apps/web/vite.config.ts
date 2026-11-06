import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev proxy to the Spring Boot API so the browser stays same-origin.
    proxy: { "/v1": "http://localhost:8080" },
  },
});
