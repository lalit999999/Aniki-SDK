import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        statements: 97,
        lines: 97,
        functions: 97,
        branches: 93,
      },
    },
  },
});
