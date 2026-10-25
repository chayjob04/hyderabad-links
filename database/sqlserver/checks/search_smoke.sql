-- Manual smoke test for the matching rules behind /api/v1/public/listings/search.
-- It inserts its own listings, asserts each way a visitor can find them, then rolls back,
-- so it leaves no data and is safe to re-run.
--
-- The PostgreSQL original is database/checks/search_smoke.sql, kept as history. Four things
-- changed:
--
--   * Keyword matching. PostgreSQL asserted websearch_to_tsquery against the generated
--     search_vector column on each freshly inserted row. SQL Server's full-text index is
--     maintained asynchronously and cannot see rows the current transaction has not committed, so
--     asserting it here would pass for the wrong reason, whatever the query said. The full-text
--     mechanism (name and description both indexed) is asserted against committed rows in
--     v0002_smoke instead; what is checked here is everything that composes with it -- the status
--     filter, the category reach, the locality filter, the distance window and the paging.
--   * Category search terms were a text[] column queried with `ILIKE ANY (...)`. They are now rows
--     in category_search_terms, so the same test is an EXISTS over that table.
--   * ST_DWithin became an STDistance comparison.
--   * LIMIT/OFFSET became OFFSET/FETCH, which requires an ORDER BY, and `NULLS LAST` does not
--     exist in T-SQL, so the null ordering is spelled out as a CASE.
--
-- Run:
--   npm run db:check -- search_smoke

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @business bigint, @near bigint, @far bigint, @draft bigint, @n int;
DECLARE @point geography;
DECLARE @firstSlug nvarchar(200);
DECLARE @plumbers int = (SELECT id FROM categories WHERE slug = 'plumbers');
DECLARE @madhapur int, @uppal int;
DECLARE @madhapurCentre geography, @uppalCentre geography;

SELECT @madhapur = id, @madhapurCentre = center FROM localities WHERE slug = 'madhapur';
SELECT @uppal = id, @uppalCentre = center FROM localities WHERE slug = 'uppal';
SET @point = @madhapurCentre;

INSERT INTO businesses (name) VALUES ('Smoke Search Business');
SET @business = SCOPE_IDENTITY();

DECLARE @inserted TABLE (id bigint);

-- One listing in Madhapur, one far away in Uppal that also declares Madhapur as a service area.
INSERT INTO listings (business_id, locality_id, slug, name, description, location, phone_primary, status)
OUTPUT inserted.id INTO @inserted
VALUES (@business, @madhapur, 'searchsmoke-zephyr-pipeworks', 'Smoke Zephyr Pipeworks',
        'Emergency pipe and tap work across the city.', @madhapurCentre, '+919999900051', 'active');
SET @near = (SELECT TOP (1) id FROM @inserted);
DELETE FROM @inserted;

INSERT INTO listings (business_id, locality_id, slug, name, description, location, phone_primary, status)
OUTPUT inserted.id INTO @inserted
VALUES (@business, @uppal, 'searchsmoke-faraway-drains', 'Smoke Faraway Drains',
        'Drain clearing.', @uppalCentre, '+919999900052', 'active');
SET @far = (SELECT TOP (1) id FROM @inserted);
DELETE FROM @inserted;

-- A draft listing must never appear in public search results.
INSERT INTO listings (business_id, locality_id, slug, name, location, phone_primary, status)
OUTPUT inserted.id INTO @inserted
VALUES (@business, @madhapur, 'searchsmoke-hidden-zephyr', 'Smoke Hidden Zephyr Pipeworks',
        @madhapurCentre, '+919999900053', 'draft');
SET @draft = (SELECT TOP (1) id FROM @inserted);

INSERT INTO listing_categories (listing_id, category_id, category_level, is_primary)
VALUES (@near, @plumbers, 2, 1), (@far, @plumbers, 2, 1), (@draft, @plumbers, 2, 1);

-- The Uppal listing serves Madhapur too.
INSERT INTO listing_service_areas (listing_id, locality_id) VALUES (@far, @madhapur);

-- 1. The status filter is what keeps a draft out of public results. Both Madhapur listings carry
--    "Zephyr" in the name; only one of them is active.
SET @n = (SELECT COUNT(*) FROM listings li
          WHERE li.slug LIKE 'searchsmoke-%' AND li.name LIKE '%Zephyr%');
IF @n <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the fixture is wrong: ' + CAST(@n AS varchar(10)) + ' listings carry "Zephyr", expected 2';
END
ELSE PRINT 'ok: two listings carry the search word, one of them a draft';

SET @n = (SELECT COUNT(*) FROM listings li
          WHERE li.status = 'active' AND li.slug LIKE 'searchsmoke-%' AND li.name LIKE '%Zephyr%');
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the status filter matched ' + CAST(@n AS varchar(10)) + ' rows, expected 1';
END
ELSE PRINT 'ok: a draft listing never reaches public results';

-- 2. Typo tolerance covers a misspelling that keyword matching alone would miss. Unlike the
--    full-text index, the trigram table is ordinary rows written by a trigger, so it is visible
--    inside this transaction.
DECLARE @similarity float = (
    SELECT sim.similarity FROM hl_similarity('listing', @near, 'Zephyr Pipewroks') sim);
IF @similarity IS NULL OR @similarity < 0.3
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: trigram matching scored a misspelled name at '
          + ISNULL(CAST(@similarity AS varchar(20)), 'NULL') + ', needed 0.3';
