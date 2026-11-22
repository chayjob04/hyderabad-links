-- Manual smoke test for S0030: the taxonomy is three tiers deep, and the database says so.
-- The transactional part inserts, asserts, and rolls back, so it leaves no data and is safe to re-run.
--
-- What is worth checking here rather than in the .NET suite is everything the *database* enforces:
-- the shape of the tree is a CHECK constraint and a composite foreign key, not application code, so
-- these assertions are about whether a wrong tree can be written at all.
--
-- It also checks what the migration did to the rows that were already there, which no unit test
-- can see: that every category ended up under a segment, that nothing was renamed, and that every
-- listing is still filed under a subcategory.
--
-- Run:
--   npm run db:check -- segments
--
-- NOTE, honestly: this file has never been executed. There is no SQL Server available outside
-- production in this environment, so it was written alongside the migration and is the first thing
-- to run once S0030 has been applied to a database somebody can afford to break.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

DECLARE @failed int = 0;

-- ------------------------------------------------------------------ what the migration left behind
-- 1. The three-tier CHECK is in force. Everything below depends on it.
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.categories') AND name = 'categories_three_levels')
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: categories_three_levels is missing, so the table would accept any shape of tree';
END
ELSE PRINT 'ok: the three-tier CHECK is in force';

-- 2. The old two-level CHECK is gone. Leaving it would refuse every segment while the new one
--    allowed it -- a table that contradicts itself, and the kind of state a half-applied migration
--    leaves behind.
IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.categories')
      AND name <> 'categories_three_levels'
      AND definition LIKE '%level%')
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: an older level CHECK is still on dbo.categories';
END
ELSE PRINT 'ok: only the three-tier CHECK governs the level column';

-- 3. The segments exist.
DECLARE @segments int = (SELECT COUNT(*) FROM dbo.categories WHERE level = 0);
IF @segments = 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: there are no segments, so S0030 has not run';
END
ELSE PRINT 'ok: ' + CAST(@segments AS varchar(10)) + ' segments';

-- 4. Every tier is where it belongs. This is the invariant the whole feature rests on.
IF EXISTS (
    SELECT 1
    FROM dbo.categories c
    LEFT JOIN dbo.categories p ON p.id = c.parent_id
    WHERE (c.level = 0 AND c.parent_id IS NOT NULL)
       OR (c.level = 1 AND c.parent_id IS NOT NULL AND p.level <> 0)
       OR (c.level = 2 AND (p.id IS NULL OR p.level <> 1)))
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the tree is not Segment > Category > Subcategory';
END
ELSE PRINT 'ok: every row sits under the tier above it';

-- 5. Every listing is still filed under a subcategory. The migration touches no filing at all, so
--    this is the assertion that the categories it moved took their listings with them.
IF EXISTS (
    SELECT 1 FROM dbo.listing_categories lc
    JOIN dbo.categories c ON c.id = lc.category_id
    WHERE c.level <> 2)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a listing is filed under something that is not a subcategory';
END
ELSE PRINT 'ok: every listing is filed under a subcategory';

-- 6. Anything left unplaced is reported rather than failed: a category with no segment is allowed
--    (somebody has to decide where a new one goes), it just should not be a surprise.
DECLARE @unplaced nvarchar(max) = (
    SELECT STRING_AGG(slug, ', ') FROM dbo.categories WHERE level = 1 AND parent_id IS NULL);
IF @unplaced IS NOT NULL
    PRINT 'note: these categories have no segment yet: ' + @unplaced;
ELSE PRINT 'ok: every category is under a segment';

-- 7. Slugs are unique across all three tiers, which is what lets a page be one segment deep
--    (decision D4): /food is a segment and /shopping is a category, and neither can shadow the
--    other because the database would refuse the second one.
IF EXISTS (SELECT slug FROM dbo.categories GROUP BY slug HAVING COUNT(*) > 1)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a slug is used twice, so one of those two pages is unreachable';
END
ELSE PRINT 'ok: every slug in the taxonomy is unique';

-- ------------------------------------------------------------------ what the database refuses
BEGIN TRANSACTION;

DECLARE @segment int, @category int, @subcategory int;

INSERT INTO dbo.categories (level, parent_id, parent_level, slug, name, sort_order)
VALUES (0, NULL, NULL, 'smoke-seg-one', 'Smoke Segment', 900);
SET @segment = SCOPE_IDENTITY();

