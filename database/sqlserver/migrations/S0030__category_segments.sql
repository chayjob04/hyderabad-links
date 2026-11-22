-- S0030: Segments — the tier above categories, making the taxonomy Segment > Category > Subcategory.
--
-- The original application's taxonomy has three levels and ours had two. The segment list is the
-- row of groups in the original's public navigation (Food / Stays / Shopping / Services /
-- Health & Wellness / Education / Professional services), recorded as DECISION 1 in
-- docs/original-ui-parity-plan.md and approved by the owner on 2026-11-23.
--
-- ---------------------------------------------------------------------------- why level 0
-- `categories` is one tree with a `level` column: 1 was a parent, 2 a child, enforced by the
-- `categories_two_levels` CHECK. A segment is a tier **above** both, so it could be added either by
-- renumbering every row (segments 1, categories 2, subcategories 3) or by numbering the new tier 0
-- and leaving the existing rows alone. This script does the second, and the reason is not taste:
--
--   * Renumbering rewrites the `level` of every existing row, and `level` is read by about fifteen
--     queries -- what a listing may be filed under, the sitemap, the admin tree, popular
--     categories. Missing one of those silently files listings under the wrong tier or drops pages
--     out of the sitemap, and it would be missed on a database nobody can run this against first:
--     there is no SQL Server available outside production, so this script has been written and
--     checked but not executed (see the report accompanying it).
--   * It also means moving the level of a row that its children's foreign key points at
--     (`categories_parent_fk` is on `(parent_id, parent_level)` -> `(id, level)`), so the FK has to
--     be dropped and rebuilt around the renumbering. More statements that cannot be tried out.
--   * Numbering the new tier 0 is additive: existing rows keep their level and their slug, every
--     query that says `level = 1` still means "category", and `FindCategoryId` still files listings
--     under a level-2 row. The only thing that changes for an existing row is that a category now
--     has a `parent_id`, and the queries that inferred "is this a top-level category?" from
--     `parent_id IS NULL` are corrected in the same change to read `level` instead.
--
-- So: **level 0 = segment, 1 = category, 2 = subcategory.** If the owner would rather the tiers were
-- numbered 1/2/3, that is a later migration plus the fifteen query edits, and it can be done once
-- there is a database to test it on.
--
-- ---------------------------------------------------------------------------- the assignments
-- Every segment slug is new: none of the 17 existing top-level slugs and none of the 134
-- subcategory slugs collides with them (checked against R002_categories.sql). That matters because
-- `categories_slug_key` is unique across the whole tree (decision D4) so that a page can be one
-- segment deep -- `/food` for a segment, `/restaurants-and-food` for a category.
--
-- "Shopping" is the one segment whose obvious slug was taken: `shopping` is an existing top-level
-- category with eleven subcategories, and renaming it would change a public URL for no gain. The
-- segment is `retail`, named "Shopping & Retail", and the category sits under it.
--
-- Each existing category is assigned by slug. Two are genuinely ambiguous and are flagged in the
-- report rather than decided quietly:
--   * `real-estate` -- property could sit under Stays (where you live) or Services (agents and
--     brokers). Assigned to Services, because every listing under it is a business offering a
--     service rather than a place to stay.
--   * `pets` -- vets, grooming and boarding. Assigned to Services for the same reason; an argument
--     for Health & Wellness exists and it is the owner's to make.
--
-- An assignment is only written where `parent_id IS NULL`, so re-running this never overwrites a
-- decision somebody has since made in the admin panel. A category this script cannot place is left
-- without a segment -- allowed by the new CHECK, and PRINTed at the end so it is not silent.
--
-- ---------------------------------------------------------------------------- what this does not do
-- No row is deleted. No slug is changed. No listing, subscription, payment or audit row is touched.
-- The only writes are the seven INSERTs in section 2 and the parent assignment in section 3, which
-- sets `parent_id` and `parent_level` on a level-1 row and nothing else.
--
-- That is guaranteed by two things rather than asserted at the end. There is no DELETE and no
-- UPDATE of `slug` or `level` anywhere in this file -- and `scripts/check-migrations.mjs` refuses a
-- migration containing DROP TABLE, DROP COLUMN, TRUNCATE or an unqualified DELETE unless a human
-- approval line is added, so an edit that started removing categories could not pass review
-- quietly. Section 5 then checks the structure the script is supposed to have produced.
--
-- ---------------------------------------------------------------------------- going back
-- See database/sqlserver/manual/S0030_down.sql. It is fully reversible: clear the segment
-- assignments, delete the seven segment rows, restore the two-level CHECK.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ------------------------------------------------------------------ 1. room for a third tier
/* The two-level CHECK, found by what it says rather than by what it is called: production's schema
   was applied by hand and adopted with `npm run db:baseline`, so a constraint this repository
   declared may carry a server-generated name there (decision D57). Every CHECK on the table whose
   definition mentions `level` is dropped, in a loop, because dropping "the first one found" would
   leave another copy of the old rule in force -- and that rule refuses a segment outright. */
