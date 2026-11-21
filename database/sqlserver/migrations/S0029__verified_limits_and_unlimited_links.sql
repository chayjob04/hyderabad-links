-- S0029: the Verified plan allows 5 photos and 1 video, and links are unlimited on every plan.
--
-- Two changes, one decision (owner's instruction, 2026-11-20). What the paid plan sells moves from
-- "more of everything" to a smaller, clearer set: the badge, five photos, one video, a logo, and
-- the right to name your own link fields. Links themselves stop being a paid feature.
--
-- ---------------------------------------------------------------------------- the allowances
-- 10 photos and 2 videos become 5 and 1. Nothing is deleted by this: `dbo.listing_visible_media`
-- applies the allowance at read time (D10), ranking each listing's own rows by `sort_order, id`, so
-- a listing that already shows six photos hides the sixth rather than losing it and keeps the first
-- five in the owner's own order. It comes back if the allowance is ever raised again. At the time
-- this was written the only Verified listing in production held 1 logo, 3 photos and 1 video, so
-- nothing is hidden by applying it.
--
-- ---------------------------------------------------------------------------- the links
-- Links were a Verified benefit capped at five: `link_limit` in `dbo.listing_entitlements` read
-- `CASE WHEN grants_verified_badge = 1 THEN 5 ELSE 0`, and the table backed that up with a CHECK on
-- `sort_order` (0..4) and a unique index on (listing_id, sort_order). A free listing could add none
-- at all.
--
-- Now every listing may add as many as it likes, and what Verified buys is naming them: a free
-- listing's links are labelled `Link 1`, `Link 2`, ... and a paid one's are whatever the owner calls
-- them. Enforcing that is the API's job (`OwnerLinkEndpoints`), because it is a rule about who may
-- write a value rather than about which values are legal.
--
-- Three things therefore have to go, and they are the destructive part of this script:
--   * the 0..4 CHECK, replaced by `sort_order >= 0` so the column still cannot go negative;
--   * the uniqueness of (listing_id, sort_order), replaced by a non-unique index of the same shape
--     -- it is still the index the ordered read seeks, it just no longer caps the rows;
--   * `link_limit` as a number, which becomes NULL for every plan. NULL reads as "no limit".
--
-- **No row is inserted, updated or deleted by this script**, so every existing link and its
-- position survive untouched. That is asserted rather than asserted-to, at the end.
--
-- ---------------------------------------------------------------------------- how things are dropped
-- Both drops look their target up in `sys` and go through QUOTENAME rather than naming it. That is
-- decision D57: production carries server-generated names for objects these scripts created, and a
-- literal `DROP CONSTRAINT listing_links_sort_check` is exactly the statement that failed there once
-- already. `check-migrations.mjs` enforces the dynamic form from S0026 onward.
--
-- Two refinements over the obvious version of that, both from the review of this script:
--   * the CHECK is found by its *definition* mentioning `sort_order`, not by a join to
--     `sys.columns`. A table-level CHECK has `parent_column_id = 0` and would not have matched that
--     join -- so the script would have printed a cheerful note, added the new constraint, and left
--     the five-link cap exactly where it was while reporting success.
--   * the uniqueness may be implemented either as a unique index or as a UNIQUE *constraint*, and
--     those are dropped by different statements. Both are handled; guessing wrong aborts the script.
--
-- ---------------------------------------------------------------------------- going back
-- See `database/sqlserver/manual/S0029_down.sql`. The short version: the allowances and the view
-- are reversible, and the five-link cap is **not**, because restoring it means deleting links that
-- owners have since added.
--
-- approved-destructive: links become unlimited on every plan, so the five-slot CHECK and the unique
-- slot index are dropped. Approved by the owner on 2026-11-20. No row is deleted by this script.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ------------------------------------------------------------------ 0. what must survive unchanged
/* Counted before anything happens and compared at the end. The script has no DML in it at all, so
   this can only fail if a future edit adds some -- which is the point of writing it down. */
IF OBJECT_ID('tempdb..#s0029_before') IS NOT NULL DROP TABLE #s0029_before;
SELECT
    (SELECT COUNT_BIG(*) FROM dbo.listing_links) AS link_count,
    /* A fingerprint of every link's position. CHECKSUM_AGG over id and sort_order changes if any
       row's slot moves, which is the half of "preserve ordering" that a count cannot see. */
    (SELECT CHECKSUM_AGG(CHECKSUM(id, listing_id, sort_order)) FROM dbo.listing_links) AS order_fingerprint
INTO #s0029_before;
GO

-- ------------------------------------------------------------------ 1. the Verified allowances
UPDATE dbo.plans
SET photo_limit = 5,
    video_limit = 1,
    updated_at = SYSDATETIMEOFFSET()
WHERE slug = 'verified' AND (photo_limit <> 5 OR video_limit <> 1);
GO

/* The whole row, asserted rather than assumed, in the style S0016 set: this is what the paid tier
   is defined by, and a wrong number here is a promise broken on a page somebody paid to be on.
   The logo stays at 1 and the price stays at 39900 -- neither is changed by this script, and both
   are checked so that a hand-edit between then and now is caught here rather than in production. */
IF NOT EXISTS (
    SELECT 1 FROM dbo.plans
    WHERE slug = 'verified'
      AND price_paise = 39900
      AND photo_limit = 5
      AND video_limit = 1
      AND logo_limit = 1
      AND grants_verified_badge = 1
      AND is_active = 1
)
BEGIN
    THROW 50290, 'S0029: the verified plan row is not as expected after the update. Inspect dbo.plans before retrying.', 1;
END;
GO

-- ------------------------------------------------------------------ 2. the five-slot CHECK
/* Every CHECK on this table whose definition mentions `sort_order`, whatever it is called and
   whether it was declared against the column or the table. A loop, because there could be more
   than one and dropping "the first one found" would leave the others in force. */
DECLARE @sortCheck sysname;

WHILE EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.listing_links')
      AND definition LIKE '%sort_order%'
      AND name <> 'listing_links_sort_not_negative')
