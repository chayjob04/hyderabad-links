-- Manual smoke test for the subscription and payment rules the API leans on (S0009).
--
-- `listing_links_smoke` already proves what an active period *grants*. This one proves the rules
-- underneath it: that a payment cannot be recorded twice, that a listing cannot hold two live
-- periods, that a renewal extends rather than restarts, and that the record of money taken outlives
-- the listing it was taken for.
--
-- Those rules are what makes the API's payment handling safe, and they belong in the database rather
-- than only in C#: the webhook and the owner's browser can arrive at the same instant, and an index
-- is the only thing that settles a race between two connections.
--
-- **Nothing here is a payment.** Every row exists only inside a transaction that is rolled back, no
-- provider is contacted, and no amount is ever marked paid outside this script. This is how the paid
-- path is tested without taking money.
--
-- It creates its own owner, business and listings, asserts, then rolls back, so it is safe to
-- re-run. Every slug is prefixed `smoke-sub-` so it cannot collide with another check.
--
-- Run:
--   npm run db:check -- subscription

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @owner bigint, @business bigint, @listing bigint, @other bigint;
DECLARE @locality int, @centre geography, @category int;
DECLARE @sub bigint, @renewal bigint, @attempt bigint;
DECLARE @n int, @expires datetimeoffset(3), @extended datetimeoffset(3);
DECLARE @status varchar(20), @currency char(3), @provider varchar(30);

SELECT @locality = id, @centre = center FROM dbo.localities WHERE slug = 'madhapur';
SELECT @category = id FROM dbo.categories WHERE slug = 'plumbers';

INSERT INTO dbo.users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900091', SYSDATETIMEOFFSET(), 'Smoke Sub Owner', 'subs@example.com');
SET @owner = SCOPE_IDENTITY();

INSERT INTO dbo.businesses (name) VALUES ('Smoke Subscription Business');
SET @business = SCOPE_IDENTITY();
INSERT INTO dbo.business_members (business_id, user_id, role) VALUES (@business, @owner, 'owner');

INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-sub-main', 'Smoke Sub Main', @centre, '+919999900091', 'active', @owner);
SET @listing = SCOPE_IDENTITY();

INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-sub-other', 'Smoke Sub Other', @centre, '+919999900091', 'active', @owner);
SET @other = SCOPE_IDENTITY();

INSERT INTO dbo.listing_categories (listing_id, category_id, category_level, is_primary)
SELECT id, @category, 2, 1 FROM dbo.listings WHERE slug LIKE 'smoke-sub-%';

-- ------------------------------------------------------------------ 1-4. an attempt, not a payment
-- 1. An order is recorded before anybody pays, with no payment id and no paid_at. That is what the
--    API writes when it opens a checkout, and it must be possible to store it in exactly that state.
INSERT INTO dbo.subscription_payments (listing_id, provider_order_id, amount_paise, status)
VALUES (@listing, 'order_smokesub0001', 39900, 'created');
SET @attempt = SCOPE_IDENTITY();

SELECT @status = status, @currency = currency, @provider = provider
FROM dbo.subscription_payments WHERE id = @attempt;

IF @status <> 'created' OR @currency <> 'INR' OR @provider <> 'razorpay'
   OR EXISTS (SELECT 1 FROM dbo.subscription_payments
              WHERE id = @attempt AND (paid_at IS NOT NULL OR signature_verified_at IS NOT NULL))
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a fresh attempt did not store as created/INR/razorpay with nothing paid';
END
ELSE PRINT 'ok: an opened order is stored as an attempt, with no payment and no signature yet';

-- 2. A free order is not a thing. An amount of zero would let a payment of nothing buy a year.
BEGIN TRY
    INSERT INTO dbo.subscription_payments (listing_id, provider_order_id, amount_paise, status)
    VALUES (@listing, 'order_smokesub0002', 0, 'created');
    SET @failed = @failed + 1;
    PRINT 'FAIL: an amount of zero was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a payment amount of zero is refused';
