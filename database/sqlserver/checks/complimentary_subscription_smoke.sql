-- Manual smoke test for S0033: a subscription can be granted by staff, and it has to say so.
-- The transactional part inserts, asserts, and rolls back, so it leaves no data and is safe to re-run.
--
-- The rules here are the ones that keep a gift from being read as revenue, and they are CHECK
-- constraints rather than application code: a complimentary period must name the admin who granted
-- it and the reason, and a paid one must name neither. The second half is the one worth having --
-- without it, a grant could be recorded as a payment and would then appear in a report somebody
-- reconciles against Razorpay.
--
-- It also asserts the thing the whole feature rests on: that a granted period grants exactly what a
-- paid one grants, because dbo.listing_entitlements reads the period and the clock and does not
-- care how the subscription arrived.
--
-- Run:
--   npm run db:check -- complimentary
--
-- NOTE, honestly: this file has never been executed. There is no SQL Server available outside
-- production in this environment, so it was written alongside the migration and is the first thing
-- to run once S0033 has been applied to a database somebody can afford to break.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

IF COL_LENGTH('dbo.subscriptions', 'source') IS NULL
BEGIN
    PRINT 'FAIL: dbo.subscriptions has no source column, so S0033 has not run';
    THROW 51035, 'S0033 has not been applied.', 1;
END;
PRINT 'ok: the grant columns exist';
GO

-- Every row that existed before the migration is a payment and claims no grant.
IF EXISTS (
    SELECT 1 FROM dbo.subscriptions
    WHERE source = 'payment' AND (granted_by_admin_id IS NOT NULL OR grant_reason IS NOT NULL))
BEGIN
    PRINT 'FAIL: a paid subscription carries grant details';
    THROW 51036, 'A paid subscription carries grant details.', 1;
END;
PRINT 'ok: no paid subscription claims to have been granted';
GO

DECLARE @failed int = 0;
BEGIN TRANSACTION;

DECLARE @owner bigint, @business bigint, @locality int, @centre geography;
DECLARE @listing bigint, @admin bigint, @category int;

SELECT @locality = id, @centre = center FROM dbo.localities WHERE slug = 'madhapur';
SELECT TOP (1) @category = id FROM dbo.categories WHERE level = 2 ORDER BY id;
SELECT TOP (1) @admin = id FROM dbo.admin_users ORDER BY id;

IF @admin IS NULL
BEGIN
    PRINT 'SKIP: this check needs at least one admin account to attribute a grant to';
    ROLLBACK TRANSACTION;
    RETURN;
END;

INSERT INTO dbo.users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900811', SYSDATETIMEOFFSET(), 'Smoke Grant Owner', 'grant@example.com');
SET @owner = SCOPE_IDENTITY();

INSERT INTO dbo.businesses (name) VALUES ('Smoke Grant Business');
SET @business = SCOPE_IDENTITY();
INSERT INTO dbo.business_members (business_id, user_id, role) VALUES (@business, @owner, 'owner');

INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-grant-cafe', 'Smoke Grant Cafe', @centre, '+919999900811', 'active', @owner);
SET @listing = SCOPE_IDENTITY();
INSERT INTO dbo.listing_categories (listing_id, category_id, is_primary) VALUES (@listing, @category, 1);

-- 1. Free to start with: no subscription, so the entitlement view says free.
IF (SELECT effective_plan_slug FROM dbo.listing_entitlements WHERE listing_id = @listing) <> 'free'
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a listing with no subscription is not free';
END
ELSE PRINT 'ok: a listing with no subscription is free';

-- 2. A complimentary period needs an admin and a reason. Both halves.
BEGIN TRY
    INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at, source)
    VALUES (@listing, 'verified', 'active', SYSDATETIMEOFFSET(), DATEADD(month, 12, SYSDATETIMEOFFSET()), 'complimentary');
    SET @failed = @failed + 1;
    PRINT 'FAIL: a complimentary period was accepted with no admin and no reason';
END TRY
BEGIN CATCH
    PRINT 'ok: a complimentary period must say who granted it and why';
END CATCH

BEGIN TRY
    INSERT INTO dbo.subscriptions
        (listing_id, plan_slug, status, starts_at, expires_at, source, granted_by_admin_id, grant_reason)
    VALUES (@listing, 'verified', 'active', SYSDATETIMEOFFSET(), DATEADD(month, 12, SYSDATETIMEOFFSET()),
            'complimentary', @admin, N'   ');
    SET @failed = @failed + 1;
    PRINT 'FAIL: a blank reason was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a blank reason is not a reason';
