import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* RUNNING THE SHOP SOMEWHERE THAT IS NOT VERCEL.
 *
 * Vercel did four things for us that nothing else does: it built the
 * server, it ran it, it gave it a certificate, and it called four cron
 * endpoints on a clock. The first two are the Dockerfile, the third is a
 * reverse proxy (DEPLOY.md), and the fourth is a sidecar -- and the fourth
 * is the one that fails silently. A scheduler that is not running does not
 * error: stock reservations simply never expire, queued messages are never
 * sent, and the dashboard's figures quietly go stale.
 *
 * So the guards here are mostly about agreement -- between vercel.json and
 * the crontab, between the Dockerfile and what `next build` actually
 * writes, between the health check and the thing it checks -- and about
 * the two mistakes that produce a container which looks fine and is not:
 * a server bound to localhost, and a secret baked into an image layer.
 */

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const DOCKERFILE = read("Dockerfile");
const COMPOSE = read("docker-compose.yml");
const IGNORE = read(".dockerignore");
const CRONTAB = read("docker/crontab");
/* Comments stripped, same reason as the health route below: both scripts
   explain their own flags, so a guard reading the raw file matched the
   explanation rather than the command. */
const shell = (p: string) => read(p).split("\n")
  .filter((l) => !/^\s*#/.test(l)).join("\n");
const CRON_SH = shell("docker/cron.sh");
const ENTRY = shell("docker/cron-entrypoint.sh");
/* Comments stripped, for the third time in this file and for the same
   reason: the workflow explains at length why it does NOT turn host-key
   checking off, so a guard reading the raw file found the explanation and
   failed against a correct file. This takes out YAML comments and the
   shell comments inside the embedded script together -- both are prose,
   and a guard satisfied by prose is not a guard. */
const DEPLOY = read(".github/workflows/deploy.yml").split("\n")
  .filter((l) => !/^\s*#/.test(l)).join("\n");
const NEXT_CONFIG = read("next.config.ts");
const README = read("README.md");
const DEPLOY_MD = read("DEPLOY.md");
const ENV_EXAMPLE = read(".env.example");
/* COMMENTS STRIPPED, and not for tidiness. The route explains at length
   why it does NOT call Supabase, so a guard reading the raw file found the
   explanation and failed against a correct file -- a guard that reads
   comments can be satisfied by writing about the thing instead of doing
   it. */
const HEALTH = read("src/app/api/health/route.ts")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const VERCEL: { crons: { path: string; schedule: string }[] } =
  JSON.parse(read("vercel.json"));

/** Every cron endpoint that exists, from the filesystem rather than from a
 *  list somebody maintains. */
function cronRoutes(): string[] {
  const dir = path.join(ROOT, "src/app/api/cron");
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `/api/cron/${e.name}`)
    .sort();
}

/** The crontab, as [schedule, path]. */
function crontabJobs(): [string, string][] {
  return CRONTAB.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const m = /^(\S+ \S+ \S+ \S+ \S+)\s+\S*cron\.sh\s+(\S+)$/.exec(l);
      expect(m, `unparseable crontab line: ${l}`).not.toBeNull();
      return [m![1], m![2]] as [string, string];
    });
}

describe("the scheduler runs the same jobs Vercel did", () => {
  it("finds jobs at all, so this cannot pass by reading nothing", () => {
    expect(cronRoutes().length).toBeGreaterThan(3);
    expect(crontabJobs().length).toBe(cronRoutes().length);
  });

  it("calls every endpoint that exists", () => {
    /* THE FAILURE THIS IS FOR. A cron endpoint is added, wired into
       vercel.json, and the crontab is forgotten -- so it runs on Vercel
       and never once on the shop's own server, and nothing anywhere
       says so. */
    const scheduled = crontabJobs().map(([, p]) => p).sort();
    expect(scheduled).toEqual(cronRoutes());
  });

  it("and vercel.json calls every one too", () => {
    expect(VERCEL.crons.map((c) => c.path).sort()).toEqual(cronRoutes());
  });

  it("on the same clocks, to the minute", () => {
    // Different schedules in the two places is a shop that behaves
    // differently depending on where it is deployed, which is the thing
    // containers are supposed to stop.
    const fromVercel = Object.fromEntries(VERCEL.crons.map((c) => [c.path, c.schedule]));
    for (const [schedule, p] of crontabJobs()) {
      expect([p, schedule]).toEqual([p, fromVercel[p]]);
    }
  });
});

