-- Manual smoke test for the Verified plan's entitlements and the website/social links (S0009).
--
-- The point that matters is that expiry is a comparison against the clock, not a stored flag:
-- listing_entitlements must report a listing as Verified while its subscription period covers now,
-- and as Free the moment it does not, with no job having run in between. The link allowance and the
-- five-link cap hang off that same view.
--
-- It creates its own owner, business and listings, asserts, then rolls back, so it leaves no data
-- and is safe to re-run. Every slug is prefixed `smoke-lk-` so it does not collide with another
-- check or with a leftover row from an API run.
--
-- This is the mechanism for testing a paid subscription *without* a payment: the rows exist only
-- inside a transaction that is rolled back, so nothing here is ever a real subscription and no
-- payment is implied or recorded.
--
-- Run:
--   npm run db:check -- listing_links

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @owner bigint, @business bigint, @free bigint, @paid bigint, @lapsed bigint;
DECLARE @locality int, @centre geography, @category int;
DECLARE @n int, @limit int, @verified bit, @plan varchar(60);

SELECT @locality = id, @centre = center FROM dbo.localities WHERE slug = 'madhapur';
SELECT @category = id FROM dbo.categories WHERE slug = 'plumbers';

INSERT INTO dbo.users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900081', SYSDATETIMEOFFSET(), 'Smoke Link Owner', 'links@example.com');
SET @owner = SCOPE_IDENTITY();

INSERT INTO dbo.businesses (name) VALUES ('Smoke Links Business');
SET @business = SCOPE_IDENTITY();
INSERT INTO dbo.business_members (business_id, user_id, role) VALUES (@business, @owner, 'owner');

-- Three listings: one never paid, one paid and current, one whose period has run out.
INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-lk-free',   'Smoke Lk Free',   @centre, '+919999900081', 'active', @owner);
SET @free = SCOPE_IDENTITY();

INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-lk-paid',   'Smoke Lk Paid',   @centre, '+919999900081', 'active', @owner);
SET @paid = SCOPE_IDENTITY();

INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-lk-lapsed', 'Smoke Lk Lapsed', @centre, '+919999900081', 'active', @owner);
SET @lapsed = SCOPE_IDENTITY();

INSERT INTO dbo.listing_categories (listing_id, category_id, category_level, is_primary)
SELECT id, @category, 2, 1 FROM dbo.listings WHERE slug LIKE 'smoke-lk-%';

-- The paid one: a 365-day period that started yesterday, which is what Rs 399 buys.
INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
VALUES (@paid, 'verified', 'active', DATEADD(day, -1, SYSDATETIMEOFFSET()), DATEADD(day, 364, SYSDATETIMEOFFSET()));
UPDATE dbo.listings SET plan_slug = 'verified' WHERE id = @paid;

-- The lapsed one: still status 'active', but the period ended yesterday. Nothing has run to tidy it
-- up, which is the whole point -- the view must not be fooled by the status alone.
INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
VALUES (@lapsed, 'verified', 'active', DATEADD(day, -366, SYSDATETIMEOFFSET()), DATEADD(day, -1, SYSDATETIMEOFFSET()));
UPDATE dbo.listings SET plan_slug = 'verified' WHERE id = @lapsed;

-- 1. A listing that never paid is Free, unverified, and gets no links.
SELECT @plan = effective_plan_slug, @limit = link_limit, @verified = is_verified
FROM dbo.listing_entitlements WHERE listing_id = @free;
IF @plan <> 'free' OR @limit <> 0 OR @verified <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: free listing read as ' + @plan + ', link_limit ' + CAST(@limit AS varchar(10));
END
ELSE PRINT 'ok: a listing with no subscription is free, unverified, and allowed no links';

-- 2. A current period makes it Verified with five links.
SELECT @plan = effective_plan_slug, @limit = link_limit, @verified = is_verified
FROM dbo.listing_entitlements WHERE listing_id = @paid;
IF @plan <> 'verified' OR @limit <> 5 OR @verified <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: paid listing read as ' + @plan + ', link_limit ' + CAST(@limit AS varchar(10));
END
ELSE PRINT 'ok: a current subscription grants the badge and five links';

-- 3. The paid listing also gets the Verified media allowance (10 photos, 3 videos, 1 logo).
SELECT @n = photo_limit FROM dbo.listing_entitlements WHERE listing_id = @paid;
IF @n <> 10
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: paid photo_limit was ' + CAST(@n AS varchar(10)) + ', expected 10';
END
ELSE PRINT 'ok: the paid listing gets ten photo slots';

SELECT @n = video_limit FROM dbo.listing_entitlements WHERE listing_id = @paid;
IF @n <> 3
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: paid video_limit was ' + CAST(@n AS varchar(10)) + ', expected 3';
END
ELSE PRINT 'ok: the paid listing gets three video slots';

-- 4. The expired period reads as Free again, with no job having run. This is the assertion the
--    whole design exists for: a missed background task cannot leave a badge up for free.
SELECT @plan = effective_plan_slug, @limit = link_limit, @verified = is_verified
FROM dbo.listing_entitlements WHERE listing_id = @lapsed;
IF @plan <> 'free' OR @limit <> 0 OR @verified <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: lapsed listing read as ' + @plan + ', link_limit ' + CAST(@limit AS varchar(10));
END
ELSE PRINT 'ok: an expired period reads as free immediately, with no job run';

