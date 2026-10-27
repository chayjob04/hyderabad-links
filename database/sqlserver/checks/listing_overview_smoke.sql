-- Manual smoke test for dbo.listing_overview (S0018).
--
-- The requirement was "one row per listing, no duplicates". Counting rows on today's data proves
-- very little, because today's data may not contain the shape that breaks it. So this check builds
-- that shape on purpose: a business with an owner AND two managers, which under a plain join to
-- business_members would return the same listing three times.
--
-- It also checks the other direction — that a listing with no owner, no category and no
-- subscription still appears, with nulls rather than being dropped — because an overview that
-- silently omits the broken records is worse than no overview at all. Those are precisely the rows
-- someone would open this view to find.
--
-- It creates its own rows, asserts, then rolls back, so it leaves no data and is safe to re-run.
-- Every slug is prefixed `smoke-ov-` so it cannot collide with another check.
--
-- Run:
--   npm run db:check -- overview

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @owner bigint, @manager1 bigint, @manager2 bigint, @orphanUser bigint;
DECLARE @business bigint, @bare bigint;
DECLARE @crowded bigint, @lonely bigint;
DECLARE @locality int, @centre geography, @category int;
DECLARE @n int, @before bigint, @after bigint;
DECLARE @reportedOwner bigint, @url nvarchar(400), @verified bit, @plan varchar(60);

SELECT @locality = id, @centre = center FROM dbo.localities WHERE slug = 'madhapur';
SELECT @category = id FROM dbo.categories WHERE slug = 'plumbers';

SET @before = (SELECT COUNT_BIG(*) FROM dbo.listing_overview);

-- Three people on one business: one owner, two managers.
INSERT INTO dbo.users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900101', SYSDATETIMEOFFSET(), 'Smoke Ov Owner', 'ov-owner@example.com');
SET @owner = SCOPE_IDENTITY();
INSERT INTO dbo.users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900102', SYSDATETIMEOFFSET(), 'Smoke Ov Manager One', 'ov-m1@example.com');
SET @manager1 = SCOPE_IDENTITY();
INSERT INTO dbo.users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900103', SYSDATETIMEOFFSET(), 'Smoke Ov Manager Two', 'ov-m2@example.com');
SET @manager2 = SCOPE_IDENTITY();

INSERT INTO dbo.businesses (name) VALUES ('Smoke Ov Business');
SET @business = SCOPE_IDENTITY();
/* created_at is set explicitly and out of order, so "oldest owner wins" is actually exercised
   rather than coinciding with insert order. */
INSERT INTO dbo.business_members (business_id, user_id, role, created_at)
VALUES (@business, @manager1, 'manager', DATEADD(day, -9, SYSDATETIMEOFFSET())),
       (@business, @owner,    'owner',   DATEADD(day, -5, SYSDATETIMEOFFSET())),
       (@business, @manager2, 'manager', DATEADD(day, -1, SYSDATETIMEOFFSET()));

INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-ov-crowded', 'Smoke Ov Crowded', @centre, '+919999900101', 'active', @owner);
SET @crowded = SCOPE_IDENTITY();
INSERT INTO dbo.listing_categories (listing_id, category_id, is_primary) VALUES (@crowded, @category, 1);

-- A business with no members at all, and a listing with no category.
INSERT INTO dbo.businesses (name) VALUES ('Smoke Ov Bare Business');
SET @bare = SCOPE_IDENTITY();
INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status)
VALUES (@bare, @locality, 'smoke-ov-lonely', 'Smoke Ov Lonely', @centre, '+919999900104', 'draft');
SET @lonely = SCOPE_IDENTITY();

-- 1. THE POINT OF THIS CHECK: three members, still one row.
SET @n = (SELECT COUNT(*) FROM dbo.listing_overview WHERE listing_id = @crowded);
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a listing whose business has three members returned ' + CAST(@n AS varchar(10)) + ' rows';
END
ELSE PRINT 'ok: several members on a business still produce one row';

-- 2. And the owner reported is the owner, not whichever member sorted first.
SELECT @reportedOwner = owner_user_id FROM dbo.listing_overview WHERE listing_id = @crowded;
IF @reportedOwner <> @owner
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a manager was reported as the owner';
END
ELSE PRINT 'ok: the owner is reported, not a manager';