describe("the scheduler cannot fail quietly", () => {
  it("refuses to start without the secret the endpoints require", () => {
    /* The endpoints fail closed on an empty CRON_SECRET, by design. A
       scheduler started without one therefore does nothing at all, four
       times an hour, for ever -- and a container that is "up" is the
       worst possible way to say that. */
    expect(ENTRY).toMatch(/CRON_SECRET/);
    expect(ENTRY).toMatch(/exit 1/);
  });

  it("passes the environment through a file, not through crond", () => {
    // crond does not give its own environment to the commands it runs, so
    // a job reading $CRON_SECRET directly sends "Bearer " and is refused.
    expect(ENTRY).toMatch(/> \/etc\/cron\.env/);
    expect(CRON_SH).toMatch(/\. \/etc\/cron\.env/);
  });

  it("keeps the secret out of the process list", () => {
    // -K - reads the header from stdin. As an argument it would be
    // visible to anything that can run ps in that container.
    expect(CRON_SH).toMatch(/-K -/);
    expect(CRON_SH).not.toMatch(/-H ["']Authorization/);
  });

  it("treats an HTTP error as a failure rather than as output", () => {
    // Without -f, curl prints the error body and exits 0, so a job that
    // was refused all night reads as a job that ran all night.
    expect(CRON_SH).toMatch(/curl -fsS/);
    expect(CRON_SH).toMatch(/exit 1/);
  });

  it("bounds a job so it cannot still be running at the next one", () => {
    const m = /-m (\d+)/.exec(CRON_SH);
    expect(m, "a curl timeout").not.toBeNull();
    // The shortest schedule is five minutes; the longest maxDuration in
    // the routes is sixty seconds.
    expect(Number(m![1])).toBeLessThan(300);
    expect(Number(m![1])).toBeGreaterThanOrEqual(30);
  });
});

describe("the image serves what it was built to serve", () => {
  it("is built from the standalone output, which the config must ask for", () => {
    /* These two are one decision in two files. Without output:standalone
       there is no .next/standalone to copy and the build fails; with it
       and without the COPY the image is missing its server. */
    expect(NEXT_CONFIG).toMatch(/output: "standalone"/);
    expect(DOCKERFILE).toMatch(/\/app\/\.next\/standalone \.\//);
  });

  it("copies the two things standalone leaves behind", () => {
    // Neither is traced into standalone: static is served from disk, and
    // public/ is read at request time. Forget either and the site loads
    // with no styling and no images.
    expect(DOCKERFILE).toMatch(/\/app\/\.next\/static \.\/\.next\/static/);
    expect(DOCKERFILE).toMatch(/\/app\/public \.\/public/);
  });

  it("binds every interface, not localhost", () => {
    /* THE CLASSIC. Next binds localhost by default. Inside a container
       that means "reachable only from inside this container": the port
       mapping is correct, the page never loads, and nothing says why. */
    expect(DOCKERFILE).toMatch(/ENV HOSTNAME=0\.0\.0\.0/);
  });

  it("runs the standalone server, not next start", () => {
    // `next start` needs the Next CLI, which standalone does not ship.
    expect(DOCKERFILE).toMatch(/CMD \["node", "server\.js"\]/);
    expect(DOCKERFILE).not.toMatch(/CMD.*next.*start/);
  });

  it("does not run as root", () => {
    expect(DOCKERFILE).toMatch(/USER nextjs/);
    expect(DOCKERFILE.indexOf("USER nextjs")).toBeLessThan(DOCKERFILE.indexOf('CMD ["node"'));
  });

  it("keeps sharp working, which is the whole image pipeline", () => {
    // Without libc6-compat sharp cannot load on Alpine and next/image
    // silently serves the original upload instead of a resized one.
    expect(DOCKERFILE).toMatch(/libc6-compat/);
  });
});

describe("no secret is baked into a layer", () => {
  /** An ARG ends up in the image's build history, which anybody who can
   *  pull the image can read. Only the values that MUST be compiled in --
   *  NEXT_PUBLIC_*, which are in every visitor's browser anyway -- may be
   *  arguments. */
  const args = [...DOCKERFILE.matchAll(/^ARG ([A-Z_0-9]+)/gm)].map((m) => m[1]);

  it("takes arguments at all, so this cannot pass by reading nothing", () => {
    expect(args.length).toBeGreaterThan(3);
  });

  it("takes only what has to be compiled in", () => {
    for (const a of args) {
      expect(a.startsWith("NEXT_PUBLIC_") || a === "APP_REVISION", a).toBe(true);
    }
  });

  it("names the server-side ones as build-only placeholders", () => {
    // They are set so the build can finish -- src/lib/session.ts throws
    // at module load without SESSION_SECRET -- and read again from the
    // container's environment at run time.
    expect(DOCKERFILE).toMatch(/SESSION_SECRET=build-only/);
    expect(DOCKERFILE).toMatch(/SUPABASE_SERVICE_ROLE_KEY=build-only/);
  });

  it("keeps .env out of the build context entirely", () => {
    // Copied in, the service role key is in a layer for ever.
    expect(IGNORE).toMatch(/^\.env$/m);
    expect(IGNORE).toMatch(/^\.env\.\*$/m);
    expect(IGNORE).toMatch(/^node_modules$/m);
  });
});

describe("the health check answers the question it is asked", () => {
  it("needs no credential", () => {
    // A health check behind a secret cannot be used by the supervisor
    // that needs it.
    expect(HEALTH).not.toMatch(/requireSection|requireAdmin|Authorization/);
  });

  it("does not ask the database whether the process is alive", () => {
    /* A check that calls Supabase restarts the app when the DATABASE is
       unwell: it fixes nothing, drops every request in flight, and does
       it again thirty seconds later. */
    expect(HEALTH).not.toMatch(/supabase/i);
  });

  it("is never cached, by Next or by anything in front of it", () => {
    expect(HEALTH).toMatch(/dynamic = "force-dynamic"/);
    expect(HEALTH).toMatch(/"cache-control": "no-store"/);
  });

  it("says which build is answering", () => {
    // How you tell whether the deploy you just pushed is the one running.
    expect(HEALTH).toMatch(/APP_REVISION/);
  });

  it("prints no setting's value", () => {
    const envReads = [...HEALTH.matchAll(/process\.env\.([A-Z_0-9]+)/g)].map((m) => m[1]);
    expect(envReads).toEqual(["APP_REVISION"]);
  });
});

describe("compose brings both halves up and keeps them up", () => {
  it("checks health against the route that exists", () => {
    expect(COMPOSE).toContain("/api/health");
  });

  it("restarts both services by itself", () => {
    expect((COMPOSE.match(/restart: unless-stopped/g) ?? []).length).toBe(2);
  });

  it("does not start the scheduler before the shop answers", () => {
    // Jobs fired at a server still booting fail, and the first run of
    // send-queued is five minutes away.
    expect(COMPOSE).toMatch(/condition: service_healthy/);
  });

  it("keeps the scheduler off the network", () => {
    // Exactly one published port, and it is the shop's.
    expect((COMPOSE.match(/^\s+ports:/gm) ?? []).length).toBe(1);
  });

  it("calls the shop by its service name, not by its public address", () => {
    /* Out to the internet and back in makes a job depend on DNS, TLS and
       the reverse proxy all being up, to do something that never needed
       to leave the host. */
    expect(COMPOSE).toMatch(/APP_URL: http:\/\/app:3000/);
  });
});

describe("the deploy is gated on the tests passing", () => {
  it("waits for verify rather than racing it", () => {
    /* Two workflows on the same push race: the image would be built and
       published while the tests that say whether it works were still
       running. */
    expect(DEPLOY).toMatch(/workflows: \["verify"\]/);
    expect(DEPLOY).toMatch(/workflow_run\.conclusion == 'success'/);
  });

  it("builds the commit that was tested, not the branch head", () => {
    // workflow_run checks out the default branch by default, which may
    // have moved on.
    expect(DEPLOY).toMatch(/ref: \$\{\{ github\.event\.workflow_run\.head_sha/);
  });

  it("stops rather than ship an image that cannot reach Supabase", () => {
    // A missing NEXT_PUBLIC_* does not fail a build: it produces an image
    // that starts, serves pages, and reaches nothing.
    expect(DEPLOY).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(DEPLOY).toMatch(/::error::/);
    expect(DEPLOY).toMatch(/exit 1/);
  });

  it("tags with the commit as well as latest, so a rollback can be named", () => {
    expect(DEPLOY).toMatch(/:latest/);
    expect(DEPLOY).toMatch(/outputs\.sha/);
  });

  it("builds the scheduler too, not only the server", () => {
    expect(DEPLOY).toMatch(/target: cron/);
    expect(DEPLOY).toMatch(/target: runtime/);
  });
});

describe("the deploy onto the server", () => {
  /* The job is opt-in: until DEPLOY_HOST is set it does not run, because
     publishing the image is useful on its own and a repo with no server
     yet should not carry a red workflow. What it does once it is on is
     the three commands DEPLOY.md gives a person, plus the two things a
     person would do and a script usually forgets. */
  const job = DEPLOY.slice(DEPLOY.indexOf("  deploy:"));

  it("has a deploy job at all, so this cannot pass by reading nothing", () => {
    expect(job.length).toBeGreaterThan(500);
    expect(job).toMatch(/needs: image/);
  });

  it("does not run until a server is named", () => {
    expect(job).toMatch(/if: vars\.DEPLOY_HOST != ''/);
  });

  it("but is loud when a server is named and the rest is not", () => {
    // A secret cannot be read in a job-level `if`, so the pair is checked
    // in a step. Half-configured must fail, not skip.
    expect(job).toMatch(/DEPLOY_SSH_KEY/);
    expect(job).toMatch(/DEPLOY_KNOWN_HOSTS/);
    expect(job).toMatch(/::error::/);
  });

  it("verifies the host key rather than trusting whatever answers", () => {
    /* StrictHostKeyChecking=no hands the deploy key and a shell to
       whatever is on that address -- which on a hijacked DNS record is
       exactly what nobody notices. */
    expect(job).not.toMatch(/StrictHostKeyChecking/);
    // The file has to be WRITTEN. Naming it in a chmod is not the same
    // thing, and was what an earlier version of this guard accepted.
    expect(job).toMatch(/> ~\/\.ssh\/known_hosts/);
  });

  it("refuses to sit at a password prompt", () => {
    // Without BatchMode a key that is not accepted hangs the job until it
    // times out, with nothing in the log to say why.
    expect(job).toMatch(/BatchMode=yes/);
  });

  it("puts nothing secret on the remote command line", () => {
    /* Arguments to ssh become the remote shell's command line, readable
       in the server's process list for as long as the deploy runs. The
       script and its values go in on stdin instead. */
    expect(job).toMatch(/bash -s < \/tmp\/deploy\.sh/);
    expect(job).not.toMatch(/REGISTRY_TOKEN='\$REGISTRY_TOKEN'\s*\\?\s*\n?\s*bash/);
  });

  it("deploys the commit that was built, not :latest", () => {
    // :latest cannot be named, so a deploy of it cannot be rolled back to
    // or reasoned about afterwards.
    expect(job).toMatch(/APP_IMAGE="\$IMAGE:\$REVISION"/);
    expect(job).toMatch(/needs\.image\.outputs\.sha/);
  });

  it("does not compile on the server", () => {
    // A build there would need the NEXT_PUBLIC_* values again and take
    // ten minutes on a small box.
    /* EVERY `compose up`, not just the first. There are two -- the
       deploy and the rollback -- and one of them quietly building is the
       failure this counts rather than matches. */
    const ups = (job.match(/docker compose up/g) ?? []).length;
    expect(ups).toBeGreaterThan(1);
    expect((job.match(/--no-build/g) ?? []).length).toBe(ups);
  });

  it("checks the new revision is the one answering", () => {
    /* THE DIFFERENCE BETWEEN A DEPLOY AND A GREEN TICK. `docker compose
       up` succeeds when the container starts, which it does even when the
       image is broken enough to crash a second later. */
    // The LOOP, not the error message beside it: deleting the wait and
    // keeping the message is exactly what a hurried edit does.
    expect(job).toMatch(/for _ in \$\(seq 1 \d+\); do/);
    expect(job).toMatch(/if \[ "\$\(revision_now\)" = "\$REVISION" \]; then/);
    // And the check comes after the restart, or it is checking the old one.
    expect(job.indexOf("docker compose up"))
      .toBeLessThan(job.indexOf('if [ "$(revision_now)" = "$REVISION" ]'));
    expect(job).toMatch(/did not answer/);
  });

  it("reads the port from Docker rather than assuming 3000", () => {
    // APP_PORT lives in the server's .env, which this script must not
    // read -- it holds the keys.
    expect(job).toMatch(/docker compose port app 3000/);
  });

  it("puts the previous revision back when the new one does not answer", () => {
    expect(job).toMatch(/PREVIOUS=\$\(revision_now\)/);
    expect(job).toMatch(/putting \$PREVIOUS back/);
  });

  it("only rolls back to something the registry actually has", () => {
    /* A shop built by hand reports "local"; pulling ghcr.io/...:local
       fails in a way that reads like a second, unrelated problem on top
       of the first. Seven hex characters, or nothing. */
    expect(job).toMatch(/\[0-9a-f\]\[0-9a-f\]\[0-9a-f\]\[0-9a-f\]\[0-9a-f\]\[0-9a-f\]\[0-9a-f\]/);
    expect(job).toMatch(/nothing to roll back to/);
  });

  it("fails the run when the deploy failed", () => {
    // Under `set -eu`, and ending in exit 1 rather than falling off the
    // end after the rollback.
    expect(job).toMatch(/set -eu/);
    /* The LAST statement of the script, after the rollback. `exit 1`
       elsewhere in the job -- the settings check has one -- says nothing
       about what happens when a deploy does not come up. */
    const script = job.slice(job.indexOf("set -eu"), job.indexOf("OUTER\n"));
    const statements = script.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    expect(statements[statements.length - 1]).toBe("exit 1");
  });

  it("leaves no key and no token behind", () => {
    expect(job).toMatch(/docker logout ghcr\.io/);
    expect(job).toMatch(/rm -f ~\/\.ssh\/id_deploy/);
    expect(job).toMatch(/if: always\(\)/);
  });
});

describe("the documentation says the two things an operator gets wrong", () => {
  /* Both of these were asked out loud rather than guessed at, which is
     how you know the doc did not answer them. A guard because prose rots
     faster than code and nothing else would notice. */

  it("warns that NEXT_PUBLIC_* is baked into the image", () => {
    /* The failure it prevents: change NEXT_PUBLIC_SITE_URL in .env,
       restart, and nothing happens -- the old string is already in the
       JavaScript the browser downloads. Without this said out loud an
       hour goes into looking for the bug. */
    for (const [name, doc] of [["README.md", README], ["DEPLOY.md", DEPLOY_MD],
                               ["Dockerfile", DOCKERFILE]] as const) {
      expect(doc, name).toMatch(/NEXT_PUBLIC/);
      expect(doc.toLowerCase(), `${name} says it is compiled in`)
        .toMatch(/compiled into|baked/);
    }
  });

  it("says where CRON_SECRET comes from, which is nowhere", () => {
    /* Every other key in this file is issued by somebody -- Supabase,
       Twilio, the bank. This one is invented, and a reader who does not
       know that goes looking for a dashboard that has it. */
    expect(ENV_EXAMPLE).toMatch(/openssl rand/);
    const block = ENV_EXAMPLE.slice(
      ENV_EXAMPLE.indexOf("CRON_SECRET") - 1400, ENV_EXAMPLE.indexOf("CRON_SECRET="));
    expect(block, "how to make one, beside CRON_SECRET").toMatch(/openssl rand/);
    /* BESIDE CRON_SECRET, not anywhere in the file. DEPLOY.md tells you
       to generate SESSION_SECRET the same way several screens earlier, so
       a guard that only looked for "openssl rand" passed while the answer
       to this question was deleted. */
    const where = DEPLOY_MD.indexOf("`CRON_SECRET` comes from");
    expect(where, "DEPLOY.md says where CRON_SECRET comes from").toBeGreaterThan(-1);
    expect(DEPLOY_MD.slice(where, where + 700)).toMatch(/openssl rand/);
  });

  it("names the Docker files in the README's layout, so it cannot rot", () => {
    /* THE LAYOUT BLOCK, not the prose. A file named only in a sentence is
       named wherever somebody last wrote about it; the tree is the map,
       and a map missing a road is the thing worth failing on. */
    /* Found by its HEADING, not by looking for a block that mentions
       src/. The prose above it mentions src/ and supabase/ too -- and,
       since this section added a table naming every Docker file, a
       first-match search picked that prose up and passed while the tree
       itself was missing all five. */
    const after = README.slice(README.indexOf("## Project layout"));
    const layout = after.slice(after.indexOf("```") + 3, after.indexOf("```", after.indexOf("```") + 3));
    expect(layout, "the project layout block").toContain("src/");
    for (const f of ["Dockerfile", "docker-compose.yml", "docker/",
                     "verify.yml", "deploy.yml"]) {
      expect(layout, f).toContain(f);
    }
  });

  it("points at the file that holds the long version, as a link", () => {
    // A link that resolves, not the words "see DEPLOY.md".
    expect(README).toContain("[DEPLOY.md](./DEPLOY.md)");
  });
});
