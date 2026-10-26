-- Manual smoke test for listing_visible_media (S0012): what a listing may show *now*.
--
-- This is the check that would have caught the bug S0012 fixes. Every public read filtered media on
-- `is_hidden = 0` and nothing else, so a listing whose Verified period had run out kept showing all
-- ten photos, its logo and its videos indefinitely, while its links disappeared correctly. The
-- allowance was enforced on upload and never on display.
--
-- It creates its own owner, business and listings, asserts, then rolls back, so it is safe to
-- re-run. Every slug is prefixed `smoke-mv-`.
--
-- **Nothing here is a payment.** The subscription rows exist only inside a transaction that is
-- rolled back.
--
-- Run:
--   npm run db:check -- media_visibility

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @owner bigint, @business bigint, @paid bigint, @lapsed bigint, @free bigint;
DECLARE @locality int, @centre geography, @category int;
DECLARE @n int, @i int;

SELECT @locality = id, @centre = center FROM dbo.localities WHERE slug = 'madhapur';
SELECT @category = id FROM dbo.categories WHERE slug = 'plumbers';

INSERT INTO dbo.users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900071', SYSDATETIMEOFFSET(), 'Smoke Mv Owner', 'mv@example.com');
SET @owner = SCOPE_IDENTITY();

INSERT INTO dbo.businesses (name) VALUES ('Smoke Mv Business');
SET @business = SCOPE_IDENTITY();
INSERT INTO dbo.business_members (business_id, user_id, role) VALUES (@business, @owner, 'owner');

-- Three listings: paid and current, paid and lapsed, never paid. All three get the same media, so
-- the only thing that differs is the plan period.
INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-mv-paid', 'Smoke Mv Paid', @centre, '+919999900071', 'active', @owner);
SET @paid = SCOPE_IDENTITY();

INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-mv-lapsed', 'Smoke Mv Lapsed', @centre, '+919999900071', 'active', @owner);
SET @lapsed = SCOPE_IDENTITY();

INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-mv-free', 'Smoke Mv Free', @centre, '+919999900071', 'active', @owner);
SET @free = SCOPE_IDENTITY();

INSERT INTO dbo.listing_categories (listing_id, category_id, category_level, is_primary)
SELECT id, @category, 2, 1 FROM dbo.listings WHERE slug LIKE 'smoke-mv-%';

-- A current period on one, an expired one on the next. The expired row keeps status 'active',
-- because nothing has run to tidy it up — that is exactly the state the bug lived in.
INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
VALUES (@paid,   'verified', 'active', DATEADD(day, -1,   SYSDATETIMEOFFSET()), DATEADD(day, 364, SYSDATETIMEOFFSET())),
       (@lapsed, 'verified', 'active', DATEADD(day, -400, SYSDATETIMEOFFSET()), DATEADD(day, -1,  SYSDATETIMEOFFSET()));
UPDATE dbo.listings SET plan_slug = 'verified' WHERE id IN (@paid, @lapsed);

-- The same media on all three: a logo, twelve photos and four videos. Twelve and four are over the
-- Verified allowance (10 and 3) on purpose, so the cap is visible even on a paying listing.
INSERT INTO dbo.listing_media (listing_id, kind, storage_key, content_type, byte_size, width, height, sort_order)
SELECT l.id, 'logo', CONCAT('smoke-mv/', l.id, '/logo'), 'image/png', 1024, 64, 64, 0
FROM dbo.listings l WHERE l.slug LIKE 'smoke-mv-%';

SET @i = 0;
WHILE @i < 12
BEGIN
    INSERT INTO dbo.listing_media (listing_id, kind, storage_key, content_type, byte_size, width, height, sort_order)
    SELECT l.id, 'photo', CONCAT('smoke-mv/', l.id, '/photo-', @i), 'image/jpeg', 2048, 800, 600, @i
    FROM dbo.listings l WHERE l.slug LIKE 'smoke-mv-%';
    SET @i = @i + 1;
END;

SET @i = 0;
WHILE @i < 4
BEGIN
    INSERT INTO dbo.listing_media (listing_id, kind, storage_key, content_type, byte_size, width, height, sort_order)
    SELECT l.id, 'video', CONCAT('smoke-mv/', l.id, '/video-', @i), 'video/mp4', 4096, NULL, NULL, @i
    FROM dbo.listings l WHERE l.slug LIKE 'smoke-mv-%';
    SET @i = @i + 1;
END;

-- 1. The rows really are all there, so the assertions below are about visibility and not about a
--    failed insert.
SET @n = (SELECT COUNT(*) FROM dbo.listing_media WHERE listing_id = @paid);
IF @n <> 17
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: expected 17 media rows, found ' + CAST(@n AS varchar(10));
END
ELSE PRINT 'ok: a logo, twelve photos and four videos are stored';

