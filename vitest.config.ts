import { defineConfig } from "vitest/config";
import path from "node:path";

/** Unit tests only — pure logic, no database, no network, no DOM.
 *
 * That constraint is the point. The modules under test (pricing, the order
 * and payment state machines, the rate limiter, upload validation) were
 * deliberately written free of I/O so they could be exhaustively tested
 * cheaply. Anything needing a live Supabase belongs in a separate
 * integration suite run against a throwaway project, not here. */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` throws by design when imported outside a React Server
      // Component. These tests import the pure modules directly, so it is
      // stubbed out rather than the modules being restructured around it.
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.d.ts"],
    },
  },
});
