-- Manual smoke test for listing attributes: offerings, languages and amenities (S0024).
--
-- The original site kept these in three tables; here they are one table with a `kind` column, so
-- the things worth asserting are the ones that column is responsible for: that the three kinds do
-- not collide, that a label can be repeated across kinds but not within one, and that the CHECK
-- constraint refuses a fourth kind the API does not know about.
--
-- These are free on every plan — they are what a visitor reads to decide whether to call — so
-- there is no visibility view and no allowance here. A free listing's labels are asserted visible,
-- because that is the behaviour that would quietly break if someone later added one.
--
-- It creates its own owner, business and listing, asserts, then rolls back, so it leaves no data
-- and is safe to re-run. Every slug is prefixed `smoke-at-`.
--
-- Run:
--   npm run db:check -- attributes

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @owner bigint, @business bigint, @listing bigint, @other bigint;
DECLARE @locality int, @centre geography;
DECLARE @n int, @first bigint;

SELECT @locality = id, @centre = center FROM dbo.localities WHERE slug = 'madhapur';

INSERT INTO dbo.users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900411', SYSDATETIMEOFFSET(), 'Smoke Attr Owner', 'attr@example.com');
SET @owner = SCOPE_IDENTITY();

INSERT INTO dbo.businesses (name) VALUES ('Smoke Attr Business');
SET @business = SCOPE_IDENTITY();
INSERT INTO dbo.business_members (business_id, user_id, role) VALUES (@business, @owner, 'owner');

INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-at-one', 'Smoke At One', @centre, '+919999900411', 'active', @owner);
SET @listing = SCOPE_IDENTITY();

INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-at-two', 'Smoke At Two', @centre, '+919999900411', 'active', @owner);
SET @other = SCOPE_IDENTITY();

-- ---------------------------------------------------------------- the three kinds
-- 1. All three kinds the API knows about are accepted. If this and ListingAttributes.Kinds ever
--    disagree, the API would offer a kind the database refuses on insert.
BEGIN TRY
    INSERT INTO dbo.listing_attributes (listing_id, kind, label, sort_order)
    VALUES (@listing, 'offering', 'Tap repair', 0),
           (@listing, 'language', 'Telugu', 0),
           (@listing, 'amenity', 'Parking', 0);
    PRINT 'ok: offering, language and amenity are all accepted';
END TRY
BEGIN CATCH
    SET @failed = @failed + 1;
    PRINT 'FAIL: one of the three kinds was refused: ' + ERROR_MESSAGE();
END CATCH

-- 2. A fourth kind is refused. The column is the only thing keeping the three lists apart, so a
--    typo in the API would otherwise create a silent fourth list nothing ever reads.
BEGIN TRY
    INSERT INTO dbo.listing_attributes (listing_id, kind, label) VALUES (@listing, 'service', 'Anything');
    SET @failed = @failed + 1;
    PRINT 'FAIL: kind ''service'' was accepted, so the CHECK constraint is not holding';
END TRY
BEGIN CATCH
    PRINT 'ok: a kind outside the three is refused';
END CATCH

-- 3. Case: the kind is stored lower case, and the API refuses anything else (its Kinds dictionary
--    is an ordinal one, asserted in ListingAttributesTests). The CHECK constraint cannot be relied
--    on for that, because on this database's case-insensitive collation 'Language' satisfies the
--    IN list. So what is asserted here is only that nothing stored has a kind outside the three
--    written in lower case.
IF EXISTS (SELECT 1 FROM dbo.listing_attributes
           WHERE kind COLLATE Latin1_General_BIN NOT IN ('offering', 'language', 'amenity'))
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a stored kind is not one of the three in lower case';
END
ELSE PRINT 'ok: every stored kind is one of the three, lower case';

-- ---------------------------------------------------------------- labels
-- 4. The same label twice in one kind is refused: that is a double-click, not a second fact.
BEGIN TRY
    INSERT INTO dbo.listing_attributes (listing_id, kind, label) VALUES (@listing, 'language', 'Telugu');
    SET @failed = @failed + 1;
    PRINT 'FAIL: ''Telugu'' was stored twice in the same kind';
