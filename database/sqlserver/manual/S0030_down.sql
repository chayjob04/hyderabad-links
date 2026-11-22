-- Rollback for S0030 (segments). DbUp must never run this: see the README beside it.
--
-- S0030 is fully reversible, which is unusual enough to say plainly: it inserted seven rows, set
-- `parent_id` on existing categories, and replaced one CHECK with a taller one. Undoing it deletes
-- only rows this script itself can identify as segments, and touches no listing.
--
-- Run it only if the segment tier is being abandoned. If a single assignment is wrong, change it in
-- the admin panel instead -- that is what the panel is for.
--
-- Order matters: the assignments have to be cleared before the segment rows can be deleted (the
-- foreign key would refuse), and the old CHECK can only be restored once no category has a
-- level-0 parent (it forbids exactly that).
--
-- approved-destructive: deletes the seven segment rows this migration created, after clearing the
-- assignments that point at them. No category, subcategory, listing or filing is deleted. This file
-- lives in manual/ and is never applied automatically.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- 1. unplace every category
UPDATE c
SET parent_id = NULL,
    parent_level = NULL,
    updated_at = SYSDATETIMEOFFSET()
FROM dbo.categories c
JOIN dbo.categories s ON s.id = c.parent_id AND s.level = 0
WHERE c.level = 1;
GO

-- 2. the segments themselves, and only rows at level 0
DELETE FROM dbo.categories WHERE level = 0;
GO

-- 3. the two-level CHECK, as S0001 declared it
DECLARE @levelCheck sysname;

WHILE EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.categories')
      AND definition LIKE '%level%'
      AND name <> 'categories_two_levels')
BEGIN
    SET @levelCheck = (
        SELECT TOP (1) name FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID('dbo.categories')
          AND definition LIKE '%level%'
          AND name <> 'categories_two_levels');

    DECLARE @drop nvarchar(400) =
        N'ALTER TABLE dbo.categories DROP CONSTRAINT ' + QUOTENAME(@levelCheck) + N';';
    EXEC sp_executesql @drop;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.categories') AND name = 'categories_two_levels')
BEGIN
    ALTER TABLE dbo.categories WITH CHECK
        ADD CONSTRAINT categories_two_levels CHECK (
            (level = 1 AND parent_id IS NULL AND parent_level IS NULL)
            OR (level = 2 AND parent_id IS NOT NULL AND parent_level = 1)
        );
END;
GO

/* The journal entry, so DbUp will apply S0030 again if it is ever wanted. Without this it would
   consider the migration already applied and skip it. */
DELETE FROM dbo.SchemaVersions WHERE ScriptName LIKE '%S0030__category_segments.sql';
GO
