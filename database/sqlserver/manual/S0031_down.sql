-- Rollback for S0031 (staged edits to published listings). DbUp must never run this.
--
-- It drops the table, and with it every edit an owner has saved and not yet had approved. Nothing
-- else is lost: no listing, review decision or audit row is touched, and the published version of
-- every listing is exactly what it was -- that is what the staging table was for.
--
-- Before running it, this tells you what you would be throwing away:
--
--     SELECT l.name, p.status, p.submitted_at
--     FROM dbo.listing_pending_changes p
--     JOIN dbo.listings l ON l.id = p.listing_id
--     ORDER BY p.status, p.submitted_at;
--
-- approved-destructive: drops dbo.listing_pending_changes, which is only reachable if the staged
-- edit feature is being abandoned. Any unapproved edit is discarded; published listings are
-- untouched. This file lives in manual/ and is never applied automatically.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID('dbo.listing_pending_changes', 'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.listing_pending_changes;
END;
GO

DELETE FROM dbo.SchemaVersions WHERE ScriptName LIKE '%S0031__listing_pending_changes.sql';
GO
