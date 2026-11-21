-- Manual smoke test for the Verified plan's entitlements and the website/social links
-- (S0009, as changed by S0029).
--
-- The point that matters is that expiry is a comparison against the clock and the subscription's
-- status, not a stored flag: listing_entitlements must report a listing as Verified while an active
-- period covers now, and as Free the moment either of those stops being true -- a run-out period or
-- a cancelled one -- with no job having run in between. All four states are covered: never paid,
-- paid and current, lapsed, and cancelled with months still on the clock.
--
-- **S0029 changed what the plan sells here.** Links are unlimited on every plan, so `link_limit` is
-- NULL for everybody and the old five-slot CHECK is gone; what the paid plan buys is *naming* them.
-- Several assertions below are therefore the inverse of what they were: a sixth link must now be
-- accepted, and two links may share a position. If they start failing, the cap has come back.
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
DECLARE @owner bigint, @business bigint, @free bigint, @paid bigint, @lapsed bigint, @cancelled bigint;
DECLARE @renamed nvarchar(80), @slotBefore int, @slotAfter int;
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

/* And a link it named while that period was still running. The database cannot tell when a label
   was written -- nothing stores that, and no constraint refers to the subscription -- so this row
   simply *is* a name saved under Verified. Who may write one is the API's rule, enforced in
   OwnerLinkEndpoints and asserted in the unit tests; what this fixture exists for is assertion 17,
   which checks that lapsing does not take the name away. Without it that assertion was checking an
   empty set and failing on its own missing fixture. */
INSERT INTO dbo.listing_links (listing_id, link_type, label, url, sort_order)
VALUES (@lapsed, 'website', 'Book a table', 'https://example.com/lapsed-booking', 0);

/* A fourth listing, for the state the other three do not cover: a subscription that was
   cancelled rather than left to run out. Its period is still in the future, so only `status` tells
   the view it is over -- which is the half of the rule that a clock comparison alone would miss. */
INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-lk-cancelled', 'Smoke Lk Cancelled', @centre, '+919999900081', 'active', @owner);
SET @cancelled = SCOPE_IDENTITY();

INSERT INTO dbo.listing_categories (listing_id, category_id, category_level, is_primary)
VALUES (@cancelled, @category, 2, 1);

INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
VALUES (@cancelled, 'verified', 'cancelled', DATEADD(day, -30, SYSDATETIMEOFFSET()), DATEADD(day, 335, SYSDATETIMEOFFSET()));
UPDATE dbo.listings SET plan_slug = 'verified' WHERE id = @cancelled;

-- 1. A listing that never paid is Free and unverified -- and since S0029 it has no *limit* on
--    links, because no plan does. NULL is how the view says "no limit"; a number here would mean
--    the allowance had been reintroduced.
SELECT @plan = effective_plan_slug, @limit = link_limit, @verified = is_verified
FROM dbo.listing_entitlements WHERE listing_id = @free;
IF @plan <> 'free' OR @limit IS NOT NULL OR @verified <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: free listing read as ' + @plan + ', link_limit ' + ISNULL(CAST(@limit AS varchar(10)), 'NULL');
END
ELSE PRINT 'ok: a listing with no subscription is free and unverified, with links unlimited';

-- 2. A current period makes it Verified. Links are unlimited here too: what the paid plan buys is
--    naming them, which is the API's rule rather than this view's.
SELECT @plan = effective_plan_slug, @limit = link_limit, @verified = is_verified
FROM dbo.listing_entitlements WHERE listing_id = @paid;
IF @plan <> 'verified' OR @limit IS NOT NULL OR @verified <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: paid listing read as ' + @plan + ', link_limit ' + ISNULL(CAST(@limit AS varchar(10)), 'NULL');
END
ELSE PRINT 'ok: a current subscription grants the badge, with links unlimited on both plans';

