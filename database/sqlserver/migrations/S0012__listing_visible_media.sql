-- S0012: the one definition of "which media may this listing show right now".
--
-- The bug this fixes: every public read filtered media on `is_hidden = 0` and nothing else, with a
-- comment saying hidden media is what a downgraded plan leaves behind. Nothing ever sets
-- `is_hidden` — it was added in S0005 for a downgrade that did not exist yet — so a listing whose
-- Verified period had run out went on showing all ten photos, its logo and its videos for ever,
-- while its links correctly disappeared the moment the period lapsed. One allowance was enforced at
-- read time and the other was not enforced at all.
--
-- It is fixed the same way entitlement itself is: computed from the clock on every read, with no
-- stored flag and no job to run. A listing that lapses drops to the Free allowance (0 of each) on
-- the next request; one that renews has everything back, unchanged, because nothing was ever
-- deleted or edited — which is what "a downgrade never silently deletes media" requires.
--
-- Oldest-first within each kind, so a downgrade keeps a stable, explainable subset rather than an
-- arbitrary one: with a limit of four photos it is always the first four the owner uploaded.
--
-- Three queries used to repeat the same `listing_media ... is_hidden = 0` filter — the detail page's
-- gallery, the search cards and the homepage shelves. They now all read this view, so the rule
-- cannot be applied in two and a half places again.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* Not indexable, and it does not need to be: listing_entitlements is already non-deterministic
   (SYSDATETIMEOFFSET), and every caller either asks for one listing or asks for one row per card. */
CREATE OR ALTER VIEW dbo.listing_visible_media
AS
WITH ranked AS (
    SELECT
        m.listing_id,
        m.kind,
        m.storage_key,
        m.width,
        m.height,
        m.sort_order,
        m.id,
        ROW_NUMBER() OVER (
            PARTITION BY m.listing_id, m.kind
            ORDER BY m.sort_order, m.id) AS rank_in_kind
    FROM dbo.listing_media m
    -- is_hidden stays in force. It is a moderator's or an owner's deliberate "do not show this
    -- one", which is a different question from how many the plan allows.
    WHERE m.is_hidden = 0
)
SELECT
    r.listing_id,
    r.kind,
    r.storage_key,
    r.width,
    r.height,
    r.sort_order,
    r.id
FROM ranked r
JOIN dbo.listing_entitlements e ON e.listing_id = r.listing_id
WHERE r.rank_in_kind <= CASE r.kind
                            WHEN 'logo' THEN e.logo_limit
                            WHEN 'photo' THEN e.photo_limit
                            WHEN 'video' THEN e.video_limit
                            -- A kind the plans say nothing about shows nothing, rather than
                            -- everything, if one is ever added to listing_media_kind_check.
                            ELSE 0
                        END;
GO
