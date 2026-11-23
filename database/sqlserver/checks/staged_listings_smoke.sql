-- Manual smoke test for S0034: a whole listing can be staged, and a staged one can never be public.
-- The transactional part inserts, asserts, and rolls back, so it leaves no data and is safe to re-run.
--
-- What belongs here rather than in the .NET suite is everything the database itself enforces. The
-- whole design rests on three rules, and two of them are constraints:
--
--   * a staged listing may never hold the status every public query requires;
--   * a published listing has at most one staged copy, and an owner at most one unsaved new listing;
--   * a staged listing's entitlement comes from the listing it stands in for.
--
-- The third is a view, and it is the one that would be noticed last: without it a staged copy of a
-- Verified listing reads as Free, and its owner is told the photos they already have are a paid
-- feature.
--
-- Run:
--   npm run db:check -- staged_listings
--
-- NOTE, honestly: this file has never been executed. There is no SQL Server available outside
-- production in this environment, so it was written alongside the migration and is the first thing
-- to run once S0034 has been applied to a database somebody can afford to break.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

IF COL_LENGTH('dbo.listings', 'staged_for_listing_id') IS NULL
BEGIN
    PRINT 'FAIL: dbo.listings has no staged_for_listing_id, so S0034 has not run';
    THROW 51040, 'S0034 has not been applied.', 1;
END;
PRINT 'ok: the staging columns exist';
GO

-- S0031's table should be gone: two staging mechanisms is the one outcome worth avoiding.
IF OBJECT_ID('dbo.listing_pending_changes', 'U') IS NOT NULL
BEGIN
    PRINT 'FAIL: dbo.listing_pending_changes still exists alongside staged listings';
    THROW 51041, 'Two staging mechanisms are present.', 1;
END;
PRINT 'ok: the superseded staging table is gone';
GO

-- Nothing staged is public, and nothing staged is itself staged for a staged row.
IF EXISTS (SELECT 1 FROM dbo.listings WHERE staged_for_listing_id IS NOT NULL AND status = 'active')
BEGIN
    PRINT 'FAIL: a staged listing is active, so it is being served publicly';
    THROW 51042, 'A staged listing is active.', 1;
END;
PRINT 'ok: no staged listing is active';

IF EXISTS (
    SELECT 1 FROM dbo.listings s
    JOIN dbo.listings p ON p.id = s.staged_for_listing_id
    WHERE p.staged_for_listing_id IS NOT NULL)
BEGIN
    PRINT 'FAIL: a staged listing stands in for another staged listing';
    THROW 51043, 'Staged listings are chained.', 1;
END;
PRINT 'ok: no chains of staged listings';
GO

DECLARE @failed int = 0;
BEGIN TRANSACTION;

DECLARE @owner bigint, @business bigint, @locality int, @centre geography;
DECLARE @published bigint, @staged bigint, @category int, @other int, @admin bigint;

SELECT @locality = id, @centre = center FROM dbo.localities WHERE slug = 'madhapur';
SELECT TOP (1) @category = id FROM dbo.categories WHERE level = 2 ORDER BY id;
SELECT TOP (1) @other = id FROM dbo.categories WHERE level = 2 AND id <> @category ORDER BY id;
SELECT TOP (1) @admin = id FROM dbo.admin_users ORDER BY id;

INSERT INTO dbo.users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900911', SYSDATETIMEOFFSET(), 'Smoke Staged Owner', 'staged@example.com');
SET @owner = SCOPE_IDENTITY();

INSERT INTO dbo.businesses (name) VALUES ('Smoke Staged Business');
SET @business = SCOPE_IDENTITY();
INSERT INTO dbo.business_members (business_id, user_id, role) VALUES (@business, @owner, 'owner');

INSERT INTO dbo.listings (business_id, locality_id, slug, name, description, address_line,
                          location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-staged-live', 'Smoke Staged Live',
        'A published listing whose owner is about to edit every section of it.', 'Plot 1, Madhapur',
        @centre, '+919999900911', 'active', @owner);
SET @published = SCOPE_IDENTITY();