-- 3. The paid listing also gets the Verified media allowance, which S0029 made 5 photos, 1 video
--    and 1 logo.
SELECT @n = photo_limit FROM dbo.listing_entitlements WHERE listing_id = @paid;
IF @n <> 5
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: paid photo_limit was ' + CAST(@n AS varchar(10)) + ', expected 5';
END
ELSE PRINT 'ok: the paid listing gets five photo slots';

SELECT @n = video_limit FROM dbo.listing_entitlements WHERE listing_id = @paid;
IF @n <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: paid video_limit was ' + CAST(@n AS varchar(10)) + ', expected 1';
END
ELSE PRINT 'ok: the paid listing gets one video slot';

-- 4. The expired period reads as Free again, with no job having run. This is the assertion the
--    whole design exists for: a missed background task cannot leave a badge up for free.
SELECT @plan = effective_plan_slug, @limit = link_limit, @verified = is_verified
FROM dbo.listing_entitlements WHERE listing_id = @lapsed;
IF @plan <> 'free' OR @limit IS NOT NULL OR @verified <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: lapsed listing read as ' + @plan + ', link_limit ' + ISNULL(CAST(@limit AS varchar(10)), 'NULL');
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
ELSE PRINT 'ok: the first five links are accepted';

-- 7. A sixth, seventh and eighth are accepted. This assertion is the inverse of what it was
--    before S0029: the range on sort_order was what capped links at five, and dropping it is what
--    makes them unlimited. If this starts failing, the constraint has come back.
INSERT INTO dbo.listing_links (listing_id, link_type, label, url, sort_order)
VALUES (@paid, 'other', 'Sixth',   'https://example.com/sixth',   5),
       (@paid, 'other', 'Seventh', 'https://example.com/seventh', 6),
       (@paid, 'other', 'Eighth',  'https://example.com/eighth',  7);

SET @n = (SELECT COUNT(*) FROM dbo.listing_links WHERE listing_id = @paid);
IF @n <> 8
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: stored ' + CAST(@n AS varchar(10)) + ' links, expected 8';
END
ELSE PRINT 'ok: links past the old five-slot cap are accepted';

-- 8. The slot is no longer unique either: the unique index went with the range, because an
--    unbounded list cannot be keyed on a fixed set of positions. The API assigns MAX + 1, so a
--    duplicate should not arise in practice; this only proves the database no longer refuses one,
--    which is what replacing the unique index with a plain ordering index means.
BEGIN TRY
    INSERT INTO dbo.listing_links (listing_id, link_type, label, url, sort_order)
    VALUES (@paid, 'other', 'Same slot as the first', 'https://example.com/dup', 0);
    PRINT 'ok: the slot is an ordering position now, not a unique key';
END TRY
BEGIN CATCH
    SET @failed = @failed + 1;
    PRINT 'FAIL: a second link at an occupied slot was refused; the unique slot index is still there';
END CATCH

-- 8b. Still bounded below, by the constraint S0029 put in place of the range.
BEGIN TRY
    INSERT INTO dbo.listing_links (listing_id, link_type, label, url, sort_order)
    VALUES (@paid, 'other', 'Negative slot', 'https://example.com/neg', -1);
    SET @failed = @failed + 1;
    PRINT 'FAIL: a negative sort_order was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a negative sort_order is still refused';
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

-- 15. A cancelled subscription is over even though its period has not run out. The view reads
--     `status = 'active'` as well as the clock, and this is the only check that proves the first
--     half: a listing whose expires_at is still months away but whose row was cancelled must be
--     free, unverified, and unable to name its links.
SELECT @plan = effective_plan_slug, @verified = is_verified, @limit = link_limit
FROM dbo.listing_entitlements WHERE listing_id = @cancelled;
IF @plan <> 'free' OR @verified <> 0 OR @limit IS NOT NULL
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a cancelled subscription still read as ' + @plan
        + ', verified ' + CAST(@verified AS varchar(1));
END
ELSE PRINT 'ok: a cancelled subscription reads as free at once, whatever its expiry says';