-- 2. A paying listing shows its logo, ten photos and two videos — the allowance, not everything.
SET @n = (SELECT COUNT(*) FROM dbo.listing_visible_media WHERE listing_id = @paid AND kind = 'photo');
IF @n <> 10
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a Verified listing showed ' + CAST(@n AS varchar(10)) + ' photos, not 10';
END
ELSE PRINT 'ok: a Verified listing shows ten of its twelve photos';

SET @n = (SELECT COUNT(*) FROM dbo.listing_visible_media WHERE listing_id = @paid AND kind = 'video');
IF @n <> 2
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a Verified listing showed ' + CAST(@n AS varchar(10)) + ' videos, not 2';
END
ELSE PRINT 'ok: a Verified listing shows two of its four videos';

SET @n = (SELECT COUNT(*) FROM dbo.listing_visible_media WHERE listing_id = @paid AND kind = 'logo');
IF @n <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a Verified listing showed ' + CAST(@n AS varchar(10)) + ' logos, not 1';
END
ELSE PRINT 'ok: a Verified listing shows its logo';

-- 3. The cap keeps the *oldest* of each kind, so a downgrade is explainable rather than arbitrary.
IF EXISTS (SELECT 1 FROM dbo.listing_visible_media
           WHERE listing_id = @paid AND kind = 'photo' AND sort_order >= 10)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the photo cap did not keep the earliest ten';
END
ELSE PRINT 'ok: the cap keeps the earliest photos, in order';

-- 4. **The bug.** A listing whose period has run out shows nothing at all: the Free plan allows no
--    logo, no photos and no video. Before S0012 this returned all seventeen rows for ever.
SET @n = (SELECT COUNT(*) FROM dbo.listing_visible_media WHERE listing_id = @lapsed);
IF @n <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a lapsed listing still showed ' + CAST(@n AS varchar(10)) + ' media file(s)';
END
ELSE PRINT 'ok: a lapsed listing shows no media, because Free allows none';

-- 5. And a listing that never paid shows nothing either.
SET @n = (SELECT COUNT(*) FROM dbo.listing_visible_media WHERE listing_id = @free);
IF @n <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a Free listing showed ' + CAST(@n AS varchar(10)) + ' media file(s)';
END
ELSE PRINT 'ok: a listing that never paid shows no media';

-- 6. Nothing was deleted or edited to achieve that. The files are all still there for the day the
--    owner renews, which is what "a downgrade never silently deletes media" means.
SET @n = (SELECT COUNT(*) FROM dbo.listing_media WHERE listing_id = @lapsed);
IF @n <> 17
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the lapsed listing lost rows; ' + CAST(@n AS varchar(10)) + ' of 17 remain';
END
ELSE PRINT 'ok: a lapsed listing keeps every file it uploaded';

-- 7. Renewing brings them straight back, with no job and no re-upload.
UPDATE dbo.subscriptions
SET expires_at = DATEADD(day, 364, SYSDATETIMEOFFSET())
WHERE listing_id = @lapsed;

SET @n = (SELECT COUNT(*) FROM dbo.listing_visible_media WHERE listing_id = @lapsed);
IF @n <> 13
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: after renewing, ' + CAST(@n AS varchar(10)) + ' files were visible, not 13';
END
ELSE PRINT 'ok: renewing restores the logo, ten photos and two videos at once';

-- 8. is_hidden still wins. It is a deliberate "do not show this one", which is a different question
--    from how many the plan allows, so the two must both apply.
UPDATE dbo.listing_media SET is_hidden = 1
WHERE listing_id = @lapsed AND kind = 'photo' AND sort_order = 0;

IF EXISTS (SELECT 1 FROM dbo.listing_visible_media
           WHERE listing_id = @lapsed AND kind = 'photo' AND sort_order = 0)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a hidden photo was still visible';
END
ELSE PRINT 'ok: a hidden file stays hidden whatever the plan allows';

-- 9. Hiding one promotes the next into the allowance rather than leaving a gap, so the count holds.
SET @n = (SELECT COUNT(*) FROM dbo.listing_visible_media WHERE listing_id = @lapsed AND kind = 'photo');
IF @n <> 10
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: hiding one photo left ' + CAST(@n AS varchar(10)) + ' visible, not 10';
END
ELSE PRINT 'ok: hiding a file lets the next one into the allowance';

-- 10. Media dies with its listing, as before.
DELETE FROM dbo.listings WHERE id = @free;
SET @n = (SELECT COUNT(*) FROM dbo.listing_media WHERE listing_id = @free);
IF @n <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: media survived its listing';
END
ELSE PRINT 'ok: media is removed with its listing';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'what a listing may show follows the plan and the clock, and nothing is ever deleted';
GO

ROLLBACK TRANSACTION;
GO
