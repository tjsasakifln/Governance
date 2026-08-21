import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@confenge/control-center-contracts": path.resolve(here, "../../contracts/src/index.ts"),
      "@confenge/control-center-contracts/taxonomy": path.resolve(here, "../../contracts/src/taxonomy.ts"),
      "@confenge/control-center-contracts/types": path.resolve(here, "../../contracts/src/types.ts"),
      "@confenge/control-center-today-ui": path.resolve(here, "../today-ui/src/index.ts"),
    },
  },
  publicDir: "public",
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
