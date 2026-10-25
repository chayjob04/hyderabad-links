-- Manual smoke test for the database rules behind owner onboarding (decision D24).
-- It creates its own user, registers them the way POST /api/v1/me/onboarding does, asserts the
-- invariants that endpoint depends on, then rolls back, so it leaves no data and is safe to re-run.
--
-- The PostgreSQL original is database/checks/onboarding_smoke.sql, kept as history. What changed:
-- GET DIAGNOSTICS became @@ROWCOUNT, RETURNING became OUTPUT into a table variable (listings has a
-- trigger, which rules out a bare OUTPUT clause), and ST_Equals became STEquals, which returns a
-- bit and so has to be compared to 1 rather than used as a condition on its own.
--
-- Run:
--   npm run db:check -- onboarding_smoke

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @user bigint, @business bigint, @listing bigint, @rows int;
DECLARE @locality int, @centre geography, @phone varchar(20), @category int;

SELECT @locality = id, @centre = center FROM localities WHERE slug = 'kukatpally';
SELECT @category = id FROM categories WHERE slug = 'plumbers';

-- A phone that has just verified an OTP: the row exists, but there is no profile yet.
INSERT INTO users (phone_e164, phone_verified_at) VALUES ('+919999900081', SYSDATETIMEOFFSET());
SET @user = SCOPE_IDENTITY();
SET @phone = '+919999900081';

-- 1. A freshly verified user has no name, which is what "needs onboarding" means.
IF (SELECT name FROM users WHERE id = @user) IS NOT NULL
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a new user should have no name';
END
ELSE PRINT 'ok: a freshly verified user has no profile';

-- 2. The listing is built only from data onboarding actually has: the chosen locality's centre
--    point and the verified phone number. Nothing is invented.
INSERT INTO businesses (name) VALUES ('Smoke Onboarding Plumbing');
SET @business = SCOPE_IDENTITY();
INSERT INTO business_members (business_id, user_id, role) VALUES (@business, @user, 'owner');

DECLARE @inserted TABLE (id bigint);
INSERT INTO listings (business_id, locality_id, slug, name, location, phone_primary, status, source, created_by_user_id)
OUTPUT inserted.id INTO @inserted
VALUES (@business, @locality, 'smoke-onboarding-plumbing', 'Smoke Onboarding Plumbing',
        @centre, @phone, 'draft', 'owner', @user);
SET @listing = (SELECT TOP (1) id FROM @inserted);

INSERT INTO listing_categories (listing_id, category_id, category_level, is_primary)
VALUES (@listing, @category, 2, 1);

-- 3. The profile update is guarded by `name IS NULL`, so it applies exactly once.
UPDATE users SET name = 'Ramesh Kumar', email = 'ramesh@example.com'
WHERE id = @user AND name IS NULL;
SET @rows = @@ROWCOUNT;
IF @rows <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the first profile update affected ' + CAST(@rows AS varchar(10)) + ' rows, expected 1';
END
ELSE PRINT 'ok: the first profile update applied';

-- 4. A repeated request cannot overwrite the profile that is already there.
UPDATE users SET name = 'Someone Else', email = 'other@example.com'
WHERE id = @user AND name IS NULL;
SET @rows = @@ROWCOUNT;
IF @rows <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a repeat overwrote the profile (' + CAST(@rows AS varchar(10)) + ' rows)';
END
ELSE IF (SELECT name FROM users WHERE id = @user) <> 'Ramesh Kumar'
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the name was changed by the repeat';
END
ELSE PRINT 'ok: a repeated onboarding left the profile alone';

-- 5. Ownership cannot be recorded twice for the same person and business.
BEGIN TRY
    INSERT INTO business_members (business_id, user_id, role) VALUES (@business, @user, 'owner');
    SET @failed = @failed + 1; PRINT 'FAIL: a duplicate ownership row was accepted';
END TRY BEGIN CATCH PRINT 'ok: duplicate ownership rejected'; END CATCH;

-- 6. The first listing is a draft owned by this user, and a draft is not public.
IF NOT EXISTS (SELECT 1 FROM listings
               WHERE id = @listing AND status = 'draft' AND source = 'owner' AND created_by_user_id = @user)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the first listing is not an owner draft';
END
ELSE PRINT 'ok: the first listing is an owner draft';

IF EXISTS (SELECT 1 FROM listings WHERE id = @listing AND status = 'active')
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a newly registered listing must not be public';
END
ELSE PRINT 'ok: a newly registered listing is not public';

-- 7. The listing sits at the locality centre and carries the verified number.
IF NOT EXISTS (SELECT 1 FROM listings li
               WHERE li.id = @listing
                 AND li.phone_primary = @phone
                 AND li.location.STEquals(@centre) = 1)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the listing location or phone did not come from the expected source';
END
ELSE PRINT 'ok: the listing sits at the locality centre with the verified number';

-- 8. Exactly one business and one listing for this owner.
SET @rows = (SELECT COUNT(*) FROM business_members WHERE user_id = @user);
IF @rows <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the owner has ' + CAST(@rows AS varchar(10)) + ' businesses, expected 1';
END
ELSE PRINT 'ok: the owner has exactly one business';

SET @rows = (SELECT COUNT(*) FROM listings WHERE created_by_user_id = @user);
IF @rows <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the owner has ' + CAST(@rows AS varchar(10)) + ' listings, expected 1';
END
ELSE PRINT 'ok: the owner has exactly one listing';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'onboarding rules behaved as expected';
GO

ROLLBACK TRANSACTION;
GO