END CATCH

-- 3. A paid period must NOT carry grant details. This is what stops a gift being filed as revenue.
BEGIN TRY
    INSERT INTO dbo.subscriptions
        (listing_id, plan_slug, status, starts_at, expires_at, source, granted_by_admin_id, grant_reason)
    VALUES (@listing, 'verified', 'active', SYSDATETIMEOFFSET(), DATEADD(month, 12, SYSDATETIMEOFFSET()),
            'payment', @admin, N'pretending this was paid');
    SET @failed = @failed + 1;
    PRINT 'FAIL: a payment was accepted carrying grant details';
END TRY
BEGIN CATCH
    PRINT 'ok: a paid period cannot carry a grant';
END CATCH

-- 4. A source outside the two is refused.
BEGIN TRY
    INSERT INTO dbo.subscriptions
        (listing_id, plan_slug, status, starts_at, expires_at, source, granted_by_admin_id, grant_reason)
    VALUES (@listing, 'verified', 'active', SYSDATETIMEOFFSET(), DATEADD(month, 12, SYSDATETIMEOFFSET()),
            'gift', @admin, N'a third kind');
    SET @failed = @failed + 1;
    PRINT 'FAIL: a third source was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a subscription is paid for or granted, and nothing else';
END CATCH

-- 5. A proper grant is accepted, and grants exactly what a payment would.
DECLARE @granted bigint;
INSERT INTO dbo.subscriptions
    (listing_id, plan_slug, status, starts_at, expires_at, source, granted_by_admin_id, grant_reason)
VALUES (@listing, 'verified', 'active', DATEADD(millisecond, -1, SYSDATETIMEOFFSET()),
        DATEADD(month, 12, SYSDATETIMEOFFSET()), 'complimentary', @admin, N'Compensation for the outage on the 3rd');
SET @granted = SCOPE_IDENTITY();
PRINT 'ok: a grant with an admin and a reason is accepted';

IF (SELECT effective_plan_slug FROM dbo.listing_entitlements WHERE listing_id = @listing) <> 'verified'
   OR (SELECT is_verified FROM dbo.listing_entitlements WHERE listing_id = @listing) <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a granted period does not grant the plan';
END
ELSE PRINT 'ok: a granted period grants exactly what a paid one grants';

-- 6. And no payment row came into existence. The whole point.
IF EXISTS (SELECT 1 FROM dbo.subscription_payments WHERE listing_id = @listing)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: granting a period created a payment record';
END
ELSE PRINT 'ok: granting a period records no payment';

-- 7. Ending it: cancelled, not deleted, and the listing reads as free again from the next read.
UPDATE dbo.subscriptions SET status = 'cancelled' WHERE id = @granted;

IF (SELECT effective_plan_slug FROM dbo.listing_entitlements WHERE listing_id = @listing) <> 'free'
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a cancelled period still grants its plan';
END
ELSE PRINT 'ok: a cancelled period stops granting immediately';

IF NOT EXISTS (SELECT 1 FROM dbo.subscriptions WHERE id = @granted AND grant_reason IS NOT NULL)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: ending a period lost the record of why it was granted';
END
ELSE PRINT 'ok: the record of the grant survives being ended';

-- 8. An expired period grants nothing, granted or paid: the view compares against the clock.
UPDATE dbo.subscriptions
SET status = 'active', starts_at = DATEADD(month, -13, SYSDATETIMEOFFSET()),
    expires_at = DATEADD(day, -1, SYSDATETIMEOFFSET())
WHERE id = @granted;

IF (SELECT effective_plan_slug FROM dbo.listing_entitlements WHERE listing_id = @listing) <> 'free'
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a period that has run out still grants its plan';
END
ELSE PRINT 'ok: a granted period runs out the same way a paid one does';

ROLLBACK TRANSACTION;

IF @failed > 0
BEGIN
    DECLARE @message nvarchar(200) = CAST(@failed AS nvarchar(10)) + ' complimentary-subscription check(s) failed.';
    THROW 51037, @message, 1;
END
PRINT 'complimentary_subscription_smoke: all checks passed.';
GO
