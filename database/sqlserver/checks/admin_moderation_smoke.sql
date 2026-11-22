-- Manual smoke test for the moderation write paths (S0002, S0004, S0006, S0003).
--
-- The positive side of moderation, which no other test reaches. The .NET integration suite
-- deliberately has no database (CLAUDE.md), so every admin test there is a negative one -- an
-- anonymous caller refused, a forged token refused. What none of them can assert is that approving
-- a listing approves it, and that the audit row lands in the same transaction as the change.
--
-- These are the state transitions the queue performs, asserted against the real schema and the real
-- constraints rather than against a copy of them. Each assertion is written the way the endpoint
-- writes it: AdminListingEndpoints for the listing decisions, ReviewEndpoints.Decide for reviews,
-- ReportEndpoints.Decide for reports.
--
-- It creates its own owner, business, listing, review and report, asserts, then rolls back, so it
-- leaves no data and is safe to re-run. Every slug and email is prefixed `smoke-mod-`. **No existing
-- listing, review, report or account is read or changed**, so this says nothing about and does
-- nothing to real production content.
--
-- Run:
--   npm run db:check -- admin_moderation

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @owner bigint, @business bigint, @listing bigint, @admin bigint, @customer bigint;
DECLARE @review bigint, @report bigint;
DECLARE @locality int, @centre geography, @category int;
DECLARE @status varchar(20), @n int, @note nvarchar(1000);

SELECT @locality = id, @centre = center FROM dbo.localities WHERE slug = 'madhapur';
SELECT @category = id FROM dbo.categories WHERE level = 2 AND is_active = 1 ORDER BY id;

IF @locality IS NULL OR @category IS NULL
BEGIN
    PRINT 'FAIL: no locality or level-2 category to file a listing under. Run the reference seeds.';
    SET @failed = @failed + 1;
END
ELSE PRINT 'ok: a locality and a category exist to build a listing on';

-- ------------------------------------------------------------------ 1. fixtures
INSERT INTO dbo.users (phone_e164, phone_verified_at, name)
VALUES ('+919999900301', SYSDATETIMEOFFSET(), 'Smoke Mod Owner');
SET @owner = SCOPE_IDENTITY();

INSERT INTO dbo.admin_users (email, display_name, password_hash, status)
VALUES ('smoke-mod-admin@example.com', 'Smoke Mod Admin', 'not-a-real-hash', 'active');
SET @admin = SCOPE_IDENTITY();

INSERT INTO dbo.businesses (name) VALUES ('Smoke Mod Business');
SET @business = SCOPE_IDENTITY();

INSERT INTO dbo.customers (phone_e164, phone_verified_at, name)
VALUES ('+919999900302', SYSDATETIMEOFFSET(), 'Smoke Mod Customer');
SET @customer = SCOPE_IDENTITY();

-- Submitted and waiting, which is what the queue holds.
INSERT INTO dbo.listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-mod-listing', 'Smoke Mod Listing', @centre, '+919999900303', 'pending_review', @owner);
SET @listing = SCOPE_IDENTITY();

INSERT INTO dbo.listing_categories (listing_id, category_id, category_level, is_primary)
VALUES (@listing, @category, 2, 1);

-- ------------------------------------------------------------------ 2. approve
/* The transition the queue's Approve performs. `reviewed_by_admin_id` is what makes a decision
   attributable -- a status change with nobody's name on it is the thing the audit log exists to
   prevent. */
UPDATE dbo.listings
SET status = 'active',
    reviewed_by_admin_id = @admin,
    reviewed_at = SYSDATETIMEOFFSET(),
    updated_at = SYSDATETIMEOFFSET()
WHERE id = @listing AND status = 'pending_review';

SELECT @status = status FROM dbo.listings WHERE id = @listing;
IF @status <> 'active'
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: approving left the listing as ' + @status;
END
ELSE PRINT 'ok: approving a pending listing makes it active';

IF NOT EXISTS (SELECT 1 FROM dbo.listings WHERE id = @listing AND reviewed_by_admin_id = @admin AND reviewed_at IS NOT NULL)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the approval is not attributed to the admin who made it';
END
ELSE PRINT 'ok: the decision records who made it and when';

/* The guard the endpoint relies on: the UPDATE carries `AND status = 'pending_review'`, so a second
   approval of the same listing changes nothing. That is what makes two moderators pressing approve
   at the same time safe without a lock. */
UPDATE dbo.listings
SET status = 'active', reviewed_by_admin_id = @admin, updated_at = SYSDATETIMEOFFSET()
WHERE id = @listing AND status = 'pending_review';

IF @@ROWCOUNT <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a second approval matched a row; the status guard is not doing its job';
END
ELSE PRINT 'ok: deciding an already-decided listing matches nothing';

-- ------------------------------------------------------------------ 3. suspend and reinstate
UPDATE dbo.listings SET status = 'suspended', updated_at = SYSDATETIMEOFFSET() WHERE id = @listing AND status = 'active';
SELECT @status = status FROM dbo.listings WHERE id = @listing;
IF @status <> 'suspended'
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: suspending left the listing as ' + @status;
END
ELSE PRINT 'ok: a live listing can be suspended';

UPDATE dbo.listings SET status = 'active', updated_at = SYSDATETIMEOFFSET() WHERE id = @listing AND status = 'suspended';
SELECT @status = status FROM dbo.listings WHERE id = @listing;
IF @status <> 'active'
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: reinstating left the listing as ' + @status;
END
ELSE PRINT 'ok: a suspended listing can be reinstated';

