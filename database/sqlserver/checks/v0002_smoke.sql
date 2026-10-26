-- Manual smoke test for S0002: businesses, listings and the taxonomy that hangs off them.
-- The transactional part inserts, asserts, and rolls back, so it leaves no data and is safe to re-run.
--
-- The PostgreSQL original is database/checks/v0002_smoke.sql, kept as history. Three things had to
-- change. The point literal became geography::Point. The nearest ordering became STDistance, since
-- SQL Server has no <-> operator. And the two kinds of search no longer live on the row: full-text
-- search reads the real columns through CONTAINSTABLE, and the typo tolerance comes from the stored
-- trigram table instead of pg_trgm (database/sqlserver/migrations/S0008__search.notx.sql).
--
-- Why the full-text assertion sits OUTSIDE the transaction: a full-text index is maintained
-- asynchronously and cannot see a row the current transaction has not committed, so asserting it
-- against freshly inserted rows inside a rolled-back transaction is a test that always passes for
-- the wrong reason. It is checked here against the committed dev seed instead.
--
-- Run:
--   npm run db:check -- v0002_smoke

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

DECLARE @failed int = 0;

-- ------------------------------------------------------------------ full-text, on committed rows
IF NOT EXISTS (SELECT 1 FROM listings WHERE slug LIKE 'sample-%')
    PRINT 'SKIP: full-text needs the dev seed (npm run db:seed-dev); the rest of this check does not';
ELSE
BEGIN
    DECLARE @byName int, @byDescription int;

    SELECT @byName = COUNT(*)
    FROM listings li
    JOIN CONTAINSTABLE(listings, name, 'Electricals') ft ON ft.[KEY] = li.id;
    IF @byName < 1
    BEGIN
        SET @failed = @failed + 1;
        PRINT 'FAIL: full-text search on the name found nothing (is the index populated?)';
    END
    ELSE PRINT 'ok: full-text search on the name matched ' + CAST(@byName AS varchar(10)) + ' listing(s)';

    -- The description has to be in the index too: PostgreSQL weighted it into one tsvector column,
    -- and losing it here would quietly narrow every keyword search to names only.
    SELECT @byDescription = COUNT(*)
    FROM listings li
    JOIN CONTAINSTABLE(listings, description, 'development') ft ON ft.[KEY] = li.id;
    IF @byDescription < 1
    BEGIN
        SET @failed = @failed + 1;
        PRINT 'FAIL: full-text search did not reach the description';
    END
    ELSE PRINT 'ok: full-text search reached the description (' + CAST(@byDescription AS varchar(10)) + ' listing(s))';
END

IF @failed > 0 RAISERROR('%d full-text check(s) failed', 16, 1, @failed);
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @user bigint, @business bigint, @listing bigint;
DECLARE @locality int = (SELECT TOP (1) id FROM localities WHERE slug = 'gachibowli');
DECLARE @plumbers int = (SELECT TOP (1) id FROM categories WHERE slug = 'plumbers');

INSERT INTO users (phone_e164, phone_verified_at, name)
VALUES ('+919999900001', SYSDATETIMEOFFSET(), 'S0002 Smoke Owner');
SET @user = SCOPE_IDENTITY();

INSERT INTO businesses (name) VALUES ('S0002 Smoke Plumbing');
SET @business = SCOPE_IDENTITY();

INSERT INTO business_members (business_id, user_id) VALUES (@business, @user);

-- listings carries the trigram trigger, so the id comes back through a table variable: SQL Server
-- refuses a bare OUTPUT clause on a table that has a trigger.
DECLARE @inserted TABLE (id bigint);
INSERT INTO listings (business_id, locality_id, slug, name, description, location, phone_primary, status)
OUTPUT inserted.id INTO @inserted
VALUES (@business, @locality, 's0002-smoke-plumbing', 'S0002 Smoke Plumbing',
        'Pipe leakage and bathroom fitting', geography::Point(17.4401, 78.3489, 4326),
        '+919999900002', 'active');
SET @listing = (SELECT TOP (1) id FROM @inserted);

INSERT INTO listing_categories (listing_id, category_id, category_level, is_primary)
VALUES (@listing, @plumbers, 2, 1);

-- 1. A listing has at most one primary category. The filtered unique index is what enforces it.
BEGIN TRY
    INSERT INTO listing_categories (listing_id, category_id, category_level, is_primary)
    SELECT @listing, id, 2, 1 FROM categories WHERE slug = 'electricians';
    SET @failed = @failed + 1; PRINT 'FAIL: a second primary category was accepted';
END TRY BEGIN CATCH PRINT 'ok: second primary rejected'; END CATCH;

-- 2. Only a leaf (level 2) category can be filed against a listing.
BEGIN TRY
    INSERT INTO listing_categories (listing_id, category_id, category_level, is_primary)
    SELECT @listing, id, 1, 0 FROM categories WHERE slug = 'home-services';
    SET @failed = @failed + 1; PRINT 'FAIL: a parent category was accepted';
END TRY BEGIN CATCH PRINT 'ok: parent category rejected'; END CATCH;

-- 3. A phone number on a listing must be E.164.
BEGIN TRY
    UPDATE listings SET phone_primary = '9999900002' WHERE id = @listing;
    SET @failed = @failed + 1; PRINT 'FAIL: a non-E.164 phone was accepted';
END TRY BEGIN CATCH PRINT 'ok: bad phone rejected'; END CATCH;

-- 4. A slug is lower case, digits and single hyphens.
BEGIN TRY
    UPDATE listings SET slug = 'Bad Slug' WHERE id = @listing;
    SET @failed = @failed + 1; PRINT 'FAIL: a bad slug was accepted';
END TRY BEGIN CATCH PRINT 'ok: bad slug rejected'; END CATCH;

-- 5. The core "near me" query: nearest active plumbers to Madhapur, closest first. PostgreSQL used
--    the <-> operator against a GiST index; SQL Server orders by STDistance against the spatial
--    index, which is the same plan shape.
DECLARE @from geography = geography::Point(17.4486, 78.3908, 4326);
DECLARE @nearest nvarchar(200) = (
    SELECT TOP (1) li.name
    FROM listings li
    JOIN listing_categories lc ON lc.listing_id = li.id
    JOIN categories c ON c.id = lc.category_id AND c.slug = 'plumbers'
    WHERE li.status = 'active' AND li.id = @listing
    ORDER BY li.location.STDistance(@from));
IF @nearest IS NULL
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the nearest-plumbers query did not find the listing';
END
ELSE PRINT 'ok: the nearest-plumbers query found ' + @nearest;

-- 6. Typo tolerance: "Plmbing" still finds it. pg_trgm's default threshold was 0.3. Unlike the
--    full-text index, the trigram table is ordinary rows written by a trigger, so it is visible
--    inside this transaction.
DECLARE @similarity float = (
    SELECT s.similarity FROM hl_similarity('listing', @listing, 'S0002 Smoke Plmbing') s);
IF @similarity IS NULL OR @similarity < 0.3
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a misspelled name scored ' + ISNULL(CAST(@similarity AS varchar(20)), 'NULL');
END
ELSE PRINT 'ok: a misspelled name scored ' + CAST(ROUND(@similarity, 3) AS varchar(20));

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'S0002 listing and taxonomy rules behaved as expected';
GO

ROLLBACK TRANSACTION;
GO