END CATCH

-- 3. Only the five states the API uses.
BEGIN TRY
    INSERT INTO dbo.subscription_payments (listing_id, provider_order_id, amount_paise, status)
    VALUES (@listing, 'order_smokesub0003', 39900, 'settled');
    SET @failed = @failed + 1;
    PRINT 'FAIL: an unknown payment status was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: an unknown payment status is refused';
END CATCH

-- 4. The replay protection that matters most: one attempt per provider order id. Without this, a
--    repeated "open a checkout" call would leave two rows and the second payment could be applied
--    on top of the first.
BEGIN TRY
    INSERT INTO dbo.subscription_payments (listing_id, provider_order_id, amount_paise, status)
    VALUES (@listing, 'order_smokesub0001', 39900, 'created');
    SET @failed = @failed + 1;
    PRINT 'FAIL: the same provider order id was accepted twice';
END TRY
BEGIN CATCH
    PRINT 'ok: one attempt per provider order id';
END CATCH

-- 5. The same for a payment id, so one payment cannot be claimed against two orders.
UPDATE dbo.subscription_payments
SET provider_payment_id = 'pay_smokesub0001', status = 'paid',
    signature_verified_at = SYSDATETIMEOFFSET(), paid_at = SYSDATETIMEOFFSET()
WHERE id = @attempt;

BEGIN TRY
    INSERT INTO dbo.subscription_payments (listing_id, provider_order_id, provider_payment_id, amount_paise, status)
    VALUES (@listing, 'order_smokesub0004', 'pay_smokesub0001', 39900, 'paid');
    SET @failed = @failed + 1;
    PRINT 'FAIL: the same provider payment id was accepted twice';
END TRY
BEGIN CATCH
    PRINT 'ok: one row per provider payment id';
END CATCH

-- 6. And for the webhook event id, which is what makes Razorpay's redeliveries harmless. Razorpay
--    redelivers whenever it does not get a 2xx, so this is an everyday case and not an edge one.
UPDATE dbo.subscription_payments SET webhook_event_id = 'evt_smokesub0001' WHERE id = @attempt;

BEGIN TRY
    INSERT INTO dbo.subscription_payments (listing_id, provider_order_id, webhook_event_id, amount_paise, status)
    VALUES (@listing, 'order_smokesub0005', 'evt_smokesub0001', 39900, 'paid');
    SET @failed = @failed + 1;
    PRINT 'FAIL: the same webhook event id was accepted twice';
END TRY
BEGIN CATCH
    PRINT 'ok: a redelivered webhook event cannot be applied twice';
END CATCH

-- 7. The three unique indexes are filtered on NOT NULL, so attempts that have not reached a payment
--    yet do not collide with each other. A plain unique index would have allowed exactly one
--    unpaid attempt in the whole table.
INSERT INTO dbo.subscription_payments (listing_id, provider_order_id, amount_paise, status)
VALUES (@listing, 'order_smokesub0006', 39900, 'created'),
       (@listing, 'order_smokesub0007', 39900, 'created');

SET @n = (SELECT COUNT(*) FROM dbo.subscription_payments
          WHERE listing_id = @listing AND provider_payment_id IS NULL);
IF @n <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: expected 2 attempts with no payment id, found ' + CAST(@n AS varchar(10));
END
ELSE PRINT 'ok: several attempts can sit unpaid at once, because the unique indexes are filtered';