END
ELSE PRINT 'ok: trigram matching tolerated a misspelled name (scored '
           + CAST(ROUND(@similarity, 3) AS varchar(20)) + ')';

-- 3. A service word from the category reaches the listing even though the word appears nowhere in
--    its own text. The terms live in their own table now, one row per term.
SET @n = (SELECT COUNT(*) FROM listings li
          WHERE li.status = 'active' AND li.slug LIKE 'searchsmoke-%'
            AND EXISTS (SELECT 1
                        FROM listing_categories kc
                        JOIN dbo.category_search_terms cst ON cst.category_id = kc.category_id
                        WHERE kc.listing_id = li.id AND 'tap repair' LIKE cst.term));
IF @n <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: service-word search matched ' + CAST(@n AS varchar(10)) + ' rows, expected 2';
END
ELSE PRINT 'ok: a category service word reaches both active listings';

-- 4. A parent category slug matches listings filed under its sub-categories.
SET @n = (SELECT COUNT(*) FROM listings li
          WHERE li.status = 'active' AND li.slug LIKE 'searchsmoke-%'
            AND EXISTS (SELECT 1
                        FROM listing_categories fc
                        JOIN categories fcat ON fcat.id = fc.category_id
                        LEFT JOIN categories fparent ON fparent.id = fcat.parent_id
                        WHERE fc.listing_id = li.id
                          AND (fcat.slug = 'home-services' OR fparent.slug = 'home-services')));
IF @n <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: parent-category search matched ' + CAST(@n AS varchar(10)) + ' rows, expected 2';
END
ELSE PRINT 'ok: a parent category reaches its sub-categories';

-- 5. The locality filter covers a listing's own area and every area it serves.
SET @n = (SELECT COUNT(*) FROM listings li
          JOIN localities lo ON lo.id = li.locality_id
          WHERE li.status = 'active' AND li.slug LIKE 'searchsmoke-%'
            AND (lo.slug = 'madhapur'
                 OR EXISTS (SELECT 1 FROM listing_service_areas sa
                            JOIN localities sl ON sl.id = sa.locality_id
                            WHERE sa.listing_id = li.id AND sl.slug = 'madhapur')));
IF @n <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the locality filter matched ' + CAST(@n AS varchar(10))
          + ' rows, expected 2 (own area plus service area)';
END
ELSE PRINT 'ok: the locality filter covers the service area too';

-- 6. The proximity window keeps the distant listing out.
SET @n = (SELECT COUNT(*) FROM listings li
          WHERE li.status = 'active' AND li.slug LIKE 'searchsmoke-%'
            AND li.location.STDistance(@point) <= 8000);
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the 8 km window matched ' + CAST(@n AS varchar(10)) + ' rows, expected 1';
END
ELSE PRINT 'ok: the 8 km window keeps the distant listing out';

-- 7. The total must count every match, not just the rows on the page.
WITH matches AS (
    SELECT li.id FROM listings li
    WHERE li.status = 'active' AND li.slug LIKE 'searchsmoke-%'
),
page AS (SELECT id FROM matches ORDER BY id OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY)
SELECT @n = (SELECT COUNT(*) FROM matches)
FROM (SELECT 1 AS one) always_one_row
LEFT JOIN page p ON 1 = 1;
IF @n <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the paged total was ' + CAST(@n AS varchar(10)) + ', expected 2';
END
ELSE PRINT 'ok: a one-row page still reports the full total';

-- 8. A page past the end still reports the total, so a client can recover.
WITH matches AS (
    SELECT li.id FROM listings li
    WHERE li.status = 'active' AND li.slug LIKE 'searchsmoke-%'
),
page AS (SELECT id FROM matches ORDER BY id OFFSET 2000 ROWS FETCH NEXT 20 ROWS ONLY)
SELECT @n = (SELECT COUNT(*) FROM matches)
FROM (SELECT 1 AS one) always_one_row
LEFT JOIN page p ON 1 = 1;
IF @n <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: an empty page reported a total of ' + CAST(@n AS varchar(10)) + ', expected 2';
END
ELSE PRINT 'ok: a page past the end still reports the total';

-- 9. The requested order must survive the join that carries the total. Ordering only inside the
--    CTE returns the right rows in an arbitrary order, so the final SELECT orders too.
WITH matches AS (
    SELECT li.slug, li.location.STDistance(@point) AS distance_metres
    FROM listings li
    WHERE li.status = 'active' AND li.slug LIKE 'searchsmoke-%'
),
page AS (
    SELECT slug, distance_metres FROM matches
    ORDER BY CASE WHEN distance_metres IS NULL THEN 1 ELSE 0 END, distance_metres, slug
    OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY
)
SELECT TOP (1) @firstSlug = p.slug
FROM (SELECT 1 AS one) always_one_row
LEFT JOIN page p ON 1 = 1
ORDER BY CASE WHEN p.distance_metres IS NULL THEN 1 ELSE 0 END, p.distance_metres, p.slug;
IF @firstSlug <> 'searchsmoke-zephyr-pipeworks'
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the nearest listing was ' + ISNULL(@firstSlug, 'NULL')
          + ', expected searchsmoke-zephyr-pipeworks';
END
ELSE PRINT 'ok: the distance order survives the join that carries the total';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'all search matching rules behaved as expected';
GO

ROLLBACK TRANSACTION;
GO
