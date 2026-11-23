-- Rollback for S0033 (complimentary subscriptions). DbUp must never run this.
--
-- It drops the three columns that record how a subscription came about. Read this before running it:
--
--   * Any complimentary period already granted **stays in force**. It is a subscription row like
--     any other, and dbo.listing_entitlements grants from the period and the clock, so nothing
--     changes for those listings.
--   * What is lost is the record of which periods were granted rather than paid for, who granted
--     them and why. That cannot be reconstructed from anywhere else -- the audit log holds the
--     action, but the row itself stops saying so.
--
-- So list them first, and keep the output:
--
--     SELECT s.id, l.name, s.plan_slug, s.starts_at, s.expires_at, s.grant_reason
--     FROM dbo.subscriptions s
--     JOIN dbo.listings l ON l.id = s.listing_id
--     WHERE s.source = 'complimentary'
--     ORDER BY s.created_at;
--
-- approved-destructive: drops three columns from dbo.subscriptions, only if staff-granted
-- subscriptions are being abandoned. No subscription, payment or listing row is deleted and no
-- period changes. This file lives in manual/ and is never applied automatically.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- The CHECKs first: both mention the columns, so neither can be dropped after them.
DECLARE @constraint sysname;

WHILE EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.subscriptions')
      AND (definition LIKE '%source%' OR definition LIKE '%grant_reason%'))
BEGIN
    SET @constraint = (
        SELECT TOP (1) name FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID('dbo.subscriptions')
          AND (definition LIKE '%source%' OR definition LIKE '%grant_reason%'));

    DECLARE @dropCheck nvarchar(400) =
        N'ALTER TABLE dbo.subscriptions DROP CONSTRAINT ' + QUOTENAME(@constraint) + N';';
    EXEC sp_executesql @dropCheck;
END;
GO

-- The default and the foreign key, found by shape rather than by name.
DECLARE @default sysname = (
    SELECT TOP (1) dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.subscriptions') AND c.name = 'source');

IF @default IS NOT NULL
BEGIN
    DECLARE @dropDefault nvarchar(400) =
        N'ALTER TABLE dbo.subscriptions DROP CONSTRAINT ' + QUOTENAME(@default) + N';';
    EXEC sp_executesql @dropDefault;
END;
GO

DECLARE @fk sysname = (
    SELECT TOP (1) fk.name
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
    WHERE fk.parent_object_id = OBJECT_ID('dbo.subscriptions') AND c.name = 'granted_by_admin_id');

IF @fk IS NOT NULL
BEGIN
    DECLARE @dropFk nvarchar(400) =
        N'ALTER TABLE dbo.subscriptions DROP CONSTRAINT ' + QUOTENAME(@fk) + N';';
    EXEC sp_executesql @dropFk;
END;
GO

IF COL_LENGTH('dbo.subscriptions', 'grant_reason') IS NOT NULL
    ALTER TABLE dbo.subscriptions DROP COLUMN grant_reason;
IF COL_LENGTH('dbo.subscriptions', 'granted_by_admin_id') IS NOT NULL
    ALTER TABLE dbo.subscriptions DROP COLUMN granted_by_admin_id;
IF COL_LENGTH('dbo.subscriptions', 'source') IS NOT NULL
    ALTER TABLE dbo.subscriptions DROP COLUMN source;
GO

DELETE FROM dbo.SchemaVersions WHERE ScriptName LIKE '%S0033__complimentary_subscriptions.sql';
GO
