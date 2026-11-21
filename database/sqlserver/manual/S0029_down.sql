-- S0029_down: undo as much of S0029 as can honestly be undone.
--
-- Run by hand, never by DbUp. See the README in this folder for why anything is in here at all.
--
-- ============================================================================================
-- READ THIS FIRST: one half of S0029 is reversible and the other is not.
-- ============================================================================================
--
-- **Reversible.** The Verified allowances and the entitlements view. Media is hidden by allowance
-- at read time rather than deleted (D10), so putting `photo_limit` back to 10 and `video_limit` to
-- 2 makes any photo that was hidden by S0029 visible again, in the owner's own order. Nothing was
-- lost in between. Sections 1 and 2 below do this, and they are safe to run at any time.
--
-- **Not reversible: the five-link cap.** Section 3 restores the 0..4 CHECK and the unique slot
-- index, and it will **fail** on any listing that has since added a sixth link -- which is the
-- whole point of S0029, so expect it to fail. SQL Server refuses to create a CHECK or a unique
-- index that the existing rows violate, and that refusal is the correct behaviour: the only way to
-- satisfy it is to **delete links owners added in good faith**, and this script will not do that
-- for you. It prints what is in the way instead.
--
-- So the real rollback options, once owners have started using unlimited links, are:
--   a) run sections 1 and 2 only, and leave links unlimited -- the API tolerates both (see
--      `OwnerLinkEndpoints`: a numeric `link_limit` is enforced, a NULL one means no limit), so a
--      database with the old allowances and no link cap is a state the application works in; or
--   b) decide which links to delete, delete them yourself, then run section 3; or
--   c) restore from `npm run db:export` and lose everything written since.
--
-- There is no (d). A cap cannot be reimposed on data that already exceeds it without losing data,
-- and no script can make that decision on somebody's behalf.
--
-- ============================================================================================
-- Order of operations with the application
-- ============================================================================================
--
-- Deploy the API build that predates S0029 **after** running sections 1 and 2, not before: an older
-- build reads `link_limit` with `GetInt32`, which throws on the NULL that S0029 leaves behind. The
-- API build shipped with S0029 reads it as a nullable and so works against both schemas -- it is
-- the one to leave running while deciding what to do.
--
-- Nothing here touches `dbo.listing_links` rows, `dbo.subscriptions`, `dbo.subscription_payments`
-- or any media. No money, no listing and no link is deleted by this file.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ------------------------------------------------------------------ 1. the allowances, back to S0016
UPDATE dbo.plans
SET photo_limit = 10,
    video_limit = 2,
    updated_at = SYSDATETIMEOFFSET()
WHERE slug = 'verified' AND (photo_limit <> 10 OR video_limit <> 2);
GO

PRINT 'S0029_down 1/3: verified allowances restored to 10 photos and 2 videos.';
GO

-- ------------------------------------------------------------------ 2. the view, back to S0020
/* S0020's definition exactly, including `faq_limit` and `content_section_limit` in their original
   positions. `link_limit` becomes a number again, which is what an older API build expects. */
CREATE OR ALTER VIEW dbo.listing_entitlements
AS
SELECT
    li.id                                        AS listing_id,
    COALESCE(sub.plan_slug, 'free')              AS effective_plan_slug,
    p.name                                       AS effective_plan_name,
    p.photo_limit,
    p.video_limit,
    p.logo_limit,
    p.media_limits_confirmed,
    p.grants_verified_badge                      AS is_verified,
    CASE WHEN p.grants_verified_badge = 1 THEN 5 ELSE 0 END AS link_limit,
    sub.expires_at                               AS paid_until,
    li.plan_slug                                 AS subscribed_plan_slug,
    p.faq_limit,
    p.content_section_limit
FROM dbo.listings li
OUTER APPLY (
    SELECT TOP (1) s.plan_slug, s.expires_at
    FROM dbo.subscriptions s
    WHERE s.listing_id = li.id
      AND s.status = 'active'
      AND s.starts_at <= SYSDATETIMEOFFSET()
      AND s.expires_at > SYSDATETIMEOFFSET()
    ORDER BY s.expires_at DESC
) sub
JOIN dbo.plans p ON p.slug = COALESCE(sub.plan_slug, 'free');
GO