-- 5. The lapsed listing still remembers what it bought, so the owner can be told it expired rather
--    than just losing the tier.
SELECT @plan = subscribed_plan_slug FROM dbo.listing_entitlements WHERE listing_id = @lapsed;
IF @plan <> 'verified'
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: lapsed subscribed_plan_slug was ' + @plan;
END
ELSE PRINT 'ok: a lapsed listing still records the plan it had bought';

-- 6. Five links fit.
INSERT INTO dbo.listing_links (listing_id, link_type, label, url, sort_order)
VALUES (@paid, 'website',   'Website',   'https://example.com',           0),
       (@paid, 'instagram', 'Instagram', 'https://example.com/instagram', 1),
       (@paid, 'facebook',  'Facebook',  'https://example.com/facebook',  2),
       (@paid, 'youtube',   'YouTube',   'https://example.com/youtube',   3),
       (@paid, 'x',         'X',         'https://example.com/x',         4);

SET @n = (SELECT COUNT(*) FROM dbo.listing_links WHERE listing_id = @paid);
IF @n <> 5
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: stored ' + CAST(@n AS varchar(10)) + ' links, expected 5';
END
ELSE PRINT 'ok: five links are accepted';

-- 7. A sixth is refused by the range on sort_order, so the cap is the database's and not only the API's.
BEGIN TRY
    INSERT INTO dbo.listing_links (listing_id, link_type, label, url, sort_order)
    VALUES (@paid, 'other', 'Sixth', 'https://example.com/sixth', 5);
    SET @failed = @failed + 1;
    PRINT 'FAIL: a sixth link was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a sixth link is refused by the database';
END CATCH

-- 8. Two links cannot share a slot, which is what stops five rows all sitting at position 0.
BEGIN TRY
    INSERT INTO dbo.listing_links (listing_id, link_type, label, url, sort_order)
    VALUES (@paid, 'other', 'Duplicate slot', 'https://example.com/dup', 0);
    SET @failed = @failed + 1;
    PRINT 'FAIL: two links shared one slot';
END TRY
BEGIN CATCH
    PRINT 'ok: a second link in an occupied slot is refused';
END CATCH

-- 9. A non-http address is refused, so a stored link cannot become a javascript: payload.
BEGIN TRY
    INSERT INTO dbo.listing_links (listing_id, link_type, label, url, sort_order)
    VALUES (@free, 'other', 'Bad scheme', 'javascript:alert(1)', 0);
    SET @failed = @failed + 1;
    PRINT 'FAIL: a javascript: URL was stored';
END TRY
BEGIN CATCH
    PRINT 'ok: a non-http address is refused';
END CATCH

-- 10. An unknown link type is refused.
BEGIN TRY
    INSERT INTO dbo.listing_links (listing_id, link_type, label, url, sort_order)
    VALUES (@free, 'myspace', 'Unknown', 'https://example.com', 1);
    SET @failed = @failed + 1;
    PRINT 'FAIL: an unknown link type was stored';
END TRY
BEGIN CATCH
    PRINT 'ok: an unknown link type is refused';
END CATCH

-- 11. A blank label is refused.
BEGIN TRY
    INSERT INTO dbo.listing_links (listing_id, link_type, label, url, sort_order)
    VALUES (@free, 'website', '   ', 'https://example.com', 2);
    SET @failed = @failed + 1;
    PRINT 'FAIL: a blank label was stored';
END TRY
BEGIN CATCH
    PRINT 'ok: a blank label is refused';
END CATCH

-- 12. One listing cannot hold two active subscriptions at once: renewing extends a period rather
--     than opening a second one.
BEGIN TRY
    INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
    VALUES (@paid, 'verified', 'active', SYSDATETIMEOFFSET(), DATEADD(day, 365, SYSDATETIMEOFFSET()));
    SET @failed = @failed + 1;
    PRINT 'FAIL: a second active subscription was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a listing cannot hold two active subscriptions';
END CATCH

-- 13. A period that ends before it starts is refused, which would otherwise read as permanently
--     active or permanently expired depending on which end a query looked at.
BEGIN TRY
    INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
    VALUES (@free, 'verified', 'cancelled', SYSDATETIMEOFFSET(), DATEADD(day, -1, SYSDATETIMEOFFSET()));
    SET @failed = @failed + 1;
    PRINT 'FAIL: a backwards period was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a period ending before it starts is refused';
END CATCH

-- 14. An unknown plan slug is refused by the foreign key.
BEGIN TRY
    INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
    VALUES (@free, 'platinum', 'active', SYSDATETIMEOFFSET(), DATEADD(day, 365, SYSDATETIMEOFFSET()));
    SET @failed = @failed + 1;
    PRINT 'FAIL: an unknown plan slug was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: an unknown plan slug is refused';
END CATCH

-- 15. Deleting the listing takes its links with it, so a deleted business leaves no orphan links.
DELETE FROM dbo.listings WHERE id = @paid;
SET @n = (SELECT COUNT(*) FROM dbo.listing_links WHERE listing_id = @paid);
IF @n <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: ' + CAST(@n AS varchar(10)) + ' links survived the listing';
END
ELSE PRINT 'ok: links are removed with their listing';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'entitlements follow the clock and the five-link cap is enforced by the database';
GO

ROLLBACK TRANSACTION;
GO
