import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Vercel serves /api/* as serverless functions; in local dev, proxy them
  // to a local instance if you run one. For pure front-end dev, DEMO_MODE
  // in the app keeps everything working with no backend.
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
  },
});
