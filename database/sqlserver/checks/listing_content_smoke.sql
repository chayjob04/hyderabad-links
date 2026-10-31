-- Manual smoke test for opening hours, FAQs and content sections (S0019, S0020).
--
-- The part no unit test can reach: that the FAQ and content allowances behave the way the media
-- allowance does. A Free listing shows none, a paid one shows up to its limit, and rows beyond the
-- limit are KEPT AND HIDDEN rather than deleted (D10) so a lapsed plan loses nothing.
--
-- It creates its own owner, business and listings, asserts, then rolls back, so it leaves no data
-- and is safe to re-run. Every slug is prefixed `smoke-ct-`.
--
-- As in listing_links_smoke, a paid period is created directly. The rows exist only inside a
-- transaction that is rolled back, so nothing here is ever a real subscription and no payment is
-- implied or recorded.
--
-- Run:
--   npm run db:check -- content

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @owner bigint, @business bigint, @free bigint, @paid bigint;
DECLARE @locality int, @centre geography, @category int;
DECLARE @n int, @limit int, @i int;

SELECT @locality = id, @centre = center FROM dbo.localities WHERE slug = 'madhapur';
SELECT @category = id FROM dbo.categories WHERE slug = 'plumbers';

INSERT INTO dbo.users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900111', SYSDATETIMEOFFSET(), 'Smoke Content Owner', 'content@example.com');
SET @owner = SCOPE_IDENTITY();

INSERT INTO dbo.businesses (name) VALUES ('Smoke Content Business');
SET @business = SCOPE_IDENTITY();
INSERT INTO dbo.business_members (business_id, user_id, role) VALUES (@business, @owner, 'owner');

INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-ct-free', 'Smoke Ct Free', @centre, '+919999900111', 'active', @owner);
SET @free = SCOPE_IDENTITY();

INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-ct-paid', 'Smoke Ct Paid', @centre, '+919999900111', 'active', @owner);
SET @paid = SCOPE_IDENTITY();

INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
VALUES (@paid, 'verified', 'active', DATEADD(day, -1, SYSDATETIMEOFFSET()), DATEADD(month, 12, SYSDATETIMEOFFSET()));

-- ---------------------------------------------------------------- opening hours
-- 1. Hours are not a paid feature: a Free listing can have them.
INSERT INTO dbo.listing_opening_hours (listing_id, day_of_week, opens_at, closes_at)
VALUES (@free, 0, '09:00', '18:00'), (@free, 1, '09:00', '13:00'), (@free, 1, '16:00', '20:00');

SET @n = (SELECT COUNT(*) FROM dbo.listing_opening_hours WHERE listing_id = @free);
IF @n <> 3
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a free listing could not store opening hours';
END
ELSE PRINT 'ok: a free listing can have opening hours, including a split shift';

-- 2. An interval that runs past midnight is accepted; closes_at < opens_at is legitimate.
BEGIN TRY
    INSERT INTO dbo.listing_opening_hours (listing_id, day_of_week, opens_at, closes_at)
    VALUES (@paid, 4, '18:00', '02:00');
    PRINT 'ok: an interval crossing midnight is accepted';
END TRY
BEGIN CATCH
    SET @failed = @failed + 1;
    PRINT 'FAIL: an interval crossing midnight was refused, so late-night businesses cannot be listed';
END CATCH

-- 3. A zero-length interval is refused: it would read as hours set but never open.
BEGIN TRY
    INSERT INTO dbo.listing_opening_hours (listing_id, day_of_week, opens_at, closes_at)
    VALUES (@paid, 5, '09:00', '09:00');
    SET @failed = @failed + 1;
    PRINT 'FAIL: a zero-length opening interval was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a zero-length opening interval is refused';
END CATCH

-- 4. A day outside Monday-Sunday is refused.
BEGIN TRY
    INSERT INTO dbo.listing_opening_hours (listing_id, day_of_week, opens_at, closes_at)
    VALUES (@paid, 9, '09:00', '18:00');
    SET @failed = @failed + 1;
    PRINT 'FAIL: day_of_week 9 was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a day outside 0-6 is refused';
END CATCH

-- ---------------------------------------------------------------- allowances
-- 5. The plan carries the new limits, and Free gets none.
SELECT @limit = faq_limit FROM dbo.plans WHERE slug = 'free';
IF @limit <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the free plan allows FAQs';
END
ELSE PRINT 'ok: the free plan allows no FAQs';

SELECT @limit = faq_limit FROM dbo.plans WHERE slug = 'verified';
IF @limit < 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the verified plan allows no FAQs';
END
ELSE PRINT 'ok: the verified plan allows ' + CAST(@limit AS varchar(10)) + ' FAQs';

-- 6. The entitlements view reports them, which is what the API reads.
IF (SELECT faq_limit FROM dbo.listing_entitlements WHERE listing_id = @free) <> 0
   OR (SELECT faq_limit FROM dbo.listing_entitlements WHERE listing_id = @paid) <> @limit
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: listing_entitlements does not report the FAQ allowance';
END
ELSE PRINT 'ok: entitlements report the FAQ allowance per listing';

