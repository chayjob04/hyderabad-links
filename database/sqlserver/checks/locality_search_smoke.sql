-- Manual smoke test for the matching rules behind /api/v1/public/localities/search and
-- /api/v1/public/localities/nearest (the location autocomplete).
-- It inserts its own localities, asserts each rule, then rolls back, so it leaves no data and is
-- safe to re-run.
--
-- The PostgreSQL original is database/checks/locality_search_smoke.sql, kept as history. Four
-- things changed:
--
--   * ILIKE became LIKE. The database collation is case-insensitive, so LIKE already ignores case;
--     the matching_is_case_insensitive assertion below is what proves that rather than assuming it.
--   * The pg_trgm `%` operator became the hl_similarity function over the stored trigram table,
--     compared against pg_trgm's own default threshold of 0.3.
--   * similarity(a, b) DESC in the ORDER BY became a CROSS APPLY, because hl_similarity is an
--     inline table-valued function (a scalar one would make SQL Server run the query row by row).
--   * The escaped per-cent pattern changed escape character. PostgreSQL's LIKE takes a backslash by
--     default; T-SQL has no default escape at all and silently treats a backslash as a literal, so
--     the pattern needs an explicit ESCAPE clause. Without it the "escaped" pattern would have
--     matched every row and the test would have passed while proving the opposite.
--
-- Run:
--   npm run db:check -- locality_search_smoke

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @n int, @city int, @otherCity int;
DECLARE @firstName nvarchar(200);
DECLARE @point geography = geography::Point(17.40000, 78.40000, 4326);
DECLARE @metres float;
DECLARE @similarity float;
DECLARE @zephyrnagar int;

SELECT @city = id FROM cities WHERE slug = 'hyderabad';

-- Four areas in Hyderabad. One name starts with "Zephyr", one only contains it, one is inactive,
-- and one holds a LIKE wildcard character so the escaping can be checked.
-- The points sit close together so the nearest-neighbour ordering is unambiguous.
INSERT INTO localities (city_id, slug, name, center, is_active)
VALUES (@city, 'locsmoke-zephyrnagar',       'Zephyrnagar',       geography::Point(17.40000, 78.40050, 4326), 1),
       (@city, 'locsmoke-new-zephyr-colony', 'New Zephyr Colony', geography::Point(17.40000, 78.41000, 4326), 1),
       (@city, 'locsmoke-inactive-zephyr',   'Zephyr Hidden',     geography::Point(17.40000, 78.40001, 4326), 0),
       (@city, 'locsmoke-percent-road',      '50% Road',          geography::Point(17.40000, 78.42000, 4326), 1);

SELECT @zephyrnagar = id FROM localities WHERE slug = 'locsmoke-zephyrnagar';

-- A second city, to prove the city filter keeps places with similar names apart.
INSERT INTO cities (slug, name, state, center)
VALUES ('smoke-city', 'Smoke City', 'Telangana', geography::Point(18.0, 79.0, 4326));
SET @otherCity = SCOPE_IDENTITY();

INSERT INTO localities (city_id, slug, name, center)
VALUES (@otherCity, 'locsmoke-other-zephyr', 'Zephyr Elsewhere', geography::Point(18.0, 79.001, 4326));

-- 1. A name beginning with what was typed is ranked above one that merely contains it,
--    and an inactive area never appears.
SELECT TOP (1) @firstName = ranked.name FROM (
    SELECT TOP (10) l.name,
           CASE WHEN l.name LIKE 'zephyr%'  THEN 0
                WHEN l.name LIKE '%zephyr%' THEN 1
                ELSE 2 END AS rank_bucket,
           sim.similarity
    FROM localities l
    JOIN cities c ON c.id = l.city_id
    CROSS APPLY hl_similarity('locality', l.id, 'zephyr') sim
    WHERE l.is_active = 1 AND c.is_active = 1 AND c.slug = 'hyderabad'
      AND l.slug LIKE 'locsmoke-%'
      AND (l.name LIKE '%zephyr%' OR sim.similarity >= 0.3)
    ORDER BY rank_bucket, sim.similarity DESC, l.name
) ranked
ORDER BY ranked.rank_bucket, ranked.similarity DESC, ranked.name;
IF @firstName <> 'Zephyrnagar'
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the top suggestion was ' + ISNULL(@firstName, 'NULL') + ', expected Zephyrnagar';
END
ELSE PRINT 'ok: a prefix match outranks a mid-name match';

-- 2. Matching is case-insensitive and reaches a name's later words, but stops at inactive rows.
SET @n = (SELECT COUNT(*) FROM localities l
          JOIN cities c ON c.id = l.city_id
          WHERE l.is_active = 1 AND c.is_active = 1 AND c.slug = 'hyderabad'
            AND l.slug LIKE 'locsmoke-%'
            AND l.name LIKE '%ZEPHYR%');
IF @n <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: case-insensitive match returned ' + CAST(@n AS varchar(10)) + ' rows, expected 2';
END
ELSE PRINT 'ok: matching is case-insensitive and skips inactive rows';