INSERT INTO dbo.listing_categories (listing_id, category_id, is_primary) VALUES (@published, @category, 1);
INSERT INTO dbo.listing_media (listing_id, kind, storage_key, content_type, byte_size, sort_order)
VALUES (@published, 'photo', N'smoke/staged/one.jpg', 'image/jpeg', 1000, 0),
       (@published, 'photo', N'smoke/staged/two.jpg', 'image/jpeg', 1000, 1);
INSERT INTO dbo.listing_opening_hours (listing_id, day_of_week, opens_at, closes_at)
VALUES (@published, 0, '09:00', '18:00');
INSERT INTO dbo.listing_faqs (listing_id, question, answer, sort_order)
VALUES (@published, N'Is there parking?', N'Yes, for four cars.', 0);
INSERT INTO dbo.listing_content_sections (listing_id, heading, body, sort_order)
VALUES (@published, N'About us', N'Open since 2009.', 0);
INSERT INTO dbo.listing_attributes (listing_id, kind, label, sort_order)
VALUES (@published, 'amenity', N'Wi-Fi', 0);
INSERT INTO dbo.listing_links (listing_id, link_type, label, url, sort_order)
VALUES (@published, 'website', N'Our website', N'https://example.com', 0);

-- ------------------------------------------------------------------ taking the copy
INSERT INTO dbo.listings (business_id, locality_id, slug, name, description, address_line,
                          location, phone_primary, status, created_by_user_id, staged_for_listing_id)
SELECT business_id, locality_id, 'smoke-staged-copy', name, description, address_line,
       location, phone_primary, 'draft', @owner, id
FROM dbo.listings WHERE id = @published;
SET @staged = SCOPE_IDENTITY();

INSERT INTO dbo.listing_categories (listing_id, category_id, category_level, is_primary)
SELECT @staged, category_id, category_level, is_primary FROM dbo.listing_categories WHERE listing_id = @published;
INSERT INTO dbo.listing_media (listing_id, kind, storage_key, content_type, byte_size, width, height, sort_order, is_hidden)
SELECT @staged, kind, storage_key, content_type, byte_size, width, height, sort_order, is_hidden
FROM dbo.listing_media WHERE listing_id = @published;
INSERT INTO dbo.listing_opening_hours (listing_id, day_of_week, opens_at, closes_at)
SELECT @staged, day_of_week, opens_at, closes_at FROM dbo.listing_opening_hours WHERE listing_id = @published;
INSERT INTO dbo.listing_faqs (listing_id, question, answer, sort_order)
SELECT @staged, question, answer, sort_order FROM dbo.listing_faqs WHERE listing_id = @published;
INSERT INTO dbo.listing_content_sections (listing_id, heading, body, sort_order)
SELECT @staged, heading, body, sort_order FROM dbo.listing_content_sections WHERE listing_id = @published;
INSERT INTO dbo.listing_attributes (listing_id, kind, label, sort_order)
SELECT @staged, kind, label, sort_order FROM dbo.listing_attributes WHERE listing_id = @published;
INSERT INTO dbo.listing_links (listing_id, link_type, label, url, sort_order)
SELECT @staged, link_type, label, url, sort_order FROM dbo.listing_links WHERE listing_id = @published;

PRINT 'ok: a complete copy of a published listing can be staged';

-- 1. The copy is not public, and cannot be made public while it is a copy.
BEGIN TRY
    UPDATE dbo.listings SET status = 'active' WHERE id = @staged;
    SET @failed = @failed + 1;
    PRINT 'FAIL: a staged listing was made active';
END TRY
BEGIN CATCH
    PRINT 'ok: a staged listing cannot be made active';
END CATCH

-- 2. One copy per listing. A second is the same edit, not another proposal.
BEGIN TRY
    INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary,
                              status, created_by_user_id, staged_for_listing_id)
    VALUES (@business, @locality, 'smoke-staged-copy-two', N'Second Copy', @centre, '+919999900911',
            'draft', @owner, @published);
    SET @failed = @failed + 1;
    PRINT 'FAIL: a second staged copy was accepted for the same listing';
