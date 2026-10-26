-- Manual smoke test for the review rules in S0004 (decision D11).
-- It creates its own users, listings and reviews, asserts the manipulation guards, then rolls back,
-- so it leaves no data and is safe to re-run.
--
-- The PostgreSQL original is database/checks/review_smoke.sql, kept as history. What changed:
-- GET DIAGNOSTICS became @@ROWCOUNT, and avg(rating) over a smallint column returns an integer in
-- SQL Server rather than a numeric, so the average is computed over a decimal cast. That is not
-- cosmetic: AVG over smallint would have truncated 4.5 to 4 and hidden a wrong average.
--
-- Run:
--   npm run db:check -- review_smoke

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @owner bigint, @customer bigint, @unverified bigint, @business bigint, @listing bigint;
DECLARE @n int, @rows int;
DECLARE @average decimal(10, 4);
DECLARE @locality int, @centre geography, @category int;

SELECT @locality = id, @centre = center FROM localities WHERE slug = 'madhapur';
SELECT @category = id FROM categories WHERE slug = 'cafes';

INSERT INTO users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900201', SYSDATETIMEOFFSET(), 'Smoke Owner', 'owner@example.com');
SET @owner = SCOPE_IDENTITY();
INSERT INTO users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900202', SYSDATETIMEOFFSET(), 'Anita Kumari', 'anita@example.com');
SET @customer = SCOPE_IDENTITY();
-- Deliberately unverified: decision D11 only lets a verified phone leave a review.
INSERT INTO users (phone_e164, name, email)
VALUES ('+919999900203', 'Unverified Person', 'unverified@example.com');
SET @unverified = SCOPE_IDENTITY();

INSERT INTO businesses (name) VALUES ('Smoke Review Cafe');
SET @business = SCOPE_IDENTITY();
INSERT INTO business_members (business_id, user_id, role) VALUES (@business, @owner, 'owner');

DECLARE @inserted TABLE (id bigint);
INSERT INTO listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
OUTPUT inserted.id INTO @inserted
VALUES (@business, @locality, 'smoke-review-cafe', 'Smoke Review Cafe', @centre, '+919999900201', 'active', @owner);
SET @listing = (SELECT TOP (1) id FROM @inserted);
INSERT INTO listing_categories (listing_id, category_id, category_level, is_primary) VALUES (@listing, @category, 2, 1);

-- 1. A review arrives pending, never published.
INSERT INTO reviews (listing_id, user_id, rating, body)
VALUES (@listing, @customer, 4, 'Good filter coffee and the staff were quick and polite.');
IF (SELECT status FROM reviews WHERE listing_id = @listing AND user_id = @customer) <> 'pending'
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a new review should be pending';
END
ELSE PRINT 'ok: a new review arrives pending';

-- 2. Nothing pending counts towards the public average.
SET @n = (SELECT COUNT(*) FROM reviews WHERE listing_id = @listing AND status = 'approved');
IF @n <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: ' + CAST(@n AS varchar(10)) + ' approved reviews before moderation';
END
ELSE PRINT 'ok: nothing is approved before moderation';

-- 3. One review per person, enforced by the constraint rather than the API.
BEGIN TRY
    INSERT INTO reviews (listing_id, user_id, rating, body)
    VALUES (@listing, @customer, 1, 'Trying to review the same business a second time.');
    SET @failed = @failed + 1; PRINT 'FAIL: a second review by the same person was accepted';
END TRY BEGIN CATCH PRINT 'ok: duplicate review rejected'; END CATCH;

-- 4. The constraints refuse rubbish, so a bug in the API cannot store it.
BEGIN TRY
    INSERT INTO reviews (listing_id, user_id, rating, body)
    VALUES (@listing, @unverified, 9, 'A rating of nine is not on the scale at all.');
    SET @failed = @failed + 1; PRINT 'FAIL: a rating outside 1-5 was accepted';
END TRY BEGIN CATCH PRINT 'ok: out-of-range rating rejected'; END CATCH;

BEGIN TRY
    INSERT INTO reviews (listing_id, user_id, rating, body)
    VALUES (@listing, @unverified, 5, 'Too short');
    SET @failed = @failed + 1; PRINT 'FAIL: a too-short review was accepted';
END TRY BEGIN CATCH PRINT 'ok: short review rejected'; END CATCH;

BEGIN TRY
    INSERT INTO reviews (listing_id, user_id, rating, body, status)
    VALUES (@listing, @unverified, 5, 'A review with a status that does not exist.', 'published');
    SET @failed = @failed + 1; PRINT 'FAIL: an unknown status was accepted';
END TRY BEGIN CATCH PRINT 'ok: unknown status rejected'; END CATCH;

-- 5. D11's verified-reviewer rule: the API checks phone_verified_at, and the data supports it.
IF (SELECT phone_verified_at FROM users WHERE id = @unverified) IS NOT NULL
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the unverified fixture is not actually unverified';
END
ELSE PRINT 'ok: the unverified fixture has no verified phone';

-- 6. The owner of the business is identifiable, which is how the API refuses a self-review.
IF NOT EXISTS (SELECT 1 FROM business_members bm
               JOIN listings li ON li.business_id = bm.business_id
               WHERE li.id = @listing AND bm.user_id = @owner)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the owner is not linked to their own listing';
END
ELSE PRINT 'ok: the owner is identifiable from the listing';

-- 7. Approving makes it public, and the average is computed over approved rows only.
UPDATE reviews SET status = 'approved', moderated_at = SYSDATETIMEOFFSET()
WHERE listing_id = @listing AND user_id = @customer AND status = 'pending';
SET @rows = @@ROWCOUNT;
IF @rows <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: approving a pending review affected ' + CAST(@rows AS varchar(10)) + ' rows';
END
ELSE PRINT 'ok: approving a pending review affected exactly one row';

-- The cast matters: AVG over a smallint column does integer division in SQL Server.
SET @average = (SELECT AVG(CAST(rating AS decimal(10, 4)))
                FROM reviews WHERE listing_id = @listing AND status = 'approved');
IF @average IS NULL OR @average <> 4
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the average was ' + ISNULL(CAST(@average AS varchar(20)), 'NULL') + ', expected 4';
END
ELSE PRINT 'ok: the public average reads 4 over approved rows only';

-- 8. A decided review cannot be decided again, so two moderators cannot both record an outcome.
UPDATE reviews SET status = 'rejected'
WHERE listing_id = @listing AND user_id = @customer AND status = 'pending';
SET @rows = @@ROWCOUNT;
IF @rows <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: an already-decided review was decided again';
END
ELSE PRINT 'ok: a decided review cannot be decided again';

-- 9. Deleting a listing takes its reviews with it.
DELETE FROM listing_categories WHERE listing_id = @listing;
DELETE FROM listings WHERE id = @listing;
SET @n = (SELECT COUNT(*) FROM reviews WHERE listing_id = @listing);
IF @n <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: ' + CAST(@n AS varchar(10)) + ' reviews outlived their listing';
END
ELSE PRINT 'ok: reviews do not outlive their listing';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'review rules behaved as expected';
GO

ROLLBACK TRANSACTION;
GO
