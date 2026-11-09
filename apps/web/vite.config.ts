import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // LABSCAPE_WEB_PORT / LABSCAPE_API_URL (shell or apps/web/.env.<mode>) let a second web + API pair
  // run beside the default one, e.g. to try an API build without stopping the one on :8080.
  const env = loadEnv(mode, process.cwd(), "LABSCAPE_");
  return {
    plugins: [react()],
    // Workspace packages declare react as a dev dependency; force one copy app-wide.
    resolve: { dedupe: ["react", "react-dom", "framer-motion", "@tanstack/react-query"] },
    server: {
      port: Number(env.LABSCAPE_WEB_PORT) || 5173,
      // Dev proxy to the Spring Boot API so the browser stays same-origin.
      proxy: { "/v1": env.LABSCAPE_API_URL || "http://localhost:8080" },
    },
  };
});