DECLARE @levelCheck sysname;

WHILE EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.categories')
      AND definition LIKE '%level%'
      AND name <> 'categories_three_levels')
BEGIN
    SET @levelCheck = (
        SELECT TOP (1) name FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID('dbo.categories')
          AND definition LIKE '%level%'
          AND name <> 'categories_three_levels');

    PRINT 'S0030: dropping CHECK ' + @levelCheck + ' on dbo.categories.';
    DECLARE @dropLevelCheck nvarchar(400) =
        N'ALTER TABLE dbo.categories DROP CONSTRAINT ' + QUOTENAME(@levelCheck) + N';';
    EXEC sp_executesql @dropLevelCheck;
END;
GO

/* The same shape of rule, one tier taller.
     level 0  a segment: the top, so no parent.
     level 1  a category: a segment's child, or unplaced while somebody decides.
     level 2  a subcategory: always under a category.
   `parent_level` is what makes this enforceable without a trigger -- the composite foreign key
   already requires the parent to exist *at that level*, so a subcategory cannot be hung off a
   segment and a category cannot be hung off a subcategory.

   WITH CHECK, not NOCHECK: if any existing row would violate this, the script must fail here
   rather than leave a constraint that is not true of the data. */
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.categories') AND name = 'categories_three_levels')
BEGIN
    ALTER TABLE dbo.categories WITH CHECK
        ADD CONSTRAINT categories_three_levels CHECK (
            (level = 0 AND parent_id IS NULL AND parent_level IS NULL)
            OR (level = 1 AND ((parent_id IS NULL AND parent_level IS NULL)
                               OR (parent_id IS NOT NULL AND parent_level = 0)))
            OR (level = 2 AND parent_id IS NOT NULL AND parent_level = 1)
        );
END;
GO

-- ------------------------------------------------------------------ 2. the segments
/* Idempotent by slug, in the style of R002_categories.sql: an existing row is never overwritten, so
   a renamed or re-sorted segment survives a re-run. Sort order leaves gaps of ten, as the seed
   does, so one can be slotted between two others without renumbering the rest. */
INSERT INTO dbo.categories (level, parent_id, parent_level, slug, name, sort_order)
SELECT 0, NULL, NULL, v.slug, v.name, v.sort_order
FROM (VALUES
    ('food',                'Food',                 10),
    ('stays',               'Stays',                20),
    ('retail',              'Shopping & Retail',    30),
    ('services',            'Services',             40),
    ('health-and-wellness', 'Health & Wellness',    50),
    ('education',           'Education',            60),
    ('professional',        'Professional Services', 70)
) AS v(slug, name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM dbo.categories c WHERE c.slug = v.slug);
GO

-- ------------------------------------------------------------------ 3. placing the categories
/* Only where no segment has been chosen yet, so this cannot undo an admin's decision. Matched by
   slug: a category that does not exist in this database is simply not in the join, which is what
   makes the script safe against a production tree that has diverged from the seed. */
