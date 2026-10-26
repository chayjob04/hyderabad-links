-- Manual smoke test for staff alerts and the curated Featured shelf (S0017).
--
-- Two things worth proving in the database rather than only in the API:
--
--   * an alert survives everything except its listing. The message is the thing an owner acts on,
--     so it must not depend on the email having been sent, on the admin account still existing, or
--     on anyone remembering to copy it somewhere.
--   * `featured_at` is nullable with no default, so nothing is featured by accident. The old shelf
--     was "whoever is paying", and the whole point of S0017 is that being on the homepage is now a
--     decision somebody took.
--
-- It creates its own admin, owner, business and listings, asserts, then rolls back, so it leaves no
-- data and is safe to re-run. Every slug is prefixed `smoke-al-` so it cannot collide with another
-- check or with a leftover row from an API run.
--
-- Run:
--   npm run db:check -- alerts

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @owner bigint, @business bigint, @listing bigint, @draft bigint, @admin bigint, @alert bigint;
DECLARE @locality int, @centre geography;
DECLARE @n int, @open int;

SELECT @locality = id, @centre = center FROM dbo.localities WHERE slug = 'madhapur';

INSERT INTO dbo.users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900091', SYSDATETIMEOFFSET(), 'Smoke Alert Owner', 'alerts@example.com');
SET @owner = SCOPE_IDENTITY();

INSERT INTO dbo.businesses (name) VALUES ('Smoke Alerts Business');
SET @business = SCOPE_IDENTITY();
INSERT INTO dbo.business_members (business_id, user_id, role) VALUES (@business, @owner, 'owner');

INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-al-live', 'Smoke Al Live', @centre, '+919999900091', 'active', @owner);
SET @listing = SCOPE_IDENTITY();

INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-al-draft', 'Smoke Al Draft', @centre, '+919999900091', 'draft', @owner);
SET @draft = SCOPE_IDENTITY();

INSERT INTO dbo.admin_users (email, display_name, status)
VALUES ('smoke-al-admin@example.com', 'Smoke Al Admin', 'active');
SET @admin = SCOPE_IDENTITY();

-- 1. Nothing is featured to begin with, which is what makes the shelf a decision.
IF (SELECT COUNT(*) FROM dbo.listings WHERE id IN (@listing, @draft) AND featured_at IS NOT NULL) <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a new listing arrived already featured';
END
ELSE PRINT 'ok: a new listing is not featured';

-- 2. An alert can be sent.
INSERT INTO dbo.listing_alerts (listing_id, admin_user_id, sent_by_name, message, reason)
VALUES (@listing, @admin, 'Smoke Al Admin', 'The phone number rings a different shop.', 'incorrect_details');
SET @alert = SCOPE_IDENTITY();

SET @open = (SELECT COUNT(*) FROM dbo.listing_alerts WHERE listing_id = @listing AND acknowledged_at IS NULL);
IF @open <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: expected 1 open alert, found ' + CAST(@open AS varchar(10));
END
ELSE PRINT 'ok: an alert is stored and starts out unacknowledged';

-- 3. An empty message is refused. An alert the owner cannot act on is worse than none.
BEGIN TRY
    INSERT INTO dbo.listing_alerts (listing_id, admin_user_id, sent_by_name, message, reason)
    VALUES (@listing, @admin, 'Smoke Al Admin', '   ', 'other');
    SET @failed = @failed + 1;
    PRINT 'FAIL: a blank alert message was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a blank alert message is refused';
END CATCH

-- 4. A reason nobody has words for is refused, so the API and the UI cannot drift apart.
BEGIN TRY
    INSERT INTO dbo.listing_alerts (listing_id, admin_user_id, sent_by_name, message, reason)
    VALUES (@listing, @admin, 'Smoke Al Admin', 'Something is wrong with this listing.', 'extremely_urgent');
    SET @failed = @failed + 1;
    PRINT 'FAIL: an unknown alert reason was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: an unknown alert reason is refused';
END CATCH