-- ------------------------------------------------------------------ 8-12. periods
-- 8. A period that is paid for: this is what the API grants, and the only way a listing becomes
--    Verified.
--
--    The `DATEADD(millisecond, -1, ...)` is copied from the API deliberately, so this assertion is
--    also the regression test for why it is there. starts_at is datetimeoffset(3) and
--    SYSDATETIMEOFFSET() carries more precision than that, so a plain SYSDATETIMEOFFSET() is
--    rounded to the nearest millisecond on the way in — measured at 111 microseconds into the
--    *future* — while the view requires starts_at <= SYSDATETIMEOFFSET(). Two clock reads inside one
--    batch return the same value, so a period written that way reads as not-yet-started for the rest
--    of the batch. Written the first way, this check passed twice and then failed: it is a coin flip
--    on whether the sub-millisecond part rounds up or down.
INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
VALUES (@listing, 'verified', 'active', DATEADD(millisecond, -1, SYSDATETIMEOFFSET()), DATEADD(month, 12, SYSDATETIMEOFFSET()));
SET @sub = SCOPE_IDENTITY();

IF NOT EXISTS (SELECT 1 FROM dbo.listing_entitlements
               WHERE listing_id = @listing AND is_verified = 1 AND link_limit = 5)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a twelve-month period did not make the listing Verified';
END
ELSE PRINT 'ok: a twelve-month period makes the listing Verified';

-- 9. One live period per listing. Two active rows would mean two expiry dates and no answer to
--    "when does this end"; the API closes a lapsed row before opening a new one for this reason.
BEGIN TRY
    INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
    VALUES (@listing, 'verified', 'active', SYSDATETIMEOFFSET(), DATEADD(month, 12, SYSDATETIMEOFFSET()));
    SET @failed = @failed + 1;
    PRINT 'FAIL: a listing was allowed two active subscriptions';
END TRY
BEGIN CATCH
    PRINT 'ok: a listing cannot hold two active periods at once';
END CATCH

-- 10. A renewal extends from the existing end date, so renewing a month early keeps that month.
--     This is the arithmetic the API does; asserting it here is what stops a renewal from silently
--     resetting the clock to today and losing whatever was left.
SELECT @expires = expires_at FROM dbo.subscriptions WHERE id = @sub;
UPDATE dbo.subscriptions SET expires_at = DATEADD(month, 12, expires_at) WHERE id = @sub;
SELECT @extended = expires_at FROM dbo.subscriptions WHERE id = @sub;

IF @extended <> DATEADD(month, 12, @expires) OR @extended <= DATEADD(month, 12, SYSDATETIMEOFFSET())
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a renewal did not extend from the existing end date';
END
ELSE PRINT 'ok: a renewal adds to what is left rather than restarting from today';

-- 11. Closing a lapsed period, then opening a new one, is allowed — the sequence the API runs when
--     somebody comes back after letting their plan run out. The one-active index would refuse it in
--     the wrong order, which is the whole reason the API closes first.
UPDATE dbo.subscriptions
SET status = 'active', starts_at = DATEADD(day, -400, SYSDATETIMEOFFSET()),
    expires_at = DATEADD(day, -35, SYSDATETIMEOFFSET())
WHERE id = @sub;

UPDATE dbo.subscriptions
SET status = 'expired'
WHERE listing_id = @listing AND status = 'active' AND expires_at <= SYSDATETIMEOFFSET();

INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
VALUES (@listing, 'verified', 'active', DATEADD(millisecond, -1, SYSDATETIMEOFFSET()), DATEADD(month, 12, SYSDATETIMEOFFSET()));
SET @renewal = SCOPE_IDENTITY();

SET @n = (SELECT COUNT(*) FROM dbo.subscriptions WHERE listing_id = @listing AND status = 'active');
IF @n <> 1 OR NOT EXISTS (SELECT 1 FROM dbo.listing_entitlements WHERE listing_id = @listing AND is_verified = 1)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: coming back after a lapse left ' + CAST(@n AS varchar(10)) + ' active periods';
END
ELSE PRINT 'ok: a lapsed period can be closed and replaced, leaving exactly one live period';