UPDATE c
SET parent_id = s.id,
    parent_level = 0,
    updated_at = SYSDATETIMEOFFSET()
FROM dbo.categories c
JOIN (VALUES
    ('restaurants-and-food',       'food'),
    ('travel-and-hotels',          'stays'),
    ('shopping',                   'retail'),
    ('healthcare',                 'health-and-wellness'),
    ('beauty-and-salons',          'health-and-wellness'),
    ('fitness-and-sports',         'health-and-wellness'),
    ('education-and-training',     'education'),
    ('professional-services',      'professional'),
    ('it-and-digital',             'professional'),
    ('business-services',          'professional'),
    ('home-services',              'services'),
    ('automotive',                 'services'),
    ('construction-and-interiors', 'services'),
    ('events-and-weddings',        'services'),
    ('movers-and-transport',       'services'),
    -- Ambiguous, and flagged in the report: a service business rather than a place to stay.
    ('real-estate',                'services'),
    -- Ambiguous, and flagged: vets and grooming could be Health & Wellness.
    ('pets',                       'services')
) AS m(category_slug, segment_slug) ON m.category_slug = c.slug
JOIN dbo.categories s ON s.slug = m.segment_slug AND s.level = 0
WHERE c.level = 1 AND c.parent_id IS NULL;
GO

-- ------------------------------------------------------------------ 4. anything left unplaced
/* Not an error. A category this script has never heard of belongs to whoever added it, and the
   admin panel can place it; what matters is that nobody has to go looking to find out. */
DECLARE @unplaced nvarchar(max) = (
    SELECT STRING_AGG(slug, ', ')
    FROM dbo.categories
    WHERE level = 1 AND parent_id IS NULL);

IF @unplaced IS NOT NULL
BEGIN
    PRINT 'S0030: these categories have no segment yet and can be placed in the admin panel: ' + @unplaced;
END
ELSE
BEGIN
    PRINT 'S0030: every category is under a segment.';
END;
GO

-- ------------------------------------------------------------------ 5. and nothing was lost
IF NOT EXISTS (
    SELECT 1 FROM dbo.categories WHERE level = 0 AND slug = 'food')
BEGIN
    THROW 50301, 'S0030: the segments were not inserted. Inspect dbo.categories before retrying.', 1;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.categories') AND name = 'categories_three_levels')
BEGIN
    THROW 50302, 'S0030: the three-level CHECK is missing. The taxonomy would accept any shape.', 1;
END;
GO

/* The shape the taxonomy must now have, checked rather than assumed.

   A subcategory under something that is not a category, or a category under something that is not a
   segment, would mean the parent assignment above had gone to the wrong rows -- and both would get
   past the CHECK only if the CHECK were missing, which is tested just above. Checking them anyway
   costs one scan of a table with a few hundred rows and is the difference between finding that out
   here and finding it out from a broken menu. */
IF EXISTS (
    SELECT 1
    FROM dbo.categories c
    LEFT JOIN dbo.categories p ON p.id = c.parent_id
    WHERE (c.level = 2 AND (p.id IS NULL OR p.level <> 1))
       OR (c.level = 1 AND c.parent_id IS NOT NULL AND p.level <> 0)
       OR (c.level = 0 AND c.parent_id IS NOT NULL))
BEGIN
    THROW 50303, 'S0030: the tree is not Segment > Category > Subcategory after this script. Inspect dbo.categories.', 1;
END;
GO

/* Every listing is still filed under a subcategory. This script does not touch `listing_categories`
   at all, so a failure here would mean something else did. */
IF EXISTS (
    SELECT 1
    FROM dbo.listing_categories lc
    JOIN dbo.categories c ON c.id = lc.category_id
    WHERE c.level <> 2)
BEGIN
    THROW 50304, 'S0030: a listing is filed under something that is not a subcategory.', 1;
END;
GO