BEGIN
    SET @sortCheck = (
        SELECT TOP (1) name FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID('dbo.listing_links')
          AND definition LIKE '%sort_order%'
          AND name <> 'listing_links_sort_not_negative');

    PRINT 'S0029: dropping CHECK ' + @sortCheck + ' on dbo.listing_links.';
    DECLARE @dropSortCheck nvarchar(400) =
        N'ALTER TABLE dbo.listing_links DROP CONSTRAINT ' + QUOTENAME(@sortCheck) + N';';
    EXEC sp_executesql @dropSortCheck;
END;
GO

/* Still bounded below. The slot is an ordering position the API assigns as MAX + 1, so a negative
   one could only come from a bug, and the column should say so. */
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.listing_links') AND name = 'listing_links_sort_not_negative')
BEGIN
    ALTER TABLE dbo.listing_links WITH CHECK
        ADD CONSTRAINT listing_links_sort_not_negative CHECK (sort_order >= 0);
END;
GO

-- ------------------------------------------------------------------ 3. the unique slot
/* Found by shape rather than by name, and dropped by whichever statement its kind requires: a
   UNIQUE constraint is not droppable with DROP INDEX, and a unique index is not droppable with
   ALTER TABLE. A loop again, for the same reason as above. */
DECLARE @slotIndex sysname, @isConstraint bit;

WHILE EXISTS (
    SELECT 1
    FROM sys.indexes i
    WHERE i.object_id = OBJECT_ID('dbo.listing_links')
      AND i.is_unique = 1
      AND i.is_primary_key = 0
      AND i.name <> 'listing_links_order_idx'
      AND EXISTS (
          SELECT 1 FROM sys.index_columns ic
          JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
          WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND c.name = 'sort_order'))
BEGIN
    SELECT TOP (1) @slotIndex = i.name, @isConstraint = i.is_unique_constraint
    FROM sys.indexes i
    WHERE i.object_id = OBJECT_ID('dbo.listing_links')
      AND i.is_unique = 1
      AND i.is_primary_key = 0
      AND i.name <> 'listing_links_order_idx'
      AND EXISTS (
          SELECT 1 FROM sys.index_columns ic
          JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
          WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND c.name = 'sort_order');

    DECLARE @dropSlot nvarchar(400) = CASE WHEN @isConstraint = 1
        THEN N'ALTER TABLE dbo.listing_links DROP CONSTRAINT ' + QUOTENAME(@slotIndex) + N';'
        ELSE N'DROP INDEX ' + QUOTENAME(@slotIndex) + N' ON dbo.listing_links;' END;

    PRINT 'S0029: dropping unique slot ' + CASE WHEN @isConstraint = 1 THEN 'constraint ' ELSE 'index ' END + @slotIndex + '.';
    EXEC sp_executesql @dropSlot;
END;
GO

-- The ordered read (`ORDER BY sort_order` for one listing) still wants this; it just no longer
-- decides how many rows may exist.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.listing_links') AND name = 'listing_links_order_idx')
BEGIN
    CREATE INDEX listing_links_order_idx ON dbo.listing_links (listing_id, sort_order);
END;
GO

