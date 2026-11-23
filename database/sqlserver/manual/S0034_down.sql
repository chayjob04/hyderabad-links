-- Rollback for S0034 (whole-listing staging). DbUp must never run this.
--
-- Read this first. S0034 is the one migration in this set whose rollback has to think about data,
-- because by the time you run it there may be staged listings in flight.
--
--   1. **Staged edits are deleted.** A staged listing is a draft row with staged_for_listing_id set,
--      holding its own copy of the media, hours, questions, content, amenities and links. Deleting
--      it loses an owner's unapproved edit; it does not touch the published listing, which is the
--      whole point of the mechanism. List them before you decide:
--
--          SELECT s.id, s.name, s.status, p.name AS published_listing, s.updated_at
--          FROM dbo.listings s
--          JOIN dbo.listings p ON p.id = s.staged_for_listing_id
--          ORDER BY s.updated_at;
--
--   2. **Placeholders are deleted.** An owner who clicked "Add a business" and has not saved yet
--      loses that empty draft. Anything they had typed into it is in it, so check:
--
--          SELECT id, name, created_at FROM dbo.listings WHERE is_placeholder = 1;
--
--   3. **Blobs are not deleted by this script.** A staged listing's photos live in object storage
--      under their own keys. Deleting the rows here leaves those files; they cost a few pence and
--      they are unreachable. Delete them with the keys you collect first if that matters:
--
--          SELECT m.storage_key FROM dbo.listing_media m
--          JOIN dbo.listings s ON s.id = m.listing_id
--          WHERE s.staged_for_listing_id IS NOT NULL OR s.is_placeholder = 1;
--
--   4. S0031's table is **not** recreated. If you need it back, re-run S0031 after removing its
--      journal row -- but note that nothing reads it any more, so you almost certainly do not.
--
-- The published side of every listing is untouched by all of this.
--
-- approved-destructive: deletes staged and placeholder listing rows (and their children, by the
-- existing cascades) and drops two columns, two indexes and two CHECKs from dbo.listings. No
-- published listing, subscription, payment or audit row is deleted. This file lives in manual/ and
-- is never applied automatically.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- 1. the staged and placeholder rows. Children go with them through the existing cascades.
DELETE FROM dbo.listings WHERE staged_for_listing_id IS NOT NULL OR is_placeholder = 1;
GO

-- 2. the entitlements view, back to S0009's definition without the staging lookup.
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
    li.plan_slug                                 AS subscribed_plan_slug
FROM listings li
OUTER APPLY (
    SELECT TOP (1) s.plan_slug, s.expires_at
    FROM subscriptions s
    WHERE s.listing_id = li.id
      AND s.status = 'active'
      AND s.starts_at <= SYSDATETIMEOFFSET()
      AND s.expires_at > SYSDATETIMEOFFSET()
    ORDER BY s.expires_at DESC
) sub
JOIN plans p ON p.slug = COALESCE(sub.plan_slug, 'free');
GO

-- 3. the CHECKs and indexes, found by name because this script created them.
DECLARE @constraint sysname;

WHILE EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.listings')
      AND name IN ('listings_staged_not_active', 'listings_placeholder_is_a_draft'))
BEGIN
    SET @constraint = (
        SELECT TOP (1) name FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID('dbo.listings')
          AND name IN ('listings_staged_not_active', 'listings_placeholder_is_a_draft'));

    DECLARE @dropCheck nvarchar(400) =
        N'ALTER TABLE dbo.listings DROP CONSTRAINT ' + QUOTENAME(@constraint) + N';';
    EXEC sp_executesql @dropCheck;
END;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'listings_staged_for_key' AND object_id = OBJECT_ID('dbo.listings'))
    DROP INDEX listings_staged_for_key ON dbo.listings;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'listings_placeholder_per_owner_key' AND object_id = OBJECT_ID('dbo.listings'))
    DROP INDEX listings_placeholder_per_owner_key ON dbo.listings;
GO

-- 4. the default on is_placeholder, then the columns.
DECLARE @default sysname = (
    SELECT TOP (1) dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.listings') AND c.name = 'is_placeholder');

IF @default IS NOT NULL
BEGIN
    DECLARE @dropDefault nvarchar(400) =
        N'ALTER TABLE dbo.listings DROP CONSTRAINT ' + QUOTENAME(@default) + N';';
    EXEC sp_executesql @dropDefault;
END;
GO

IF COL_LENGTH('dbo.listings', 'is_placeholder') IS NOT NULL
    ALTER TABLE dbo.listings DROP COLUMN is_placeholder;
IF COL_LENGTH('dbo.listings', 'staged_for_listing_id') IS NOT NULL
    ALTER TABLE dbo.listings DROP COLUMN staged_for_listing_id;
GO

DELETE FROM dbo.SchemaVersions WHERE ScriptName LIKE '%S0034__listing_staging.sql';
GO
