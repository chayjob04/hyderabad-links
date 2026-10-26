-- S0016: the Verified plan allows two videos, not three.
--
-- The owner confirmed the plan on 2026-10-27: Verified, 399 rupees a year, verified badge, website
-- and social links, 10 photos and 2 videos. Everything but the video count already matched; this
-- corrects that one number.
--
-- A forward-only UPDATE of one reference row. No listing, subscription or payment is touched.
--
-- The media a listing already holds is not touched either, and does not need to be. The allowance
-- is applied at read time by `listing_visible_media` (S0012), which numbers a listing's videos and
-- shows only those within the current limit, so a listing that had three now shows two and keeps
-- the third. That is the same rule D10 set for a lapsed plan: media over the allowance is kept and
-- hidden, never deleted, so nothing is lost if the limit moves back or the owner removes one
-- themselves.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

UPDATE dbo.plans
SET video_limit = 2,
    updated_at = SYSDATETIMEOFFSET()
WHERE slug = 'verified' AND video_limit <> 2;
GO

-- The whole plan, asserted rather than assumed: this is the row the paid tier is defined by, and a
-- wrong number here is a promise broken on a page someone paid to be on.
IF NOT EXISTS (
    SELECT 1 FROM dbo.plans
    WHERE slug = 'verified'
      AND price_paise = 39900
      AND photo_limit = 10
      AND video_limit = 2
      AND logo_limit = 1
      AND grants_verified_badge = 1
      AND is_active = 1
)
BEGIN
    THROW 51018, 'After S0016 the verified plan is not 39900 paise / 10 photos / 2 videos / 1 logo / badge / active.', 1;
END
GO

-- And that nothing else crept back in. Two plans, exactly.
IF (SELECT COUNT_BIG(*) FROM dbo.plans) <> 2
   OR NOT EXISTS (SELECT 1 FROM dbo.plans WHERE slug = 'free')
   OR NOT EXISTS (SELECT 1 FROM dbo.plans WHERE slug = 'verified')
BEGIN
    THROW 51019, 'There must be exactly two plans: free and verified.', 1;
END
GO