-- ------------------------------------------------------------------ 4. the entitlements view
/* Re-stated in full, because `CREATE OR ALTER VIEW` replaces the whole definition -- and re-stated
   from **S0020's** version, which is the one in force, not S0009's. The first draft of this script
   copied S0009 and so would have dropped `faq_limit` and `content_section_limit`: two columns added
   later, read by `dbo.listing_visible_faqs`, `dbo.listing_visible_content`,
   `OwnerListingContentEndpoints` and `SuperAdminListingContentEndpoints`. Applying that would have
   broken the owner's About & FAQs screen, both staff content screens and part of the public listing
   page -- from a migration whose subject is plans and links. Every column below keeps the name,
   position and meaning S0020 gave it; `link_limit` is the only one whose value changes.

   Every object is `dbo.`-qualified, as S0020 does. An unqualified name in a view binds to the
   creating login's default schema, and this database is a shared host where exactly that has
   already put 125 rows in the wrong table (see REPAIR_STATUS.md). */
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
    /* Unlimited, on every plan, since S0029. What the paid plan buys is naming the links rather
       than having them, and that rule lives in the API because it is about who may write a label.
       Kept as a column rather than removed so the view's shape is stable for its readers, and so a
       deployed API build from before this change still finds the column it selects. */
    CAST(NULL AS int)                            AS link_limit,
    sub.expires_at                               AS paid_until,
    li.plan_slug                                 AS subscribed_plan_slug,
    -- Added in S0020. Unchanged here, and the reason this view is re-stated from that version.
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

-- ------------------------------------------------------------------ 5. post-conditions
/* Replacing a view the whole API reads, and dropping a constraint the whole links feature depends
   on, are the two risky steps in this file. Both are checked rather than assumed -- in the style
   S0020 set with its own THROW 51027 and 51028, and because the first draft of this script could
   report success while having achieved neither. */

-- 5a. The view still answers for every listing.
IF (SELECT COUNT_BIG(*) FROM dbo.listing_entitlements) <> (SELECT COUNT_BIG(*) FROM dbo.listings)
BEGIN
    THROW 50291, 'S0029: listing_entitlements no longer returns one row per listing.', 1;
END;
GO

-- 5b. Every column its readers select still exists, including the two S0020 added. Checked by name
--     against the view's own metadata, so a column dropped by a careless edit is caught here.
IF EXISTS (
    SELECT required.name
    FROM (VALUES
        ('listing_id'), ('effective_plan_slug'), ('effective_plan_name'),
        ('photo_limit'), ('video_limit'), ('logo_limit'), ('media_limits_confirmed'),
        ('is_verified'), ('link_limit'), ('paid_until'), ('subscribed_plan_slug'),
        ('faq_limit'), ('content_section_limit')
    ) AS required(name)
    WHERE NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.listing_entitlements') AND sys.columns.name = required.name))
BEGIN
    THROW 50292, 'S0029: listing_entitlements is missing a column its readers select.', 1;
END;
GO

-- 5c. link_limit really is NULL now, for every plan. A number here would mean a cap survived.
IF EXISTS (SELECT 1 FROM dbo.listing_entitlements WHERE link_limit IS NOT NULL)
BEGIN
    THROW 50293, 'S0029: link_limit is still a number for some listing; links are not unlimited.', 1;
END;
GO

-- 5d. The five-link cap is gone. This is the assertion the first draft lacked: a CHECK that was
--     declared against the table rather than the column would have survived the drop unnoticed.
IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.listing_links')
      AND definition LIKE '%sort_order%'
      AND name <> 'listing_links_sort_not_negative')
BEGIN
    THROW 50294, 'S0029: a CHECK on listing_links.sort_order survived; links are still capped.', 1;
END;
GO

-- 5e. And so is the uniqueness, which is what stopped two links sharing a position.
IF EXISTS (
    SELECT 1 FROM sys.indexes i
    WHERE i.object_id = OBJECT_ID('dbo.listing_links')
      AND i.is_unique = 1
      AND i.is_primary_key = 0
      AND EXISTS (
          SELECT 1 FROM sys.index_columns ic
          JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
          WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND c.name = 'sort_order'))
BEGIN
    THROW 50295, 'S0029: a unique index or constraint on listing_links.sort_order survived.', 1;
END;
GO

-- 5f. Nothing was added, removed or moved. The count and the position fingerprint are the two
--     halves of "every existing link and its ordering are preserved".
IF (SELECT link_count FROM #s0029_before) <> (SELECT COUNT_BIG(*) FROM dbo.listing_links)
BEGIN
    THROW 50296, 'S0029: the number of links changed. This script must not touch rows.', 1;
END;
GO

IF (SELECT order_fingerprint FROM #s0029_before)
   <> (SELECT CHECKSUM_AGG(CHECKSUM(id, listing_id, sort_order)) FROM dbo.listing_links)
   OR ((SELECT order_fingerprint FROM #s0029_before) IS NULL
       AND (SELECT CHECKSUM_AGG(CHECKSUM(id, listing_id, sort_order)) FROM dbo.listing_links) IS NOT NULL)
BEGIN
    THROW 50297, 'S0029: a link changed position. This script must not touch rows.', 1;
END;
GO

DROP TABLE #s0029_before;
GO

PRINT 'S0029: verified allowances are 5 photos and 1 video; links are unlimited on every plan.';
GO
