import { defineConfig } from "tsup";

export default defineConfig({
  entry: { server: "src/server.ts", migrate: "scripts/migrate.ts", search: "scripts/search.ts", federation: "scripts/federation.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  // O pacote compartilhado é TS puro; embutimos no bundle.
  noExternal: ["@agentikal/shared"],
});
