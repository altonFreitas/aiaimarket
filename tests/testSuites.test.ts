import { describe, it, expect } from "vitest";
import config from "../vitest.config";

/* TWO SUITES, AND THE CONFIGURATION THAT KEEPS THEM APART.
 *
 * Everything under tests/ except tests/rls is pure -- no I/O -- so those
 * files run in parallel workers. tests/rls is the opposite: every file in
 * it talks to the SAME Postgres, because the thing under test is the
 * schema and there is one schema. Run in parallel they walk over each
 * other, and the failures land on whichever file lost the race, which is
 * why it read for a long time as flakiness rather than as a missing
 * setting.
 *
 * SO THE SPLIT IS LOAD-BEARING, and both halves of it have already been
 * got wrong once:
 *
 *   `fileParallelism: false` on the rls project looks like it works.
 *   vitest reads that option at the ROOT only, so the files went on
 *   running in parallel and the failures went on looking like flakes.
 *
 *   a root-level `include` is not REPLACED by a project's own. It is
 *   inherited through `extends: true` and added to -- so the rls project
 *   matched every test in the repository, the whole suite ran twice, and
 *   every assertion passed twice in double the time. Nothing failed.
 *   That is the dangerous kind of broken.
 *
 * Neither mistake shows up as a failing test, which is what this file is
 * for. It reads the configuration itself rather than trusting that a
 * green run means the right files ran.
 */

type ProjectConfig = { test: Record<string, unknown> };
const test = config.test as Record<string, unknown>;
const projects = (test.projects ?? []) as ProjectConfig[];
const byName = (name: string) =>
  projects.find((p) => p.test.name === name) as ProjectConfig | undefined;

describe("the unit suite and the database suite", () => {
  it("are two projects, named", () => {
    // Named so a failure says which half it came from -- the reporter
    // prints |unit| or |rls| in front of every file.
    expect(projects.map((p) => p.test.name)).toEqual(["unit", "rls"]);
  });

  it("leaves no include at the root for them to inherit", () => {
    /* THE ONE THAT RAN EVERYTHING TWICE. `extends: true` pulls the root
       options into each project and a project's own `include` does not
       replace the root's -- both apply. With "tests/**\/*.test.ts" at the
       root, the rls project matched tests/initials.test.ts as happily as
       its own, and the suite went from 150 files to 294 without a single
       failure to say so. */
    expect(test.include, "vitest.config.ts test.include").toBeUndefined();
  });

  it("gives each project a set of files the other cannot match", () => {
    const unit = byName("unit"), rls = byName("rls");
    expect(unit, "the unit project").toBeTruthy();
    expect(rls, "the rls project").toBeTruthy();

    expect(rls!.test.include).toEqual(["tests/rls/**/*.test.ts"]);
    expect(unit!.test.include).toEqual(["tests/**/*.test.ts"]);
    // Which is why the unit half has to say so explicitly: its pattern
    // covers the other's directory.
    expect(unit!.test.exclude).toContain("tests/rls/**");
  });

  it("runs the database suite in one worker", () => {
    /* NOT `fileParallelism: false`, which vitest honours only at the
       root: setting it here changes nothing and reads as though it did.
       A single worker is the project-level way to say the same thing.
       Both pool names, because the default has changed once already and
       a setting that applies to the pool nobody is using is no setting. */
    const pools = byName("rls")!.test.poolOptions as {
      forks?: { singleFork?: boolean };
      threads?: { singleThread?: boolean };
    };
    expect(pools?.forks?.singleFork, "forks.singleFork").toBe(true);
    expect(pools?.threads?.singleThread, "threads.singleThread").toBe(true);
  });

  it("leaves the pure half parallel", () => {
    // 145 files of arithmetic have nothing to serialise for, and a suite
    // slow enough to skip is a suite that gets skipped.
    const unit = byName("unit")!.test as { poolOptions?: unknown };
    expect(unit.poolOptions).toBeUndefined();
  });
});
