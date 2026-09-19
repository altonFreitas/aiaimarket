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
const ACTION = fs.readFileSync(path.join(root, "src/lib/actions/hero.ts"), "utf8");

/* A HERO PICTURE WAS BEING CUT DOWN TO A STRIP.
 *
 * The frame is a tall box on a phone and a wide band on a desktop.
 * Everything this shop puts there is shot on the phone it is run from, so
 * it is portrait -- and filling the desktop band with a portrait picture
 * means keeping a horizontal slice and discarding the rest. The reported
 * symptom was a laptop showing sky where the phone showed the whole clip.
 *
 * The setting began as video_fit and governs PHOTO slides too now, which
 * is why it is media_fit: a column named after one of the two things it
 * decides lies to the next person reading the table.
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
    // One reading of the setting, used by both kinds of slide.
    expect(HERO).toMatch(/function fitOf\(s: HeroSlide\)/);
    expect(HERO).toMatch(/s\.media_fit === "cover" \? "cover" : "contain"/);
    const rule = /\.hero-slide-img\.is-contain\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(rule, "the contain rule").not.toBeNull();
    expect(rule![1]).toMatch(/object-fit:contain/);
  });

  it("keeps cover available for footage that is actually wide", () => {
    // Letterboxing a 16:9 clip would cost space for nothing.
    expect(SQL).toMatch(/media_fit in \('contain', 'cover'\)/);
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
    const fill = HERO.indexOf('"hero-slide-fill"');
    const photo = HERO.indexOf('"hero-slide-img"');
    // ref={videoRef}, not "<video": the file's own documentation discusses
    // what a <video> costs, and matching prose would have compared the
    // fill against a comment.
    const video = HERO.indexOf("ref={videoRef}");
    const overlay = HERO.indexOf('className="hero-slide-overlay"');
    expect(fill).toBeGreaterThan(-1);
    // ALL the fills, then ALL the pictures: interleaved, the next slide's
    // fill paints over the last slide's picture and both are half-visible
    // through a crossfade.
    expect(fill).toBeLessThan(photo);
    expect(fill).toBeLessThan(video);
    expect(video).toBeLessThan(overlay);
    expect(/\.hero-slide-fill\{([^}]*)\}/.exec(NO_COMMENTS)![1]).not.toMatch(/z-index/);
  });

  it("costs no second video download", () => {
    // The poster is already fetched and decoded; a second <video> would be
    // another decode on every device, for scenery.
    const at = HERO.indexOf('"hero-slide-fill"');
    const block = HERO.slice(at - 260, at + 120);
    expect(block).toMatch(/<img/);
    expect(block).not.toMatch(/<video/);
  });

  it("shows nothing rather than a blank slab when there is nothing to blur", () => {
    expect(HERO).toMatch(/fitOf\(s\) === "cover" \|\| !s\.image_url \? null/);
  });

  it("crossfades the fill with the picture it belongs to", () => {
    // A fill that switched instantly would flash the next slide's colours
    // behind the one still fading out.
    const fill = /\.hero-slide-fill\{([^}]*)\}/.exec(NO_COMMENTS)![1];
    expect(fill).toMatch(/opacity:0/);
    expect(fill).toMatch(/transition:opacity/);
    expect(NO_COMMENTS).toMatch(/\.hero-slide-fill\.active\{opacity:1\}/);
  });
});

describe("the column behind the choice", () => {
  it("defaults to showing the whole video", () => {
    expect(SQL).toMatch(/add column if not exists media_fit text not null default 'contain'/);
  });

  it("is constrained to the two the app knows", () => {
    expect(SQL).toMatch(/hero_slides_media_fit_ck/);
    // Re-runnable: the file is applied again every time run-all.sql is.
    expect(SQL).toMatch(/when duplicate_object then null/);
  });

  it("is in the generated run-all", () => {
    // Or the owner runs the manifest and the column never appears.
    expect(RUN_ALL).toMatch(/add column if not exists media_fit/);
  });
});

describe("a shop that has not run the migration yet", () => {
  /* THE BUG THIS CAUGHT, and it was in the change that added the column.
     The admin's draft always carries a video_fit, because the radios need
     one to show -- so Save began naming that column in every UPDATE.
     Postgres fails the WHOLE statement when one column is unknown:

       ERROR: column "media_fit" of relation "hero_slides" does not exist

     which broke Save for EVERY slide, photo slides included, on every
     shop that had this code and had not run supabase/run-all.sql yet.
     Reproduced against a real database at both states: `UPDATE 1` with
     the column, that error without it. */

  it("saves everything else rather than failing the whole update", () => {
    // Same treatment products.ts gives `audience`.
    expect(ACTION).toMatch(/writeTolerating\(/);
    expect(ACTION).toMatch(/import \{ writeTolerating \}/);
    // The optional field is separated from the ones that always exist.
    expect(ACTION).toMatch(/const \{ media_fit, \.\.\.always \} = fields/);
    expect(ACTION).toMatch(/media_fit === undefined \? \{\} : \{ media_fit \}/);
  });

  it("does not name the column among the ones it always writes", () => {
    /* The point of splitting it out. If video_fit stayed in the object
       passed straight to .update(), the retry would name it too and the
       tolerance would be decorative. */
    const call = /writeTolerating\(([\s\S]*?)\n  \);/.exec(ACTION);
    expect(call, "the tolerant write").not.toBeNull();
    expect(call![1]).toMatch(/\{ \.\.\.always, \.\.\.extra \}/);
  });

  it("does not offer a choice it cannot keep", () => {
    /* A control that takes a choice, says "saved" and changes nothing is
       worse than one that is not there. s.video_fit is undefined exactly
       when the row came back without the column. */
    expect(ADMIN).toMatch(/\{s\.media_fit !== undefined && \(/);
  });
});

describe("a photo gets the same choice as a video", () => {
  /* A photo taken on the same phone has the same problem as a video taken
     on it: portrait, in a frame that is a wide band on a desktop. Measured
     in a browser with a 9:16 frame marked at all four edges, in a 1440x666
     hero: contain keeps the top band, the bottom band and both side edges;
     cover keeps only the middle. */

  it("applies the fit to a photo slide, not only a video one", () => {
    expect(HERO).toMatch(/fitOf\(s\) === "cover" \? "" : " is-contain"/);
    // The rule is on .hero-slide-img, which both kinds of slide carry.
    expect(NO_COMMENTS).toMatch(/\.hero-slide-img\.is-contain\{/);
  });

  it("offers the control on every slide, not only a video one", () => {
    /* It used to sit inside `{video && (...)}` with the poster button, so
       a photo slide could not be told how to sit in the frame at all. */
    const fit = ADMIN.indexOf('className="hero-fit"');
    const videoOnly = ADMIN.indexOf("{video && (");
    const videoBlockEnd = ADMIN.indexOf("</WriteOnly>\n                )}", videoOnly);
    expect(fit).toBeGreaterThan(-1);
    expect(videoBlockEnd).toBeGreaterThan(-1);
    expect(fit).toBeGreaterThan(videoBlockEnd);
  });

  it("names the setting after what it decides", () => {
    /* video_fit governing a photo slide is a column that lies to whoever
       reads the table next. The old name is gone everywhere. */
    for (const [name, src] of [["hero", HERO], ["admin", ADMIN], ["action", ACTION]] as const) {
      expect(src, name).not.toMatch(/video_fit/);
    }
    expect(SQL).toMatch(/media_fit/);
  });

  it("carries the old column's value across rather than resetting it", () => {
    /* A shop that already ran the video_fit version has slides set the way
       it wanted them. Verified against a real database: a slide on 'cover'
       is still on 'cover' afterwards, and video_fit is gone. */
    expect(SQL).toMatch(/update hero_slides set media_fit = video_fit/);
    expect(SQL).toMatch(/alter table hero_slides drop column video_fit/);
    // Guarded, so the file still runs on a database that never had it.
    expect(SQL).toMatch(/if exists \(select 1 from information_schema\.columns/);
  });
});
