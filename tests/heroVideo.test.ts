import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const HERO = fs.readFileSync(path.join(root, "src/components/home/Hero.tsx"), "utf8");
const CSS = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const SQL = fs.readFileSync(path.join(root, "supabase/hero-video.sql"), "utf8");
const RUN_ALL = fs.readFileSync(path.join(root, "supabase/run-all.sql"), "utf8");
const ADMIN = fs.readFileSync(path.join(root, "src/components/admin/HeroSlidesAdmin.tsx"), "utf8");

/* A HERO VIDEO WAS BEING CUT DOWN TO A STRIP.
 *
 * The frame is a tall box on a phone and a wide band on a desktop. Every
 * video this shop will have is filmed on the phone it is run from, so it
 * is portrait -- and filling the desktop band with a portrait clip means
 * keeping a horizontal slice and discarding the rest. The reported symptom
 * was a laptop showing sky where the phone showed the whole video.
 *
 * Checked in a browser with a 9:16 frame marked at all four edges, in a
 * 1440x666 hero: with contain, the top band, the bottom band and both side
 * edges all survive; with cover, only the middle does.
 */

describe("the whole video, by default", () => {
  it("contains rather than crops unless the slide says otherwise", () => {
    /* Absent reads as contain, NOT cover: a database that has not run the
       latest hero-video.sql has no column, and showing a whole video in
       the wrong shape is cosmetic where cropping one loses the picture. */
    expect(HERO).toMatch(/video_fit === "cover" \? "" : " is-contain"/);
    const rule = /\.hero-slide-video\.is-contain\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(rule, "the contain rule").not.toBeNull();
    expect(rule![1]).toMatch(/object-fit:contain/);
  });

  it("keeps cover available for footage that is actually wide", () => {
    // Letterboxing a 16:9 clip would cost space for nothing.
    expect(SQL).toMatch(/video_fit in \('contain', 'cover'\)/);
    expect(ADMIN).toMatch(/\["contain", "cover"\]/);
  });
});

describe("what fills the space either side", () => {
  it("blurs the poster behind it instead of leaving black bars", () => {
    const fill = /\.hero-slide-fill\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(fill, "the letterbox fill").not.toBeNull();
    expect(fill![1]).toMatch(/object-fit:cover/);
    expect(fill![1]).toMatch(/filter:blur\(/);
    // Scaled up first, so the blur has pixels past the edges to work with
    // rather than fading into the frame.
    expect(fill![1]).toMatch(/transform:scale\(/);
  });

  it("is painted behind the video by being before it", () => {
    /* THE STACKING TRAP. Both are position:absolute with z-index auto, so
       tree order IS paint order -- the fill after the video covers it.
       Lifting the video with a positive z-index instead would have raised
       it over the headline overlay, which comes later still. */
    const fill = HERO.indexOf('className="hero-slide-fill"');
    // ref={videoRef}, not "<video": the file's own documentation discusses
    // what a <video> costs, and matching prose would have compared the
    // fill against a comment.
    const video = HERO.indexOf("ref={videoRef}");
    const overlay = HERO.indexOf('className="hero-slide-overlay"');
    expect(fill).toBeGreaterThan(-1);
    expect(fill).toBeLessThan(video);
    expect(video).toBeLessThan(overlay);
    expect(/\.hero-slide-fill\{([^}]*)\}/.exec(NO_COMMENTS)![1]).not.toMatch(/z-index/);
  });

  it("costs no second video download", () => {
    // The poster is already fetched and decoded; a second <video> would be
    // another decode on every device, for scenery.
    const block = HERO.slice(HERO.indexOf('className="hero-slide-fill"') - 200,
                             HERO.indexOf('className="hero-slide-fill"') + 120);
    expect(block).toMatch(/<img/);
    expect(block).toMatch(/active\.image_url/);
  });

  it("shows nothing rather than a blank slab when there is no poster", () => {
    expect(HERO).toMatch(/active\.video_fit !== "cover" && active\.image_url/);
  });
});

describe("the column behind the choice", () => {
  it("defaults to showing the whole video", () => {
    expect(SQL).toMatch(/add column if not exists video_fit text not null default 'contain'/);
  });

  it("is constrained to the two the app knows", () => {
    expect(SQL).toMatch(/hero_slides_video_fit_ck/);
    // Re-runnable: the file is applied again every time run-all.sql is.
    expect(SQL).toMatch(/when duplicate_object then null/);
  });

  it("is in the generated run-all", () => {
    // Or the owner runs the manifest and the column never appears.
    expect(RUN_ALL).toMatch(/add column if not exists video_fit/);
  });
});