INSERT INTO dbo.categories (level, parent_id, parent_level, slug, name, sort_order)
VALUES (1, @segment, 0, 'smoke-seg-cat', 'Smoke Category', 900);
SET @category = SCOPE_IDENTITY();

INSERT INTO dbo.categories (level, parent_id, parent_level, slug, name, sort_order)
VALUES (2, @category, 1, 'smoke-seg-sub', 'Smoke Subcategory', 900);
SET @subcategory = SCOPE_IDENTITY();

PRINT 'ok: a segment, a category under it and a subcategory under that are all accepted';

-- 8. A segment with a parent is refused: it is the top of the tree by definition.
BEGIN TRY
    INSERT INTO dbo.categories (level, parent_id, parent_level, slug, name)
    VALUES (0, @segment, 0, 'smoke-seg-bad-top', 'Nested Segment');
    SET @failed = @failed + 1;
    PRINT 'FAIL: a segment was accepted with a parent';
END TRY
BEGIN CATCH
    PRINT 'ok: a segment cannot have a parent';
END CATCH

-- 9. A subcategory hung directly off a segment is refused. Without this the public URL for the
--    listing under it could not be built: a listing's address is /category/subcategory/listing.
BEGIN TRY
    INSERT INTO dbo.categories (level, parent_id, parent_level, slug, name)
    VALUES (2, @segment, 0, 'smoke-seg-bad-sub', 'Orphan Subcategory');
    SET @failed = @failed + 1;
    PRINT 'FAIL: a subcategory was accepted directly under a segment';
END TRY
BEGIN CATCH
    PRINT 'ok: a subcategory must sit under a category';
END CATCH

-- 10. A category claiming a subcategory as its parent is refused: that would be a fourth tier.
BEGIN TRY
    INSERT INTO dbo.categories (level, parent_id, parent_level, slug, name)
    VALUES (1, @subcategory, 2, 'smoke-seg-bad-cat', 'Fourth Tier');
    SET @failed = @failed + 1;
    PRINT 'FAIL: a fourth tier was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: the tree is three tiers and no more';
END CATCH

-- 11. The parent_level has to agree with the parent's actual level. This is the composite foreign
--     key rather than the CHECK, and it is what makes the shape enforceable without a trigger.
BEGIN TRY
    INSERT INTO dbo.categories (level, parent_id, parent_level, slug, name)
    VALUES (2, @category, 0, 'smoke-seg-bad-level', 'Lying About Its Parent');
    SET @failed = @failed + 1;
    PRINT 'FAIL: a row was accepted claiming its parent is at a level it is not';
END TRY
BEGIN CATCH
    PRINT 'ok: parent_level must match the parent''s real level';
END CATCH

-- 12. A category may be moved between segments, which is what the admin screen does. Nothing about
--     its slug changes, so no public URL moves.
DECLARE @otherSegment int;
INSERT INTO dbo.categories (level, parent_id, parent_level, slug, name, sort_order)
VALUES (0, NULL, NULL, 'smoke-seg-two', 'Smoke Segment Two', 901);
SET @otherSegment = SCOPE_IDENTITY();

UPDATE dbo.categories SET parent_id = @otherSegment, parent_level = 0 WHERE id = @category;

IF (SELECT parent_id FROM dbo.categories WHERE id = @category) <> @otherSegment
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: moving a category between segments did not take';
END
ELSE IF (SELECT slug FROM dbo.categories WHERE id = @category) <> 'smoke-seg-cat'
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: moving a category changed its slug, which would change a public URL';
END
ELSE PRINT 'ok: a category moves between segments without its address changing';

-- 13. And its subcategory came with it, because nothing about that relationship changed.
IF (SELECT parent_id FROM dbo.categories WHERE id = @subcategory) <> @category
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a subcategory lost its category when the category moved';
END
ELSE PRINT 'ok: a subcategory stays with its category';

-- 14. Unplacing a category is allowed: somebody has to be able to say "I do not know yet".
BEGIN TRY
    UPDATE dbo.categories SET parent_id = NULL, parent_level = NULL WHERE id = @category;
    PRINT 'ok: a category may have no segment';
END TRY
BEGIN CATCH
    SET @failed = @failed + 1;
    PRINT 'FAIL: a category with no segment was refused: ' + ERROR_MESSAGE();
END CATCH

ROLLBACK TRANSACTION;

IF @failed > 0
BEGIN
    DECLARE @message nvarchar(200) = CAST(@failed AS nvarchar(10)) + ' segment check(s) failed.';
    THROW 51030, @message, 1;
END
PRINT 'segments_smoke: all checks passed.';
GO
