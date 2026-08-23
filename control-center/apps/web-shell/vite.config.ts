import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  resolve: {
    // Regex finds are exact. A string alias of the package root to index.ts
    // prefix-matches `/taxonomy` and `/types` into `index.ts/taxonomy`.
    alias: [
      {
        find: /^@confenge\/control-center-contracts\/ids$/,
        replacement: path.resolve(here, "../../contracts/src/ids.ts"),
      },
      {
        find: /^@confenge\/control-center-contracts\/taxonomy$/,
        replacement: path.resolve(here, "../../contracts/src/taxonomy.ts"),
      },
      {
        find: /^@confenge\/control-center-contracts\/types$/,
        replacement: path.resolve(here, "../../contracts/src/types.ts"),
      },
      {
        find: /^@confenge\/control-center-contracts$/,
        replacement: path.resolve(here, "../../contracts/src/index.ts"),
      },
      {
        find: /^@confenge\/control-center-today-ui$/,
        replacement: path.resolve(here, "../today-ui/src/index.ts"),
      },
    ],
  },
  publicDir: "public",
  build: {
    outDir: "dist",
    sourcemap: false,
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
