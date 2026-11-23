-- Rollback for S0032 (area and category suggestions). DbUp must never run this.
--
-- It drops the queue of requests. Nothing an approved suggestion produced is affected: an approved
-- one created a row in dbo.localities or dbo.categories, and that row stands on its own -- the
-- suggestion only recorded who asked for it.
--
-- What you would be throwing away, before you do:
--
--     SELECT kind, status, suggested_name, created_at
--     FROM dbo.taxonomy_suggestions
--     ORDER BY status, created_at;
--
-- approved-destructive: drops dbo.taxonomy_suggestions, which is only reachable if the suggestion
-- queue is being abandoned. No area, category or listing is deleted. This file lives in manual/ and
-- is never applied automatically.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID('dbo.taxonomy_suggestions', 'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.taxonomy_suggestions;
END;
GO

DELETE FROM dbo.SchemaVersions WHERE ScriptName LIKE '%S0032__taxonomy_suggestions.sql';
GO