-- 15b. And it still remembers what it bought, so the owner can be told rather than just demoted.
SELECT @plan = subscribed_plan_slug FROM dbo.listing_entitlements WHERE listing_id = @cancelled;
IF @plan <> 'verified'
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: cancelled subscribed_plan_slug was ' + @plan;
END
ELSE PRINT 'ok: a cancelled listing still records the plan it had bought';

-- 16. Renaming a link changes its name and nothing else. This is the UPDATE the API's rename route
--     runs, and the assertion is about what it must NOT touch: a rename that moved a link would
--     reorder somebody's public page.
SELECT TOP (1) @slotBefore = sort_order FROM dbo.listing_links
WHERE listing_id = @free ORDER BY sort_order, id;

UPDATE l SET l.label = 'Our menu', l.updated_at = SYSDATETIMEOFFSET()
FROM dbo.listing_links l
WHERE l.id = (SELECT TOP (1) id FROM dbo.listing_links WHERE listing_id = @free ORDER BY sort_order, id);

SELECT TOP (1) @renamed = label, @slotAfter = sort_order FROM dbo.listing_links
WHERE listing_id = @free ORDER BY sort_order, id;

IF @renamed <> 'Our menu' OR @slotAfter <> @slotBefore
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: renaming changed the slot (' + CAST(@slotBefore AS varchar(10))
        + ' -> ' + CAST(@slotAfter AS varchar(10)) + ') or did not change the name';
END
ELSE PRINT 'ok: renaming a link changes its name and leaves its position alone';

/* 17. A name saved under Verified survives a lapse. The API stops *publishing* it -- an unpaid
       listing's links read as their position, which is asserted in the unit tests because it is a
       projection rather than a stored value -- but the row keeps what the owner wrote, so renewing
       brings it back. Deleting it would be destroying their work.

       Read-only on purpose. This used to overwrite every label and then check the overwrite had
       worked, which proved only that UPDATE works: it wrote the name *after* the lapse rather than
       reading one written before it, so it could not have detected the row losing its name. The
       label below is the one the fixture saved while the period was still running, and nothing
       between there and here has touched it. */
IF NOT EXISTS (
    SELECT 1 FROM dbo.listing_links
    WHERE listing_id = @lapsed AND label = 'Book a table')
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a lapsed listing did not keep its saved link names; found '
        + ISNULL((SELECT TOP (1) label FROM dbo.listing_links WHERE listing_id = @lapsed), 'no links at all');
END
ELSE PRINT 'ok: a lapsed listing keeps the names it chose, ready for renewal';

/* 18. The two columns S0020 added are still on the view. S0029 replaces it wholesale, and the
       first draft of that script re-stated it from S0009 and so dropped both -- which would have
       broken the owner's About & FAQs screen and both staff content screens from a migration about
       plans and links. This is the assertion that would have caught it. */
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.listing_entitlements') AND name = 'faq_limit')
   OR NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.listing_entitlements') AND name = 'content_section_limit')
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: listing_entitlements has lost faq_limit or content_section_limit';
END
ELSE PRINT 'ok: the entitlement view still reports the FAQ and content allowances';

-- 18b. And they still answer, which is what the FAQ and content screens actually select.
IF NOT EXISTS (
    SELECT 1 FROM dbo.listing_entitlements e
    JOIN dbo.plans p ON p.slug = e.effective_plan_slug
    WHERE e.listing_id = @paid AND e.faq_limit = p.faq_limit
      AND e.content_section_limit = p.content_section_limit)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the FAQ or content allowance does not match the plan row';
END
ELSE PRINT 'ok: the FAQ and content allowances match the plan they come from';

-- 19. Deleting the listing takes its links with it, so a deleted business leaves no orphan links.
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
PRINT 'entitlements follow the clock and the status, links are unlimited, and renaming moves nothing';
GO

ROLLBACK TRANSACTION;
GO
