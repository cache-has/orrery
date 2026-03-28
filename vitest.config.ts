import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli/**", "src/static/**"],
      reporter: ["text", "text-summary"],
    },
  },
  resolve: {
    alias: {
      "@parser": resolve(__dirname, "src/parser"),
      "@server": resolve(__dirname, "src/server"),
      "@query": resolve(__dirname, "src/query"),
      "@renderer": resolve(__dirname, "src/renderer"),
      "@connections": resolve(__dirname, "src/connections"),
    },
  },
});