END TRY
BEGIN CATCH
    PRINT 'ok: a listing has at most one staged copy';
END CATCH

-- 3. The copy inherits the plan. Without this a staged copy of a Verified listing reads as Free.
DECLARE @paidPlan nvarchar(50) = (SELECT TOP (1) slug FROM dbo.plans WHERE grants_verified_badge = 1 ORDER BY slug);

IF @paidPlan IS NULL
    PRINT 'SKIP: no paid plan in this database, so entitlement inheritance is not checked';
ELSE
BEGIN
    INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
    VALUES (@published, @paidPlan, 'active', DATEADD(day, -1, SYSDATETIMEOFFSET()), DATEADD(month, 12, SYSDATETIMEOFFSET()));

    IF (SELECT is_verified FROM dbo.listing_entitlements WHERE listing_id = @staged) <> 1
       OR (SELECT effective_plan_slug FROM dbo.listing_entitlements WHERE listing_id = @staged) <> @paidPlan
    BEGIN
        SET @failed = @failed + 1;
        PRINT 'FAIL: a staged copy does not inherit the plan of the listing it stands in for';
    END
    ELSE PRINT 'ok: a staged copy inherits its parent''s plan';

    /* And the plan is not counted twice: the subscription belongs to the published listing, and the
       report excludes staged rows. Asserted here because the view is what makes the inheritance
       work, and "inherits" must not mean "has one of its own". */
    IF (SELECT COUNT_BIG(*) FROM dbo.subscriptions WHERE listing_id = @staged) <> 0
    BEGIN
        SET @failed = @failed + 1;
        PRINT 'FAIL: the staged copy has a subscription row of its own';
    END
    ELSE PRINT 'ok: the staged copy has no subscription of its own';
END

-- 4. Editing the copy changes nothing about the published listing or any of its sections.
UPDATE dbo.listings SET name = N'Smoke Staged Renamed', description = N'A new description nobody has approved.'
WHERE id = @staged;
DELETE FROM dbo.listing_media WHERE listing_id = @staged AND storage_key = N'smoke/staged/two.jpg';
INSERT INTO dbo.listing_media (listing_id, kind, storage_key, content_type, byte_size, sort_order)
VALUES (@staged, 'photo', N'smoke/staged/three.jpg', 'image/jpeg', 1000, 2);
DELETE FROM dbo.listing_opening_hours WHERE listing_id = @staged;
INSERT INTO dbo.listing_faqs (listing_id, question, answer, sort_order)
VALUES (@staged, N'Do you deliver?', N'Within three kilometres.', 1);
DELETE FROM dbo.listing_links WHERE listing_id = @staged;

IF (SELECT name FROM dbo.listings WHERE id = @published) <> N'Smoke Staged Live'
   OR (SELECT COUNT_BIG(*) FROM dbo.listing_media WHERE listing_id = @published) <> 2
   OR (SELECT COUNT_BIG(*) FROM dbo.listing_opening_hours WHERE listing_id = @published) <> 1
   OR (SELECT COUNT_BIG(*) FROM dbo.listing_faqs WHERE listing_id = @published) <> 1
   OR (SELECT COUNT_BIG(*) FROM dbo.listing_links WHERE listing_id = @published) <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: editing the staged copy changed the published listing';
END
ELSE PRINT 'ok: every section of the published listing is untouched while the copy is edited';

-- 5. The photo both rows share is still referenced by the published row, so its file is not
--    nobody's. This is the rule the media delete depends on.
IF (SELECT COUNT_BIG(*) FROM dbo.listing_media WHERE storage_key = N'smoke/staged/two.jpg') <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: removing a copied photo from the staged listing lost the published row too';
END
ELSE PRINT 'ok: a photo dropped from the copy is still the published listing''s';

