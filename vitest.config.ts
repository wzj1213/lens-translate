import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // These aliases match compilerOptions.paths in tsconfig.json.
  resolve: {
    alias: {
      "@shared": r("./src/shared"),
      "@content": r("./src/content"),
      "@features": r("./src/features"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
});
