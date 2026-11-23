-- Manual smoke test for S0031: an edit to a published listing is kept aside, and the published
-- version is not touched until somebody approves it.
-- The transactional part inserts, asserts, and rolls back, so it leaves no data and is safe to re-run.
--
-- What belongs here rather than in the .NET suite is everything the database itself enforces: one
-- staged edit per listing, a submitted edit always carrying a date, a rejection always carrying a
-- note, and the cascade that stops a deleted listing leaving an orphan behind. The .NET tests
-- cover the decisions; these cover whether a wrong row can exist at all.
--
-- Run:
--   npm run db:check -- pending_changes
--
-- NOTE, honestly: this file has never been executed. There is no SQL Server available outside
-- production in this environment, so it was written alongside the migration and is the first thing
-- to run once S0031 has been applied to a database somebody can afford to break.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

DECLARE @failed int = 0;

IF OBJECT_ID('dbo.listing_pending_changes', 'U') IS NULL
BEGIN
    PRINT 'FAIL: dbo.listing_pending_changes does not exist, so S0031 has not run';
    THROW 51031, 'S0031 has not been applied.', 1;
END;
PRINT 'ok: the staging table exists';
GO

DECLARE @failed int = 0;
BEGIN TRANSACTION;

DECLARE @owner bigint, @business bigint, @locality int, @centre geography;
DECLARE @listing bigint, @draftListing bigint, @category int, @otherCategory int, @staged bigint;

SELECT @locality = id, @centre = center FROM dbo.localities WHERE slug = 'madhapur';
SELECT TOP (1) @category = id FROM dbo.categories WHERE level = 2 ORDER BY id;
SELECT TOP (1) @otherCategory = id FROM dbo.categories WHERE level = 2 AND id <> @category ORDER BY id;

INSERT INTO dbo.users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900611', SYSDATETIMEOFFSET(), 'Smoke Pending Owner', 'pending@example.com');
SET @owner = SCOPE_IDENTITY();

INSERT INTO dbo.businesses (name) VALUES ('Smoke Pending Business');
SET @business = SCOPE_IDENTITY();
INSERT INTO dbo.business_members (business_id, user_id, role) VALUES (@business, @owner, 'owner');

INSERT INTO dbo.listings (business_id, locality_id, slug, name, description, address_line,
                          location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-pending-live', 'Smoke Pending Live',
        'A published listing with a staged edit waiting on it.', 'Plot 1, Madhapur',
        @centre, '+919999900611', 'active', @owner);
SET @listing = SCOPE_IDENTITY();
INSERT INTO dbo.listing_categories (listing_id, category_id, is_primary) VALUES (@listing, @category, 1);

-- ------------------------------------------------------------------ a staged edit
INSERT INTO dbo.listing_pending_changes
    (listing_id, status, name, description, address_line, phone_primary, category_id, created_by_user_id)
VALUES (@listing, 'draft', 'Smoke Pending Renamed', 'A new description, not yet seen by anybody.',
        'Plot 2, Madhapur', '+919999900611', @otherCategory, @owner);
SET @staged = SCOPE_IDENTITY();
PRINT 'ok: an owner''s edit can be staged against a published listing';

-- 1. The published listing is untouched. This is the entire point of the feature.
IF (SELECT name FROM dbo.listings WHERE id = @listing) <> 'Smoke Pending Live'
   OR (SELECT address_line FROM dbo.listings WHERE id = @listing) <> 'Plot 1, Madhapur'
   OR (SELECT status FROM dbo.listings WHERE id = @listing) <> 'active'
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: staging an edit changed the published listing';
END
ELSE PRINT 'ok: the published listing is unchanged while the edit waits';

-- 2. The listing keeps its primary category too: a staged category change is a proposal.
IF (SELECT category_id FROM dbo.listing_categories WHERE listing_id = @listing AND is_primary = 1) <> @category
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: staging a category change moved the listing';
END
ELSE PRINT 'ok: a staged category change does not file the listing anywhere';

-- 3. One edit per listing. A second is the same form saved again, not another proposal.
BEGIN TRY
    INSERT INTO dbo.listing_pending_changes (listing_id, status, name, created_by_user_id)
    VALUES (@listing, 'draft', 'A Second Edit', @owner);
    SET @failed = @failed + 1;
    PRINT 'FAIL: a second staged edit was accepted for the same listing';
END TRY
BEGIN CATCH
    PRINT 'ok: a listing has at most one staged edit';
END CATCH

