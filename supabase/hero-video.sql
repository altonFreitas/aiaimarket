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
  'MP4/WebM/MOV URL. Empty means this slide is a photo. When set, image_url is the poster frame shown until the video plays.';

-- ---------------------------------------------------------------------------
-- HOW THE PICTURE SITS IN THE FRAME.
--
-- The hero is one shape on a phone (portrait) and a very different one on
-- a desktop (a wide band). Anything filmed or photographed on a phone --
-- which is everything this shop will ever put here -- is portrait, and
-- filling a wide band with it means throwing most of it away: the reported
-- symptom was a desktop hero showing a horizontal slice of sky while the
-- phone showed the whole thing.
--
-- 'contain' shows the WHOLE picture, always, whatever shape the frame is.
-- It is the default because a picture nobody cropped is the one the owner
-- actually took.
--
-- 'cover' fills the frame edge to edge and crops whatever does not fit.
-- It stays available because it is right for genuinely wide material,
-- where 'contain' would leave bars for nothing.
--
-- media_fit, NOT video_fit, WHICH IS WHAT THIS WAS CALLED FIRST. It was
-- added for videos and then asked to govern photo slides too, and a column
-- named after one of the two things it decides is a column that lies to
-- the next person reading the table. The rename below carries any value
-- the old name already held, so it does not matter whether this file has
-- been run before or not.
--
-- A CHECK rather than an enum: two values that the app reads as a string,
-- and a constraint says which two. An enum would need its own migration to
-- gain a third.
-- ---------------------------------------------------------------------------

alter table hero_slides
  add column if not exists media_fit text not null default 'contain';

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'hero_slides' and column_name = 'video_fit') then
    -- Whatever the earlier name was holding is what the slide meant.
    update hero_slides set media_fit = video_fit
      where video_fit in ('contain', 'cover');
    -- Its own CHECK goes with it.
    alter table hero_slides drop column video_fit;
  end if;
end $$;

do $$
begin
  alter table hero_slides
    add constraint hero_slides_media_fit_ck check (media_fit in ('contain', 'cover'));
exception
  when duplicate_object then null;   -- already applied; this file re-runs
end $$;

comment on column hero_slides.media_fit is
  'contain = show the whole photo or video, letterboxed. cover = fill the frame and crop.';

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
