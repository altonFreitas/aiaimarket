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
    /* NO `include` HERE. Each project below declares its own, and a root
       include is not replaced by them -- it is inherited THROUGH
       `extends: true` and added to, so leaving it made the rls project
       match every test in the repo and the whole suite ran twice: 294
       files where there are 147, every assertion counted and passed
       twice, in double the time. It looked like a slow machine. */
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.d.ts"],
    },
    /* TWO SUITES, BECAUSE ONE OF THEM SHARES A DATABASE.
     *
     * Everything under tests/ except tests/rls is pure: no I/O, so vitest
     * runs the files in parallel workers and the whole suite is twenty-odd
     * seconds. tests/rls is the opposite -- every file in it talks to the
     * SAME Postgres, because the thing being tested is the schema, and
     * there is one schema.
     *
     * Run in parallel, those files walk over each other. One seeds orders
     * and asserts on a rollup of every order there is; another inserts its
     * own orders halfway through; a third deletes the lot between the two.
     * The failures land on whichever file lost the race, which is why this
     * looked for a long time like a flaky test rather than a missing
     * setting -- eight failures, a different eight each run, never the
     * file that caused them.
     *
     * The honest fix is not to make every assertion prefix-scoped: some of
     * them are ABOUT the whole table (a rollup that must agree with the
     * order book cannot ask "of the rows I made"). It is to say that this
     * suite is serial, here, so it is serial however it is invoked --
     * `npx vitest run tests/rls/`, a single file, or an IDE's play button.
     * A flag in the CI workflow would only be right in CI. */
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/rls/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "rls",
          include: ["tests/rls/**/*.test.ts"],
          /* ONE DATABASE, ONE FILE AT A TIME. Expressed as a single
             worker rather than as `fileParallelism: false`, which vitest
             reads only at the root and would silently slow the unit
             project down with it -- setting it here looks like it works,
             runs the files in parallel anyway, and leaves the failures
             looking like flakes. Both pools are named because the default
             has changed once already. */
          poolOptions: {
            forks: { singleFork: true },
            threads: { singleThread: true },
          },
        },
      },
    ],
  },
});
