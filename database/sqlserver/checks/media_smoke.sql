-- Manual smoke test for the plans and listing media added in S0005.
-- It creates its own user, business, listing and media rows, asserts the storage rules, then rolls
-- back, so it leaves no data and is safe to re-run.
--
-- The PostgreSQL original is database/checks/media_smoke.sql, kept as history. What changed:
-- every boolean became a bit, so `WHERE grants_verified_badge` and `WHERE NOT is_hidden` had to
-- become explicit `= 1` and `= 0` comparisons. The dimension-pair rule is the one constraint
-- PostgreSQL got wrong first time (a width with no height evaluated to NULL, which a CHECK
-- accepts), so it is asserted here as well as in constraints_smoke.
--
-- Run:
--   npm run db:check -- media_smoke

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @owner bigint, @business bigint, @listing bigint, @n int;
DECLARE @key nvarchar(400);
DECLARE @locality int, @centre geography, @category int;

SELECT @locality = id, @centre = center FROM localities WHERE slug = 'madhapur';
SELECT @category = id FROM categories WHERE slug = 'cafes';

INSERT INTO users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900401', SYSDATETIMEOFFSET(), 'Smoke Media Owner', 'media-owner@example.com');
SET @owner = SCOPE_IDENTITY();

INSERT INTO businesses (name) VALUES ('Smoke Media Cafe');
SET @business = SCOPE_IDENTITY();
INSERT INTO business_members (business_id, user_id, role) VALUES (@business, @owner, 'owner');

DECLARE @inserted TABLE (id bigint);
INSERT INTO listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
OUTPUT inserted.id INTO @inserted
VALUES (@business, @locality, 'smoke-media-cafe', 'Smoke Media Cafe', @centre, '+919999900401', 'active', @owner);
SET @listing = (SELECT TOP (1) id FROM @inserted);
INSERT INTO listing_categories (listing_id, category_id, category_level, is_primary) VALUES (@listing, @category, 2, 1);

-- 1. A new listing is on the free plan, which costs nothing and includes no media.
IF (SELECT plan_slug FROM listings WHERE id = @listing) <> 'free'
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a new listing should default to the free plan';
END
ELSE PRINT 'ok: a new listing is on the free plan';

IF (SELECT photo_limit + video_limit + logo_limit FROM plans WHERE slug = 'free') <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the free plan should include no media';
END
ELSE PRINT 'ok: the free plan includes no media';

-- 2. Free and Verified plans exist with the approved configuration.
SET @n = (SELECT COUNT(*) FROM plans WHERE slug IN ('free', 'verified'));
IF @n <> 2
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: expected Free and Verified plans, found ' + CAST(@n AS varchar(10));
END
ELSE PRINT 'ok: Free and Verified plans exist';

IF (SELECT price_paise FROM plans WHERE slug = 'verified') <> 39900
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: Verified plan should cost 39900 paise per year';
END
ELSE PRINT 'ok: Verified plan price is 39900 paise';

IF (SELECT photo_limit FROM plans WHERE slug = 'verified') <> 10
   OR (SELECT video_limit FROM plans WHERE slug = 'verified') <> 3
   OR (SELECT grants_verified_badge FROM plans WHERE slug = 'verified') <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: Verified plan allowances or badge configuration are incorrect';
END
ELSE PRINT 'ok: Verified plan allowances and badge configuration are correct';

-- Active plans only. S0009 deactivates the old tiers instead of deleting them and leaves their
-- sort_order alone, so the retired 'basic' still sits at 1 alongside 'verified'. Only the plans
-- the UI actually offers need an unambiguous order.
IF (SELECT COUNT(DISTINCT sort_order) FROM plans WHERE is_active = 1)
   <> (SELECT COUNT(*) FROM plans WHERE is_active = 1)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: two active plans share a sort order';
END
ELSE PRINT 'ok: every active plan has its own sort order';

IF (SELECT grants_verified_badge FROM plans WHERE slug = 'free') <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: Free plan must not grant a badge';
END
ELSE PRINT 'ok: Free plan does not grant a badge';
IF (SELECT grants_verified_badge FROM plans WHERE slug = 'verified') <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: Verified plan must grant the paid-plan badge';
END
ELSE PRINT 'ok: Verified plan grants the paid-plan badge';

-- Again active plans only: the retired tiers were never confirmed and never will be.
IF (SELECT COUNT(*) FROM plans WHERE is_active = 1 AND media_limits_confirmed = 0) <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: an active plan has unconfirmed media limits';
END
ELSE PRINT 'ok: every active plan has confirmed media limits';