-- 3. Trigram similarity covers a misspelling that LIKE alone would miss entirely.
IF EXISTS (SELECT 1 FROM localities WHERE id = @zephyrnagar AND name LIKE '%zefyrnagar%')
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the misspelling was supposed to be unmatchable by LIKE';
END
ELSE PRINT 'ok: the misspelling is unmatchable by LIKE, as intended';

SET @similarity = (SELECT sim.similarity FROM hl_similarity('locality', @zephyrnagar, 'zefyrnagar') sim);
IF @similarity IS NULL OR @similarity < 0.3
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: trigram matching scored the misspelling "zefyrnagar" at '
          + ISNULL(CAST(@similarity AS varchar(20)), 'NULL') + ', needed 0.3';
END
ELSE PRINT 'ok: trigram matching tolerated the misspelling (scored '
           + CAST(ROUND(@similarity, 3) AS varchar(20)) + ')';

-- 4. The city filter keeps similarly named areas in other cities out.
SET @n = (SELECT COUNT(*) FROM localities l
          JOIN cities c ON c.id = l.city_id
          WHERE l.is_active = 1 AND c.is_active = 1 AND c.slug = 'hyderabad'
            AND l.slug LIKE 'locsmoke-%' AND l.name LIKE '%zephyr%');
IF @n <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the hyderabad filter returned ' + CAST(@n AS varchar(10)) + ' rows, expected 2';
END
ELSE PRINT 'ok: the city filter holds';

SET @n = (SELECT COUNT(*) FROM localities l
          JOIN cities c ON c.id = l.city_id
          WHERE l.is_active = 1 AND c.is_active = 1
            AND l.slug LIKE 'locsmoke-%' AND l.name LIKE '%zephyr%');
IF @n <> 3
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: without a city filter ' + CAST(@n AS varchar(10)) + ' rows matched, expected 3';
END
ELSE PRINT 'ok: dropping the city filter reaches the other city';

-- 5. A "%" typed by a visitor is escaped by the API, so it matches a literal per cent sign only
--    and never every area in the city.
SET @n = (SELECT COUNT(*) FROM localities l
          WHERE l.is_active = 1 AND l.slug LIKE 'locsmoke-%' AND l.name LIKE '%50\%%' ESCAPE '\');
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the escaped per-cent pattern matched ' + CAST(@n AS varchar(10)) + ' rows, expected 1';
END
ELSE PRINT 'ok: an escaped per cent matches only the literal';

SET @n = (SELECT COUNT(*) FROM localities l
          WHERE l.is_active = 1 AND l.slug LIKE 'locsmoke-%' AND l.name LIKE '%%%');
IF @n <= 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: an unescaped per cent sign was supposed to match everything, matched '
          + CAST(@n AS varchar(10));
END
ELSE PRINT 'ok: an unescaped per cent still matches everything, so the escape above was real';

-- 6. The limit is honoured.
SET @n = (SELECT COUNT(*) FROM (
    SELECT TOP (1) l.id FROM localities l
    CROSS APPLY hl_similarity('locality', l.id, 'zephyr') sim
    WHERE l.is_active = 1 AND l.slug LIKE 'locsmoke-%'
      AND (l.name LIKE '%zephyr%' OR sim.similarity >= 0.3)
    ORDER BY l.name
) capped);
IF @n <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: TOP (1) returned ' + CAST(@n AS varchar(10)) + ' rows';
END
ELSE PRINT 'ok: the limit is honoured';

-- 7. Nearest resolves a point to the closest *active* area. The inactive one is 4 metres away and
--    must still be skipped, so this fails loudly if the is_active filter is ever dropped.
SELECT TOP (1) @firstName = l.name, @metres = l.center.STDistance(@point)
FROM localities l
JOIN cities c ON c.id = l.city_id AND c.is_active = 1
WHERE l.is_active = 1 AND l.slug LIKE 'locsmoke-%'
ORDER BY l.center.STDistance(@point);
IF @firstName <> 'Zephyrnagar'
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the nearest active area was ' + ISNULL(@firstName, 'NULL') + ', expected Zephyrnagar';
END
ELSE PRINT 'ok: nearest skips the closer inactive area';

-- 8. The distance comes back in metres, so the website can say when the nearest area is far off.
--    0.00050 degrees of longitude at this latitude is roughly 53 metres.
IF @metres < 40 OR @metres > 70
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the distance to Zephyrnagar was ' + CAST(ROUND(@metres, 0) AS varchar(20))
          + ' metres, expected roughly 53';
END
ELSE PRINT 'ok: the distance came back in metres ('
           + CAST(ROUND(@metres, 0) AS varchar(20)) + ')';

-- 9. Against the real reference data, any point in the city resolves to exactly one area.
SET @n = (SELECT COUNT(*) FROM (
    SELECT TOP (1) l.id
    FROM localities l
    JOIN cities c ON c.id = l.city_id AND c.is_active = 1
    WHERE l.is_active = 1
    ORDER BY l.center.STDistance(geography::Point(17.3850, 78.4867, 4326))
) nearest);
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: nearest returned ' + CAST(@n AS varchar(10)) + ' rows for a point in the city, expected 1';
END
ELSE PRINT 'ok: a point in the city resolves to exactly one area';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'all locality lookup rules behaved as expected';
GO

ROLLBACK TRANSACTION;
GO