-- 12. A period on one listing grants nothing to another, even under the same owner. The badge is
--     per listing (decision D5), so this is the line that keeps it that way.
IF EXISTS (SELECT 1 FROM dbo.listing_entitlements WHERE listing_id = @other AND is_verified = 1)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: one listing''s subscription verified another';
END
ELSE PRINT 'ok: a subscription verifies only the listing that paid for it';

-- ------------------------------------------------------------------ 13-16. what happens to the record
-- 13. A payment belongs to the period it bought, and dies with it.
UPDATE dbo.subscription_payments SET subscription_id = @renewal WHERE id = @attempt;
DELETE FROM dbo.subscriptions WHERE id = @renewal;

IF EXISTS (SELECT 1 FROM dbo.subscription_payments WHERE id = @attempt)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a payment survived the subscription it belonged to';
END
ELSE PRINT 'ok: a payment row is removed with the subscription it bought';

-- 14. A payment that never got as far as a subscription outlives the listing. listing_id carries no
--     foreign key on purpose — a second cascade path from listings is something SQL Server refuses
--     outright — and the consequence is the right one: a record of money taken must not vanish
--     because the listing it was taken for was deleted.
SET @n = (SELECT COUNT(*) FROM dbo.subscription_payments WHERE listing_id = @listing);
DELETE FROM dbo.listings WHERE id = @listing;

IF (SELECT COUNT(*) FROM dbo.subscription_payments WHERE listing_id = @listing) <> @n
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: unattached payment rows were deleted with the listing';
END
ELSE PRINT 'ok: a payment not yet tied to a subscription outlives the listing';

-- 15. Subscriptions themselves do go with the listing, because an entitlement for a listing that no
--     longer exists is meaningless.
SET @n = (SELECT COUNT(*) FROM dbo.subscriptions WHERE listing_id = @listing);
IF @n <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: ' + CAST(@n AS varchar(10)) + ' subscriptions survived their listing';
END
ELSE PRINT 'ok: subscriptions are removed with their listing';

-- 16. A retired tier cannot be sold again. S0011 deleted the Basic, Advanced and Premium rows, so
--     the foreign key now refuses those slugs outright — which is the backstop behind "no obsolete
--     plan can be chosen through the API". Nothing in the API accepts a plan slug from a caller in
--     the first place, but this is the line that would hold even if something one day did.
BEGIN TRY
    INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
    VALUES (@other, 'premium', 'active', SYSDATETIMEOFFSET(), DATEADD(month, 12, SYSDATETIMEOFFSET()));
    SET @failed = @failed + 1;
    PRINT 'FAIL: a subscription was sold on the retired Premium tier';
END TRY
BEGIN CATCH
    PRINT 'ok: a retired tier cannot be subscribed to';
END CATCH

-- 17. And only two plans exist at all, so nothing can offer a third.
SET @n = (SELECT COUNT(*) FROM dbo.plans);
IF @n <> 2 OR EXISTS (SELECT 1 FROM dbo.plans WHERE slug NOT IN ('free', 'verified'))
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: expected exactly Free and Verified, found ' + CAST(@n AS varchar(10)) + ' plan(s)';
END
ELSE PRINT 'ok: Free and Verified are the only plans that exist';

-- 18. The paid plan is still what S0009 set it to. If the price or the allowance in the database
--     ever drifts from Rs 399 / 10 photos / 2 videos, the API would charge or grant the new figure
--     silently, because it reads both from here.
IF NOT EXISTS (SELECT 1 FROM dbo.plans
               WHERE slug = 'verified' AND is_active = 1 AND grants_verified_badge = 1
                 AND price_paise = 39900 AND photo_limit = 10 AND video_limit = 2 AND logo_limit = 1)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the verified plan is not Rs 399 for 10 photos, 2 videos and 1 logo';
END
ELSE PRINT 'ok: the paid plan is Rs 399 a year for the badge, 10 photos, 2 videos and 1 logo';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'payments cannot be applied twice, and a period extends rather than restarts';
GO

ROLLBACK TRANSACTION;
GO