-- 5. A listing cannot be put on a plan that does not exist.
BEGIN TRY
    UPDATE listings SET plan_slug = 'platinum' WHERE id = @listing;
    SET @failed = @failed + 1; PRINT 'FAIL: a made-up plan was accepted';
END TRY BEGIN CATCH PRINT 'ok: unknown plan rejected'; END CATCH;

UPDATE listings SET plan_slug = 'verified' WHERE id = @listing;

-- 6. Media rows record what was stored, and the storage key is unique across the whole table:
--    two listings can never end up pointing at the same blob.
SET @key = 'listings/x/photo/aaa.jpg';
INSERT INTO listing_media (listing_id, kind, storage_key, content_type, byte_size, width, height, created_by_user_id)
VALUES (@listing, 'photo', @key, 'image/jpeg', 12345, 800, 600, @owner);

BEGIN TRY
    INSERT INTO listing_media (listing_id, kind, storage_key, content_type, byte_size, created_by_user_id)
    VALUES (@listing, 'photo', @key, 'image/jpeg', 999, @owner);
    SET @failed = @failed + 1; PRINT 'FAIL: the same storage key was accepted twice';
END TRY BEGIN CATCH PRINT 'ok: duplicate storage key rejected'; END CATCH;

-- 7. The constraints refuse rubbish, so a bug in the API cannot store it.
BEGIN TRY
    INSERT INTO listing_media (listing_id, kind, storage_key, content_type, byte_size, created_by_user_id)
    VALUES (@listing, 'banner', 'listings/x/banner/a.jpg', 'image/jpeg', 10, @owner);
    SET @failed = @failed + 1; PRINT 'FAIL: an unknown media kind was accepted';
END TRY BEGIN CATCH PRINT 'ok: unknown kind rejected'; END CATCH;

BEGIN TRY
    INSERT INTO listing_media (listing_id, kind, storage_key, content_type, byte_size, created_by_user_id)
    VALUES (@listing, 'photo', 'listings/x/photo/empty.jpg', 'image/jpeg', 0, @owner);
    SET @failed = @failed + 1; PRINT 'FAIL: an empty file was accepted';
END TRY BEGIN CATCH PRINT 'ok: zero-byte file rejected'; END CATCH;

-- Half a size is no size: either both dimensions are known or neither is.
BEGIN TRY
    INSERT INTO listing_media (listing_id, kind, storage_key, content_type, byte_size, width, created_by_user_id)
    VALUES (@listing, 'photo', 'listings/x/photo/half.jpg', 'image/jpeg', 10, 800, @owner);
    SET @failed = @failed + 1; PRINT 'FAIL: a width without a height was accepted';
END TRY BEGIN CATCH PRINT 'ok: half a dimension pair rejected'; END CATCH;

-- 8. A video legitimately has no dimensions: nothing reads them out of the container yet.
INSERT INTO listing_media (listing_id, kind, storage_key, content_type, byte_size, created_by_user_id)
VALUES (@listing, 'video', 'listings/x/video/clip.mp4', 'video/mp4', 4000000, @owner);
PRINT 'ok: a video with no dimensions is accepted';

-- 9. The quota count is over visible media only, which is what makes a downgrade non-destructive
--    (decision D10): hiding a photo frees the slot without deleting anybody's file.
INSERT INTO listing_media (listing_id, kind, storage_key, content_type, byte_size, is_hidden, created_by_user_id)
VALUES (@listing, 'photo', 'listings/x/photo/hidden.jpg', 'image/jpeg', 2222, 1, @owner);

SET @n = (SELECT COUNT(*) FROM listing_media
          WHERE listing_id = @listing AND kind = 'photo' AND is_hidden = 0);
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: expected 1 visible photo, counted ' + CAST(@n AS varchar(10));
END
ELSE PRINT 'ok: the quota counts visible photos only';

SET @n = (SELECT COUNT(*) FROM listing_media WHERE listing_id = @listing AND kind = 'photo');
IF @n <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the hidden photo should still exist, found ' + CAST(@n AS varchar(10)) + ' photos';
END
ELSE PRINT 'ok: hiding a photo does not delete it';

-- 10. Deleting a listing takes its media rows with it, so nothing is left pointing at a listing
--     that is gone. (Removing the blobs themselves is the API's job.)
DELETE FROM listing_categories WHERE listing_id = @listing;
DELETE FROM listings WHERE id = @listing;
SET @n = (SELECT COUNT(*) FROM listing_media WHERE listing_id = @listing);
IF @n <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: ' + CAST(@n AS varchar(10)) + ' media rows outlived their listing';
END
ELSE PRINT 'ok: media rows do not outlive their listing';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'plan and media rules behaved as expected';
GO

ROLLBACK TRANSACTION;
GO