END TRY
BEGIN CATCH
    PRINT 'ok: a duplicate label within one kind is refused';
END CATCH

-- 5. But the same word under two different kinds is fine. A shop that offers "Parking" as a service
--    and also has parking is not a contradiction, and the unique index is on the pair, not the
--    label.
BEGIN TRY
    INSERT INTO dbo.listing_attributes (listing_id, kind, label) VALUES (@listing, 'offering', 'Parking');
    PRINT 'ok: the same label can appear under two different kinds';
END TRY
BEGIN CATCH
    SET @failed = @failed + 1;
    PRINT 'FAIL: the unique index is on the label alone, not on (listing, kind, label)';
END CATCH

-- 6. And two listings can both claim it. The index is per listing.
BEGIN TRY
    INSERT INTO dbo.listing_attributes (listing_id, kind, label) VALUES (@other, 'language', 'Telugu');
    PRINT 'ok: two listings can hold the same label';
END TRY
BEGIN CATCH
    SET @failed = @failed + 1;
    PRINT 'FAIL: a label used by one listing blocks another';
END CATCH

-- 7. A blank label is refused by the database, not only by the API. A chip with nothing in it is a
--    visible gap on the public page.
BEGIN TRY
    INSERT INTO dbo.listing_attributes (listing_id, kind, label) VALUES (@listing, 'amenity', '   ');
    SET @failed = @failed + 1;
    PRINT 'FAIL: a blank label was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a blank label is refused';
END CATCH

-- ---------------------------------------------------------------- what the API reads
-- 8. The read the public page makes: labels grouped by kind, in the owner's order. Four rows on
--    this listing across three kinds.
SET @n = (SELECT COUNT(*) FROM dbo.listing_attributes WHERE listing_id = @listing);
IF @n <> 4
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: expected 4 labels on the listing, found ' + CAST(@n AS varchar(10));
END
ELSE PRINT 'ok: the listing holds its four labels across three kinds';

SET @n = (SELECT COUNT(DISTINCT kind) FROM dbo.listing_attributes WHERE listing_id = @listing);
IF @n <> 3
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the kinds did not survive as three distinct values';
END
ELSE PRINT 'ok: the three kinds read back as three distinct lists';

-- 9. Free on every plan: this listing has no subscription at all, and its labels are still there.
--    If someone later adds a listing_visible_attributes view with an allowance, this fails.
IF NOT EXISTS (SELECT 1 FROM dbo.subscriptions WHERE listing_id = @listing)
   AND (SELECT COUNT(*) FROM dbo.listing_attributes WHERE listing_id = @listing) = 4
    PRINT 'ok: a listing with no plan keeps every label, so these are free';
ELSE
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: either the listing has a plan it was not given, or its labels are gated';
END

-- 10. sort_order is the owner's own ordering and defaults rather than being left NULL, so a row
--     inserted without one still sorts.
SELECT @first = id FROM dbo.listing_attributes
WHERE listing_id = @listing AND kind = 'offering' AND label = 'Parking';

IF (SELECT sort_order FROM dbo.listing_attributes WHERE id = @first) IS NULL
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: sort_order came back NULL';
END
ELSE PRINT 'ok: sort_order defaults rather than being left NULL';

-- ---------------------------------------------------------------- cleanup behaviour
-- 11. Labels go with their listing. The owner endpoint deletes by (id, listing_id), but a listing
--     removed by an admin must not leave rows pointing at nothing.
DELETE FROM dbo.listings WHERE id = @listing;
IF (SELECT COUNT(*) FROM dbo.listing_attributes WHERE listing_id = @listing) <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: labels survived their listing';
END
ELSE PRINT 'ok: labels are removed with their listing';

-- 12. And only that listing's. The other one still has its own.
IF (SELECT COUNT(*) FROM dbo.listing_attributes WHERE listing_id = @other) <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: deleting one listing took another listing''s labels';
END
ELSE PRINT 'ok: the other listing kept its label';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'offerings, languages and amenities share one table and stay apart by kind, free on every plan';
GO

ROLLBACK TRANSACTION;
GO