-- ------------------------------------------------------------------ approving
-- 6. Approval replaces every section at once and leaves the listing on the site.
DELETE FROM dbo.listing_categories WHERE listing_id = @published;
DELETE FROM dbo.listing_media WHERE listing_id = @published;
DELETE FROM dbo.listing_opening_hours WHERE listing_id = @published;
DELETE FROM dbo.listing_faqs WHERE listing_id = @published;
DELETE FROM dbo.listing_content_sections WHERE listing_id = @published;
DELETE FROM dbo.listing_attributes WHERE listing_id = @published;
DELETE FROM dbo.listing_links WHERE listing_id = @published;

UPDATE dbo.listing_categories SET listing_id = @published WHERE listing_id = @staged;
UPDATE dbo.listing_media SET listing_id = @published WHERE listing_id = @staged;
UPDATE dbo.listing_opening_hours SET listing_id = @published WHERE listing_id = @staged;
UPDATE dbo.listing_faqs SET listing_id = @published WHERE listing_id = @staged;
UPDATE dbo.listing_content_sections SET listing_id = @published WHERE listing_id = @staged;
UPDATE dbo.listing_attributes SET listing_id = @published WHERE listing_id = @staged;
UPDATE dbo.listing_links SET listing_id = @published WHERE listing_id = @staged;

UPDATE published
SET name = staged.name, description = staged.description, review_note = NULL,
    updated_at = SYSDATETIMEOFFSET()
FROM dbo.listings published
JOIN dbo.listings staged ON staged.id = @staged
WHERE published.id = @published;

DELETE FROM dbo.listings WHERE id = @staged;

IF (SELECT name FROM dbo.listings WHERE id = @published) <> N'Smoke Staged Renamed'
   OR (SELECT status FROM dbo.listings WHERE id = @published) <> 'active'
   OR (SELECT COUNT_BIG(*) FROM dbo.listing_media WHERE listing_id = @published) <> 2
   OR (SELECT COUNT_BIG(*) FROM dbo.listing_opening_hours WHERE listing_id = @published) <> 0
   OR (SELECT COUNT_BIG(*) FROM dbo.listing_faqs WHERE listing_id = @published) <> 2
   OR (SELECT COUNT_BIG(*) FROM dbo.listing_links WHERE listing_id = @published) <> 0
   OR EXISTS (SELECT 1 FROM dbo.listings WHERE staged_for_listing_id = @published)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: approving did not publish every section and clear the staged copy';
END
ELSE PRINT 'ok: approving publishes every section at once, keeps the listing live, and clears the copy';

-- ------------------------------------------------------------------ placeholders
-- 7. One unsaved new listing per owner, and it has to be a draft that is not a copy.
INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary,
                          status, created_by_user_id, is_placeholder)
VALUES (@business, @locality, 'smoke-staged-new', N'New business', @centre, '+919999900911',
        'draft', @owner, 1);
PRINT 'ok: an unsaved new listing can be created';

BEGIN TRY
    INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary,
                              status, created_by_user_id, is_placeholder)
    VALUES (@business, @locality, 'smoke-staged-new-two', N'New business', @centre, '+919999900911',
            'draft', @owner, 1);
    SET @failed = @failed + 1;
    PRINT 'FAIL: a second unsaved new listing was accepted for the same owner';
END TRY
BEGIN CATCH
    PRINT 'ok: an owner has at most one unsaved new listing';
END CATCH

BEGIN TRY
    INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary,
                              status, created_by_user_id, is_placeholder, staged_for_listing_id)
    VALUES (@business, @locality, 'smoke-staged-both', N'Both At Once', @centre, '+919999900911',
            'draft', @owner, 1, @published);
    SET @failed = @failed + 1;
    PRINT 'FAIL: a row was accepted as both an unsaved new listing and a staged copy';
END TRY
BEGIN CATCH
    PRINT 'ok: a row is one thing or the other, never both';
END CATCH

ROLLBACK TRANSACTION;

IF @failed > 0
BEGIN
    DECLARE @message nvarchar(200) = CAST(@failed AS nvarchar(10)) + ' staged-listing check(s) failed.';
    THROW 51044, @message, 1;
END
PRINT 'staged_listings_smoke: all checks passed.';
GO