-- 4. A submitted edit must carry the time it was submitted, or "is this in the queue?" has two
--    answers that can disagree.
BEGIN TRY
    INSERT INTO dbo.listing_pending_changes (listing_id, status, name, created_by_user_id, submitted_at)
    VALUES (@listing, 'pending_review', 'No Date', @owner, NULL);
    SET @failed = @failed + 1;
    PRINT 'FAIL: a submitted edit was accepted with no submitted_at';
END TRY
BEGIN CATCH
    PRINT 'ok: a submitted edit has to say when';
END CATCH

-- 5. A draft must not carry one: it has not been submitted.
BEGIN TRY
    INSERT INTO dbo.listing_pending_changes (listing_id, status, name, created_by_user_id, submitted_at)
    VALUES (@listing, 'draft', 'Dated Draft', @owner, SYSDATETIMEOFFSET());
    SET @failed = @failed + 1;
    PRINT 'FAIL: an unsubmitted edit was accepted with a submitted_at';
END TRY
BEGIN CATCH
    PRINT 'ok: an unsubmitted edit has no submission date';
END CATCH

-- 6. A rejection has to say why. The owner reads it and decides what to change.
UPDATE dbo.listing_pending_changes SET status = 'pending_review', submitted_at = SYSDATETIMEOFFSET()
WHERE id = @staged;

BEGIN TRY
    UPDATE dbo.listing_pending_changes SET status = 'rejected', review_note = NULL WHERE id = @staged;
    SET @failed = @failed + 1;
    PRINT 'FAIL: a rejection with no note was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a rejection must carry a note';
END CATCH

BEGIN TRY
    UPDATE dbo.listing_pending_changes SET status = 'rejected', review_note = N'   ' WHERE id = @staged;
    SET @failed = @failed + 1;
    PRINT 'FAIL: a rejection with a blank note was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a blank note is not a note';
END CATCH

-- 7. A state outside the three is refused: every screen describes exactly these.
BEGIN TRY
    UPDATE dbo.listing_pending_changes SET status = 'approved' WHERE id = @staged;
    SET @failed = @failed + 1;
    PRINT 'FAIL: a fourth state was accepted. Approval removes the row; it is not a status';
END TRY
BEGIN CATCH
    PRINT 'ok: draft, pending_review and rejected are the only states';
END CATCH

-- 8. Approving is a copy and a delete, done the way the API does it. What matters here is that the
--    two together leave the listing published with the new values and no staged row behind.
UPDATE dbo.listing_pending_changes
SET status = 'pending_review', review_note = NULL, submitted_at = SYSDATETIMEOFFSET()
WHERE id = @staged;

UPDATE li
SET name = p.name,
    description = p.description,
    address_line = p.address_line,
    review_note = NULL,
    updated_at = SYSDATETIMEOFFSET()
FROM dbo.listings li
JOIN dbo.listing_pending_changes p ON p.listing_id = li.id
WHERE li.id = @listing;

UPDATE dbo.listing_categories SET category_id = @otherCategory WHERE listing_id = @listing AND is_primary = 1;
DELETE FROM dbo.listing_pending_changes WHERE id = @staged;

IF (SELECT name FROM dbo.listings WHERE id = @listing) <> 'Smoke Pending Renamed'
   OR (SELECT status FROM dbo.listings WHERE id = @listing) <> 'active'
   OR EXISTS (SELECT 1 FROM dbo.listing_pending_changes WHERE listing_id = @listing)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: approving did not publish the edit and clear the staged row';
END
ELSE PRINT 'ok: approving publishes the edit, leaves the listing live, and clears the staged row';

-- 9. A deleted listing takes its staged edit with it: there is nothing to publish onto a listing
--    that no longer exists, and an orphan would sit in the queue forever.
INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-pending-gone', 'Smoke Pending Gone', @centre, '+919999900611', 'draft', @owner);
SET @draftListing = SCOPE_IDENTITY();

INSERT INTO dbo.listing_pending_changes (listing_id, status, name, created_by_user_id)
VALUES (@draftListing, 'draft', 'Edit On A Doomed Listing', @owner);

DELETE FROM dbo.listings WHERE id = @draftListing;

IF EXISTS (SELECT 1 FROM dbo.listing_pending_changes WHERE listing_id = @draftListing)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a staged edit outlived its listing';
END
ELSE PRINT 'ok: deleting a listing takes its staged edit with it';

ROLLBACK TRANSACTION;

IF @failed > 0
BEGIN
    DECLARE @message nvarchar(200) = CAST(@failed AS nvarchar(10)) + ' pending-change check(s) failed.';
    THROW 51032, @message, 1;
END
PRINT 'pending_changes_smoke: all checks passed.';
GO