-- 7. Write one more FAQ than the plan allows, then check what the public view shows.
SET @i = 0;
WHILE @i < @limit + 2
BEGIN
    INSERT INTO dbo.listing_faqs (listing_id, question, answer, sort_order)
    VALUES (@paid, 'Question ' + CAST(@i AS varchar(10)), 'Answer ' + CAST(@i AS varchar(10)), @i);
    SET @i = @i + 1;
END

SET @n = (SELECT COUNT(*) FROM dbo.listing_faqs WHERE listing_id = @paid);
IF @n <> @limit + 2
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the extra FAQs were not stored';
END
ELSE PRINT 'ok: rows over the allowance are stored, not refused by the database';

SET @n = (SELECT COUNT(*) FROM dbo.listing_visible_faqs WHERE listing_id = @paid);
IF @n <> @limit
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: listing_visible_faqs showed ' + CAST(@n AS varchar(10)) + ', expected ' + CAST(@limit AS varchar(10));
END
ELSE PRINT 'ok: only the allowed FAQs are visible; the rest are kept and hidden';

-- 8. The owner's own ordering decides which survive, not insertion order.
IF EXISTS (SELECT 1 FROM dbo.listing_visible_faqs WHERE listing_id = @paid AND sort_order >= @limit)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a FAQ beyond the allowance is visible';
END
ELSE PRINT 'ok: the lowest sort_order FAQs are the ones kept';

-- 9. A free listing shows none of its FAQs, even though the rows exist.
INSERT INTO dbo.listing_faqs (listing_id, question, answer, sort_order)
VALUES (@free, 'Do you deliver?', 'Yes.', 0);

IF (SELECT COUNT(*) FROM dbo.listing_visible_faqs WHERE listing_id = @free) <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a free listing shows a FAQ';
END
ELSE PRINT 'ok: a free listing shows no FAQs, and the row is still there';

-- 10. THE ONE THAT MATTERS: lapsing hides them; it does not delete them.
UPDATE dbo.subscriptions
SET expires_at = DATEADD(day, -1, SYSDATETIMEOFFSET())
WHERE listing_id = @paid;

IF (SELECT COUNT(*) FROM dbo.listing_visible_faqs WHERE listing_id = @paid) <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a lapsed listing still shows FAQs';
END
ELSE PRINT 'ok: a lapsed plan hides every FAQ at once, with nothing having run';

SET @n = (SELECT COUNT(*) FROM dbo.listing_faqs WHERE listing_id = @paid);
IF @n <> @limit + 2
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: lapsing deleted FAQs';
END
ELSE PRINT 'ok: nothing was deleted, so renewing brings them all back';

-- 11. Renewing does bring them back, which is the other half of the same promise.
UPDATE dbo.subscriptions
SET expires_at = DATEADD(month, 12, SYSDATETIMEOFFSET())
WHERE listing_id = @paid;

IF (SELECT COUNT(*) FROM dbo.listing_visible_faqs WHERE listing_id = @paid) <> @limit
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: renewing did not restore the FAQs';
END
ELSE PRINT 'ok: renewing restores them immediately';

-- 12. Content sections follow exactly the same rule.
SELECT @limit = content_section_limit FROM dbo.plans WHERE slug = 'verified';
SET @i = 0;
WHILE @i < @limit + 1
BEGIN
    INSERT INTO dbo.listing_content_sections (listing_id, heading, body, sort_order)
    VALUES (@paid, 'Heading ' + CAST(@i AS varchar(10)), 'Body text.', @i);
    SET @i = @i + 1;
END

IF (SELECT COUNT(*) FROM dbo.listing_visible_content WHERE listing_id = @paid) <> @limit
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: content sections do not honour the allowance';
END
ELSE PRINT 'ok: content sections honour the allowance the same way';

-- 13. Blank text is refused by the database, not only by the API.
BEGIN TRY
    INSERT INTO dbo.listing_faqs (listing_id, question, answer) VALUES (@paid, '   ', 'Answer');
    SET @failed = @failed + 1;
    PRINT 'FAIL: a blank question was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a blank question is refused';
END CATCH

-- 14. Everything goes with the listing, so a deleted business leaves no orphans.
DELETE FROM dbo.listings WHERE id = @paid;
IF (SELECT COUNT(*) FROM dbo.listing_faqs WHERE listing_id = @paid) <> 0
   OR (SELECT COUNT(*) FROM dbo.listing_content_sections WHERE listing_id = @paid) <> 0
   OR (SELECT COUNT(*) FROM dbo.listing_opening_hours WHERE listing_id = @paid) <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: hours, FAQs or content survived the listing';
END
ELSE PRINT 'ok: hours, FAQs and content are removed with their listing';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'opening hours are free, and FAQs and content follow the plan allowance at read time';
GO

ROLLBACK TRANSACTION;
GO