-- 3. A listing with no members at all is still present, with a null owner.
SET @n = (SELECT COUNT(*) FROM dbo.listing_overview WHERE listing_id = @lonely);
IF @n <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: an unowned listing is missing from the overview';
END
ELSE PRINT 'ok: an unowned listing still appears';

IF (SELECT owner_user_id FROM dbo.listing_overview WHERE listing_id = @lonely) IS NOT NULL
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: an unowned listing reported an owner';
END
ELSE PRINT 'ok: an unowned listing reports a null owner';

-- 4. No category means no public URL, rather than a half-built path.
SELECT @url = public_url FROM dbo.listing_overview WHERE listing_id = @lonely;
IF @url IS NOT NULL
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a listing with no category produced a URL: ' + @url;
END
ELSE PRINT 'ok: no category means no public URL';

-- 5. A categorised listing gets the /parent/category/slug shape PublicUrl.cs builds.
SELECT @url = public_url FROM dbo.listing_overview WHERE listing_id = @crowded;
IF @url IS NULL OR @url NOT LIKE '/%/%/smoke-ov-crowded'
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the public URL is not /parent/category/slug: ' + ISNULL(@url, '(null)');
END
ELSE PRINT 'ok: the public URL is /parent/category/slug';

-- 6. With no subscription, the overview agrees with the entitlements view: Free, not verified.
SELECT @verified = is_verified, @plan = plan_slug FROM dbo.listing_overview WHERE listing_id = @crowded;
IF @verified <> 0 OR @plan <> 'free'
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: an unpaid listing is not reported as free';
END
ELSE PRINT 'ok: an unpaid listing reads as free';

-- 7. Pay for it, and the overview flips with nothing having run in between.
INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
VALUES (@crowded, 'verified', 'active',
        DATEADD(day, -1, SYSDATETIMEOFFSET()), DATEADD(month, 12, SYSDATETIMEOFFSET()));

SELECT @verified = is_verified, @plan = plan_slug FROM dbo.listing_overview WHERE listing_id = @crowded;
IF @verified <> 1 OR @plan <> 'verified'
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a paid listing is not reported as verified';
END
ELSE PRINT 'ok: a paid listing reads as verified, at read time';

IF (SELECT photo_limit FROM dbo.listing_overview WHERE listing_id = @crowded) <> 10
   OR (SELECT video_limit FROM dbo.listing_overview WHERE listing_id = @crowded) <> 2
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the paid allowances are not 10 photos and 2 videos';
END
ELSE PRINT 'ok: the paid allowances come through as 10 photos and 2 videos';

-- 8. And still exactly one row, now that it has a subscription as well as three members.
SET @n = (SELECT COUNT(*) FROM dbo.listing_overview WHERE listing_id = @crowded);
IF @n <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a subscribed listing returned ' + CAST(@n AS varchar(10)) + ' rows';
END
ELSE PRINT 'ok: a subscribed listing is still one row';

-- 9. The whole-table guarantee: the view has grown by exactly the two listings added.
SET @after = (SELECT COUNT_BIG(*) FROM dbo.listing_overview);
IF @after - @before <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the view grew by ' + CAST(@after - @before AS varchar(20)) + ' rows, not 2';
END
ELSE PRINT 'ok: the view grew by exactly the two listings added';

-- 10. And matches the listings table overall, which is the migration's own assertion re-checked
-- against rows that were designed to break it.
IF (SELECT COUNT_BIG(*) FROM dbo.listing_overview) <> (SELECT COUNT_BIG(*) FROM dbo.listings)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the view and the listings table disagree on how many listings exist';
END
ELSE PRINT 'ok: one row per listing, across the whole table';

-- 11. The three queries this view exists for add up: verified + free = all.
IF (SELECT COUNT_BIG(*) FROM dbo.listing_overview WHERE is_verified = 1)
   + (SELECT COUNT_BIG(*) FROM dbo.listing_overview WHERE is_verified = 0)
   <> (SELECT COUNT_BIG(*) FROM dbo.listing_overview)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: verified and free do not add up to every listing';
END
ELSE PRINT 'ok: verified plus free is every listing';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'listing_overview returns one row per listing, with the right owner, URL and plan';
GO

ROLLBACK TRANSACTION;
GO