-- 5. Acknowledging closes it without deleting it: staff can still see what they asked for.
UPDATE dbo.listing_alerts SET acknowledged_at = SYSDATETIMEOFFSET() WHERE id = @alert;
SET @open = (SELECT COUNT(*) FROM dbo.listing_alerts WHERE listing_id = @listing AND acknowledged_at IS NULL);
SET @n = (SELECT COUNT(*) FROM dbo.listing_alerts WHERE id = @alert);
IF @open <> 0 OR @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: acknowledging left ' + CAST(@open AS varchar(10)) + ' open and ' + CAST(@n AS varchar(10)) + ' rows';
END
ELSE PRINT 'ok: acknowledging closes an alert and keeps it';

-- 6. The alert outlives the admin who sent it. Who said what to an owner is history.
DELETE FROM dbo.admin_users WHERE id = @admin;
SELECT @n = COUNT(*) FROM dbo.listing_alerts WHERE id = @alert AND admin_user_id IS NULL AND sent_by_name = 'Smoke Al Admin';
IF @n <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the alert did not survive its admin account being removed';
END
ELSE PRINT 'ok: an alert survives its sender, and still names them';

-- 7. Featuring is a plain UPDATE, and the filtered index finds it.
UPDATE dbo.listings SET featured_at = SYSDATETIMEOFFSET() WHERE id = @listing;
SET @n = (SELECT COUNT(*) FROM dbo.listings WHERE id = @listing AND featured_at IS NOT NULL);
IF @n <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the listing could not be featured';
END
ELSE PRINT 'ok: a listing can be featured';

/* 8. Featuring says nothing about being paid, and being paid says nothing about being featured.
   This is the actual change S0017 made: the two were the same thing before, and conflating them
   again would turn the curated shelf back into a list of whoever is paying. */
IF EXISTS (
    SELECT 1 FROM dbo.listing_entitlements e
    WHERE e.listing_id = @listing AND e.is_verified = 1)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: featuring a listing made it Verified';
END
ELSE PRINT 'ok: featured and Verified are independent';

-- 9. Un-featuring is a plain UPDATE back to NULL, and leaves the listing alone otherwise.
UPDATE dbo.listings SET featured_at = NULL, featured_by_admin_id = NULL WHERE id = @listing;
IF (SELECT COUNT(*) FROM dbo.listings WHERE id = @listing AND status = 'active' AND featured_at IS NULL) <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: un-featuring changed more than the shelf';
END
ELSE PRINT 'ok: un-featuring touches nothing else';

-- 10. Deleting the listing takes its alerts with it: an alert about nothing is noise.
INSERT INTO dbo.listing_alerts (listing_id, sent_by_name, message, reason)
VALUES (@listing, 'Smoke Al Admin', 'One more thing to fix before we finish.', 'missing_information');

DELETE FROM dbo.listings WHERE id = @listing;
SET @n = (SELECT COUNT(*) FROM dbo.listing_alerts WHERE listing_id = @listing);
IF @n <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: ' + CAST(@n AS varchar(10)) + ' alerts survived the listing';
END
ELSE PRINT 'ok: alerts are removed with their listing';

-- 11. The permission split, read from the rows the admin UI reads to decide what to draw.
IF NOT EXISTS (
    SELECT 1 FROM dbo.roles r
    JOIN dbo.role_permissions rp ON rp.role_id = r.id
    JOIN dbo.permissions p ON p.id = rp.permission_id
    WHERE r.slug = 'admin' AND p.code = 'listings.alert')
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the admin role cannot send an alert';
END
ELSE PRINT 'ok: an admin may write to an owner';

IF EXISTS (
    SELECT 1 FROM dbo.roles r
    JOIN dbo.role_permissions rp ON rp.role_id = r.id
    JOIN dbo.permissions p ON p.id = rp.permission_id
    WHERE r.slug = 'admin' AND p.code IN ('listings.feature', 'listings.delete'))
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the admin role can feature or delete a listing';
END
ELSE PRINT 'ok: an admin may neither choose the homepage nor delete a listing';

IF (SELECT COUNT(*) FROM dbo.roles r
    JOIN dbo.role_permissions rp ON rp.role_id = r.id
    JOIN dbo.permissions p ON p.id = rp.permission_id
    WHERE r.slug = 'super_admin' AND p.code IN ('listings.feature', 'listings.alert', 'listings.delete')) <> 3
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the super admin is missing one of the listing permissions';
END
ELSE PRINT 'ok: a super admin holds all three';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'alerts outlive their sender, the featured shelf is a choice, and the permission split holds';
GO

ROLLBACK TRANSACTION;
GO