IF (SELECT COUNT_BIG(*) FROM dbo.listing_entitlements) <> (SELECT COUNT_BIG(*) FROM dbo.listings)
BEGIN
    THROW 50298, 'S0029_down: listing_entitlements no longer returns one row per listing.', 1;
END;
GO

PRINT 'S0029_down 2/3: listing_entitlements restored to the S0020 definition.';
GO

-- ------------------------------------------------------------------ 3. the five-link cap
/* Everything below is the part that can fail, and is expected to. It is written to report the
   problem rather than to force its way through it. */

DECLARE @over int = (
    SELECT COUNT_BIG(*) FROM (
        SELECT listing_id FROM dbo.listing_links GROUP BY listing_id HAVING COUNT_BIG(*) > 5
    ) AS crowded);

DECLARE @highSlots int = (SELECT COUNT_BIG(*) FROM dbo.listing_links WHERE sort_order > 4);

DECLARE @dupes int = (
    SELECT COUNT_BIG(*) FROM (
        SELECT listing_id, sort_order FROM dbo.listing_links
        GROUP BY listing_id, sort_order HAVING COUNT_BIG(*) > 1
    ) AS shared);

IF @over > 0 OR @highSlots > 0 OR @dupes > 0
BEGIN
    PRINT '';
    PRINT 'S0029_down 3/3: the five-link cap CANNOT be restored as things stand.';
    PRINT '  listings with more than five links : ' + CAST(@over AS varchar(20));
    PRINT '  links sitting at slot 5 or higher  : ' + CAST(@highSlots AS varchar(20));
    PRINT '  positions shared by two links      : ' + CAST(@dupes AS varchar(20));
    PRINT '';
    PRINT 'Restoring it means deleting links that owners added while they were unlimited, and this';
    PRINT 'script will not choose which. Sections 1 and 2 have already run and are enough for a';
    PRINT 'rollback of the allowances; leaving links uncapped is a state the application works in.';
    PRINT 'To see what is in the way:';
    PRINT '  SELECT listing_id, COUNT(*) FROM dbo.listing_links GROUP BY listing_id HAVING COUNT(*) > 5;';
    PRINT '  SELECT * FROM dbo.listing_links WHERE sort_order > 4 ORDER BY listing_id, sort_order;';
END
ELSE
BEGIN
    PRINT 'S0029_down 3/3: no listing exceeds five links, so the cap can be restored.';

    IF EXISTS (SELECT 1 FROM sys.check_constraints
               WHERE parent_object_id = OBJECT_ID('dbo.listing_links')
                 AND name = 'listing_links_sort_not_negative')
    BEGIN
        ALTER TABLE dbo.listing_links DROP CONSTRAINT listing_links_sort_not_negative;
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE parent_object_id = OBJECT_ID('dbo.listing_links')
                     AND name = 'listing_links_sort_check')
    BEGIN
        -- WITH CHECK, deliberately: it must refuse rather than trust the rows, and the counts above
        -- have already established that it will not have to.
        ALTER TABLE dbo.listing_links WITH CHECK
            ADD CONSTRAINT listing_links_sort_check CHECK (sort_order BETWEEN 0 AND 4);
    END;

    IF EXISTS (SELECT 1 FROM sys.indexes
               WHERE object_id = OBJECT_ID('dbo.listing_links') AND name = 'listing_links_order_idx')
    BEGIN
        DROP INDEX listing_links_order_idx ON dbo.listing_links;
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE object_id = OBJECT_ID('dbo.listing_links') AND name = 'listing_links_slot_idx')
    BEGIN
        CREATE UNIQUE INDEX listing_links_slot_idx ON dbo.listing_links (listing_id, sort_order);
    END;

    PRINT 'S0029_down 3/3: the 0..4 CHECK and the unique slot index are back.';
END;
GO

/* The journal is not touched. DbUp still records S0029 as applied, which is correct for sections 1
   and 2 being undone by hand -- exactly as `S0026_down.sql` leaves S0026's row in place. Re-running
   `npm run db:migrate` will NOT re-apply S0029; delete its row from `dbo.SchemaVersions` first if
   that is what you want, and read S0029's own header before you do. */
PRINT 'S0029_down: finished. dbo.SchemaVersions was not modified.';
GO
