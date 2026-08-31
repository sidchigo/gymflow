import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    globals: false,
    testTimeout: 300000,
    hookTimeout: 300000,
    fileParallelism: false,
    maxConcurrency: 1,
    // Stub Upstash env vars so Redis.fromEnv() doesn't warn during unit tests.
    // The pure functions under test never call Redis; this is only needed
    // because the module graph transitively imports redis.ts at load time.
    env: {
      UPSTASH_REDIS_REST_URL: "https://test.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "test-token",
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
});
