-- ===========================================================================
-- Loja AIAI -- a hero slide that can be a VIDEO, not only a photo
--
-- One column. A slide with a non-empty video_url plays as a muted, looping
-- background video; every other slide stays exactly what it was, a photo.
--
-- WHY NOT A media_type COLUMN. A "type" column and a URL column can
-- disagree -- type='video' with an empty video_url renders nothing, and
-- nothing on any screen says why. The URL alone cannot: it either names a
-- file or it does not, and that single fact decides how the slide renders.
--
-- image_url KEEPS ITS MEANING on a video slide: it is the POSTER, the
-- still frame shown while the video loads and on any connection that will
-- not play it. That matters here more than most places -- this shop is
-- built for mobile data in Timor-Leste, and a visitor who never downloads
-- the video must still see a hero, not a black rectangle. It is allowed to
-- be empty ('' -- the column is NOT NULL but has no content requirement),
-- in which case the player simply starts dark.
--
-- Safe to re-run.
-- ===========================================================================

alter table hero_slides
  add column if not exists video_url text not null default '';

comment on column hero_slides.video_url is
  'MP4/WebM URL. Empty means this slide is a photo. When set, image_url is the poster frame shown until the video plays.';

-- ---------------------------------------------------------------------------
-- Nothing to grant.
--
-- hero_slides is read through the hero_slides_public_read policy in
-- schema.sql, which is `using (true)` over the whole row -- unlike
-- `settings`, no column-level grant list exists on this table to add the
-- new column to. It is public catalog content by design: it is the
-- homepage.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Done.
--
-- Upload a video in /admin/hero. Videos are uploaded straight from the
-- browser to Storage with a one-time signed URL issued by the server (see
-- src/lib/actions/hero.ts) rather than through a Server Action: a Server
-- Action carries its payload in the request body, which is capped at a
-- couple of megabytes, and no useful video fits in that.
-- ---------------------------------------------------------------------------
<CircleArrowUp2 /><CircleArrowsLeft /><CircleArrowUp2 /><CircleArrowUp2 />