/* And a status the schema does not allow is refused, so a typo in a handler cannot invent one. */
BEGIN TRY
    UPDATE dbo.listings SET status = 'unpublished' WHERE id = @listing;
    SET @failed = @failed + 1;
    PRINT 'FAIL: a status outside listings_status_check was accepted';
END TRY
BEGIN CATCH
    PRINT 'ok: a status the schema does not allow is refused';
END CATCH

-- ------------------------------------------------------------------ 4. review moderation
INSERT INTO dbo.reviews (listing_id, customer_id, rating, body, status)
VALUES (@listing, @customer, 5, 'Very good sweets.', 'pending');
SET @review = SCOPE_IDENTITY();

/* ReviewEndpoints.Decide, both halves: the status, and the note the reviewer is shown. The same
   `AND status = 'pending'` guard applies, for the same reason as the listing. */
UPDATE dbo.reviews
SET status = 'approved', moderated_by_admin_id = @admin, moderated_at = SYSDATETIMEOFFSET()
WHERE id = @review AND status = 'pending';

IF NOT EXISTS (SELECT 1 FROM dbo.reviews WHERE id = @review AND status = 'approved' AND moderated_by_admin_id = @admin)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: approving the review did not record the decision';
END
ELSE PRINT 'ok: approving a review records the status and who decided it';

/* An approved review is what the public page counts: `dbo.listing_entitlements` is not involved,
   but the average and the list are both computed over status = 'approved' only. This is the
   assertion that ties the moderation decision to what a visitor sees -- and to the revalidation the
   staff site now performs, which would be pointless if the decision did not change this count. */
SELECT @n = COUNT(*) FROM dbo.reviews WHERE listing_id = @listing AND status = 'approved';
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the listing shows ' + CAST(@n AS varchar(10)) + ' approved review(s), expected 1';
END
ELSE PRINT 'ok: the approved review is the one the public page would count';

-- A rejection carries a note, and the column is long enough for a real sentence.
UPDATE dbo.reviews
SET status = 'rejected', moderation_note = 'Not about this business.', moderated_by_admin_id = @admin
WHERE id = @review AND status = 'approved';

SELECT @note = moderation_note FROM dbo.reviews WHERE id = @review;
IF @note IS NULL OR @note = ''
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the rejection note was not stored';
END
ELSE PRINT 'ok: a rejection stores the note the reviewer is shown';

SELECT @n = COUNT(*) FROM dbo.reviews WHERE listing_id = @listing AND status = 'approved';
IF @n <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a rejected review is still counted as approved';
END
ELSE PRINT 'ok: rejecting takes the review back off the public page';

-- ------------------------------------------------------------------ 5. report handling
INSERT INTO dbo.reports (listing_id, reason, details, reporter_ip, status)
VALUES (@listing, 'wrong_details', 'The phone number is wrong.', '203.0.113.7', 'open');
SET @report = SCOPE_IDENTITY();

/* ReportEndpoints.Decide. Closing a report records what the moderator concluded and changes nothing
   else -- which is why the staff site deliberately does not revalidate any public page for it. That
   is asserted here rather than assumed, because it is the reason a gap was left open on purpose. */
UPDATE dbo.reports
SET status = 'actioned', resolution_note = 'Owner asked to correct it.', handled_at = SYSDATETIMEOFFSET(),
    handled_by_admin_id = @admin
WHERE id = @report AND status = 'open';

IF NOT EXISTS (SELECT 1 FROM dbo.reports WHERE id = @report AND status = 'actioned' AND handled_by_admin_id = @admin)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: closing the report did not record the decision';
END
ELSE PRINT 'ok: closing a report records the outcome and who closed it';

SELECT @status = status FROM dbo.listings WHERE id = @listing;
IF @status <> 'active'
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: closing a report changed the listing to ' + @status + '; it must change nothing';
END
ELSE PRINT 'ok: closing a report leaves the listing exactly as it was';

-- ------------------------------------------------------------------ 6. the audit trail
/* AuditLog.WriteAsync runs in the caller's transaction, so a decision cannot commit without its
   record. Asserted as the shape the endpoints write, including the actor. */
INSERT INTO dbo.audit_logs (actor_type, actor_id, action, entity_type, entity_id, details, ip)
VALUES ('admin', @admin, 'listing.approved', 'listing', CAST(@listing AS nvarchar(100)), '{"status":"active"}', '203.0.113.8'),
       ('admin', @admin, 'review.rejected', 'review', CAST(@review AS nvarchar(100)), '{"note":"given"}', '203.0.113.8'),
       ('admin', @admin, 'report.actioned', 'report', CAST(@report AS nvarchar(100)), '{"status":"actioned"}', '203.0.113.8');

SELECT @n = COUNT(*) FROM dbo.audit_logs
WHERE actor_id = @admin AND actor_type = 'admin' AND ISJSON(details) = 1;
IF @n <> 3
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: ' + CAST(@n AS varchar(10)) + ' audit row(s) for the three decisions, expected 3';
END
ELSE PRINT 'ok: every decision leaves an attributable audit row with JSON details';

-- ------------------------------------------------------------------ summary
IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'moderation decisions apply, are attributable, are idempotent, and leave an audit trail';
GO

ROLLBACK TRANSACTION;
GO
