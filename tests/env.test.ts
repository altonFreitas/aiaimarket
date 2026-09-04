import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* .env.example is the deployment checklist, and a checklist is only worth
 * having if it is complete. This fails when the code starts reading a
 * setting the file does not mention -- which is how a deploy goes wrong
 * quietly, and how this shop has already lost an afternoon more than once.
 */
const ROOT = path.join(__dirname, "..");
const EXAMPLE = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");

/** Every process.env.X the application reads.
 *
 * next.config.ts counts. PAYMENT_GATEWAY_ORIGIN is read only there -- it
 * goes into the Content-Security-Policy, which is a build concern rather
 * than a runtime one -- and an earlier version of this test scanned src/
 * alone and reported it as documentation for a setting nobody used. It was
 * the scanner that was incomplete. */
const SCAN_FILES = ["next.config.ts", "src/proxy.ts"];

function used(): string[] {
  const found = new Set<string>();
  const read = (file: string) => {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) found.add(m[1]);
  };
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name)) read(full);
    }
  };
  walk(path.join(ROOT, "src"));
  for (const f of SCAN_FILES) {
    const full = path.join(ROOT, f);
    if (fs.existsSync(full)) read(full);
  }
  return [...found].sort();
}

/** Names the example file mentions, set or commented out. Both count: a
 * commented setting is documented, it is just off by default. */
function documented(): Set<string> {
  const names = new Set<string>();
  for (const line of EXAMPLE.split("\n")) {
    const m = line.match(/^#?\s*([A-Z][A-Z0-9_]*)=/);
    if (m) names.add(m[1]);
  }
  return names;
}

describe(".env.example", () => {
  /** Supplied by the platform, not by the operator. */
  const PROVIDED = new Set(["NODE_ENV"]);

  it("names every setting the code reads", () => {
    const docs = documented();
    const missing = used().filter((k) => !PROVIDED.has(k) && !docs.has(k));
    expect(missing).toEqual([]);
  });

  it("names nothing the code has stopped reading", () => {
    // A stale setting is worse than a missing one: somebody sets it,
    // nothing happens, and they go looking for what else is wrong.
    const codeUses = new Set(used());
    const stale = [...documented()].filter((k) => !codeUses.has(k));
    expect(stale).toEqual([]);
  });

  it("keeps the four that the site cannot start without", () => {
    for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
                     "SUPABASE_SERVICE_ROLE_KEY", "SESSION_SECRET"]) {
      expect([k, documented().has(k)]).toEqual([k, true]);
    }
  });

  it("carries no real secret", () => {
    // An example file ends up in screenshots and pull requests.
    expect(EXAMPLE).not.toMatch(/\beyJ[A-Za-z0-9_-]{20,}/);   // a JWT
    expect(EXAMPLE).not.toMatch(/\bsk_live_|\bAC[0-9a-f]{32}\b/);
  });
});
