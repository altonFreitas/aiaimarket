import { describe, it, expect } from "vitest";
import { videoExtFor } from "@/lib/videoTypes";

/* WHAT THE HERO CAROUSEL WILL TAKE.
 *
 * The shop is run from a phone. A video shot on an iPhone and sent to a
 * Mac arrives as .MOV / video/quicktime, and the upload used to refuse it
 * outright -- so the owner could not put their own footage on their own
 * homepage without finding a converter first. */

describe("the formats the hero accepts", () => {
  it("takes the two that play everywhere", () => {
    expect(videoExtFor("video/mp4", "clip.mp4")).toBe("mp4");
    expect(videoExtFor("video/webm", "clip.webm")).toBe("webm");
  });

  it("takes an iPhone video", () => {
    expect(videoExtFor("video/quicktime", "IMG_4021.MOV")).toBe("mov");
  });

  it("takes it even when the browser says nothing useful", () => {
    /* Not every browser names a .mov correctly: some send an empty type,
       some send "video/mov", which is not a registered media type at all.
       Refusing a real file over a header the browser guessed wrong is the
       bug this avoids -- the upload is scoped to one server-chosen path
       either way, so the filename is not carrying a security decision. */
    expect(videoExtFor("", "IMG_4021.MOV")).toBe("mov");
    expect(videoExtFor("video/mov", "IMG_4021.mov")).toBe("mov");
    expect(videoExtFor("application/octet-stream", "holiday.MP4")).toBe("mp4");
  });

  it("is not case-sensitive about either half", () => {
    expect(videoExtFor("VIDEO/QuickTime", "a.mov")).toBe("mov");
    expect(videoExtFor("  video/mp4  ", "a.mp4")).toBe("mp4");
  });

  it("still refuses what it cannot show", () => {
    // A hero slide that is a .zip or an .exe is not a hero slide.
    expect(videoExtFor("application/zip", "clip.zip")).toBeNull();
    expect(videoExtFor("video/x-msvideo", "clip.avi")).toBeNull();
    expect(videoExtFor("", "noextension")).toBeNull();
    expect(videoExtFor("", "")).toBeNull();
  });

  it("does not let a name smuggle in a type the shop refuses", () => {
    // The extension is a fallback for an unrecognised type, not an
    // override of a recognised one, and an unknown extension is still no.
    expect(videoExtFor("", "clip.avi")).toBeNull();
    expect(videoExtFor("", "clip.mov.exe")).toBeNull();
  });
});
