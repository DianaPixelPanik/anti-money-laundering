import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    globalSetup: "./tests/global-setup.ts",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    singleFork: true,
    reporters: ["verbose"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});
