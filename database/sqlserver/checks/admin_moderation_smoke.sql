-- Manual smoke test for the SQL behind /api/v1/admin/listings: the review queue, approving,
-- rejecting, and the audit trail each decision leaves. It creates its own admin, roles and
-- listings, asserts each rule, then rolls back, so it leaves no data and is safe to re-run.
--
-- The .NET integration tests deliberately need no database (CI runs without one), so the database
-- behaviour is checked here instead.
--
-- The PostgreSQL original is database/checks/admin_moderation_smoke.sql, kept as history. What
-- changed: jsonb became nvarchar(max) guarded by ISJSON, so `details -> 'reason'` became
-- JSON_VALUE(details, '$.reason'); ::text casts became CAST(... AS nvarchar(100)); repeat became
-- REPLICATE; interval arithmetic became DATEADD; and LIMIT/OFFSET became OFFSET/FETCH, which needs
-- an ORDER BY. The append-only audit log is now INSTEAD OF triggers that accept the statement and
-- change nothing, so the assertions read the rows back rather than trusting @@ROWCOUNT.
--
-- Run:
--   npm run db:check -- admin_moderation_smoke

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @reviewer bigint, @viewer bigint, @viewerRole int, @business bigint;
DECLARE @waiting bigint, @live bigint, @draft bigint, @byAdmin bigint;
DECLARE @n int;
DECLARE @rowStatus varchar(40), @note nvarchar(1000);
DECLARE @published datetimeoffset(3), @publishedBefore datetimeoffset(3);   -- the column's own scale
DECLARE @locality int, @centre geography, @electricians int;

SELECT @locality = id, @centre = center FROM localities WHERE slug = 'madhapur';
SELECT @electricians = id FROM categories WHERE slug = 'electricians';

-- ----------------------------------------------------------------- two admins
-- One ordinary admin (may review) and one with a role that holds only listings.view (may not).
INSERT INTO admin_users (email, display_name, password_hash, status)
VALUES ('smoke.reviewer@example.com', 'Smoke Reviewer', 'pbkdf2-sha256$210000$c21va2U=$c21va2U=', 'active');
SET @reviewer = SCOPE_IDENTITY();
INSERT INTO admin_users (email, display_name, password_hash, status)
VALUES ('smoke.viewer@example.com', 'Smoke Viewer', 'pbkdf2-sha256$210000$c21va2U=$c21va2U=', 'active');
SET @viewer = SCOPE_IDENTITY();

INSERT INTO roles (slug, name, description) VALUES ('smoke_viewer', 'Smoke viewer', 'Can only look');
SET @viewerRole = SCOPE_IDENTITY();

INSERT INTO role_permissions (role_id, permission_id)
SELECT @viewerRole, id FROM permissions WHERE code = 'listings.view';

INSERT INTO admin_user_roles (admin_user_id, role_id)
SELECT @reviewer, id FROM roles WHERE slug = 'admin';

INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES (@viewer, @viewerRole);

-- ------------------------------------------------------------- three listings
-- One waiting for review, one already live, one still a draft.
INSERT INTO businesses (name) VALUES ('Smoke Moderation Business');
SET @business = SCOPE_IDENTITY();

DECLARE @inserted TABLE (id bigint);

INSERT INTO listings (business_id, locality_id, slug, name, description, address_line, location, phone_primary, status)
OUTPUT inserted.id INTO @inserted
VALUES (@business, @locality, 'modsmoke-waiting', 'Modsmoke Waiting Electricals',
        'Wiring and repairs for homes and shops.', 'Plot 9, Madhapur',
        @centre, '+919999900061', 'pending_review');
SET @waiting = (SELECT TOP (1) id FROM @inserted);
DELETE FROM @inserted;

INSERT INTO listings (business_id, locality_id, slug, name, location, phone_primary, status, published_at)
OUTPUT inserted.id INTO @inserted
VALUES (@business, @locality, 'modsmoke-live', 'Modsmoke Live Electricals',
        @centre, '+919999900062', 'active', DATEADD(day, -10, SYSDATETIMEOFFSET()));
SET @live = (SELECT TOP (1) id FROM @inserted);
DELETE FROM @inserted;
-- Read it back rather than keeping the value that was sent: published_at is datetimeoffset(3), so
-- a full-precision value does not survive the round trip and would fail the comparison in 11.
SELECT @publishedBefore = published_at FROM listings WHERE id = @live;

INSERT INTO listings (business_id, locality_id, slug, name, location, phone_primary, status)
OUTPUT inserted.id INTO @inserted
VALUES (@business, @locality, 'modsmoke-draft', 'Modsmoke Draft Electricals',
        @centre, '+919999900063', 'draft');
SET @draft = (SELECT TOP (1) id FROM @inserted);

INSERT INTO listing_categories (listing_id, category_id, category_level, is_primary)
VALUES (@waiting, @electricians, 2, 1), (@live, @electricians, 2, 1), (@draft, @electricians, 2, 1);

-- 1. The permission query behind AdminAccess.Load gives the ordinary admin role the right to review.
SET @n = (SELECT COUNT(*) FROM admin_users au
          JOIN admin_user_roles aur ON aur.admin_user_id = au.id
          JOIN role_permissions rp ON rp.role_id = aur.role_id
          JOIN permissions p ON p.id = rp.permission_id
          WHERE au.id = @reviewer AND au.status = 'active' AND p.code = 'listings.review');
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the admin role does not carry listings.review (' + CAST(@n AS varchar(10)) + ' rows)';
END
ELSE PRINT 'ok: the admin role carries listings.review';

-- 2. An admin whose role holds only listings.view cannot review. Permissions come from the database
--    on every request, so this is the same check the API makes.
SET @n = (SELECT COUNT(*) FROM admin_users au
          JOIN admin_user_roles aur ON aur.admin_user_id = au.id
          JOIN role_permissions rp ON rp.role_id = aur.role_id
          JOIN permissions p ON p.id = rp.permission_id
          WHERE au.id = @viewer AND p.code = 'listings.review');
IF @n <> 0
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a view-only admin was granted listings.review';
END
ELSE PRINT 'ok: a view-only admin cannot review';

-- 3. Ordinary admin permissions stay separate from super-admin ones.
SET @n = (SELECT COUNT(*) FROM roles r
          JOIN role_permissions rp ON rp.role_id = r.id
          JOIN permissions p ON p.id = rp.permission_id
          WHERE r.slug = 'admin'
            AND p.code IN ('admins.manage', 'plans.manage', 'audit.view', 'analytics.view', 'data.export'));
IF @n <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the admin role holds ' + CAST(@n AS varchar(10)) + ' super-admin permission(s)';
END
ELSE PRINT 'ok: super-admin permissions stay out of the admin role';

-- 4. A disabled admin disappears from the permission query at once, without touching their roles.
UPDATE admin_users SET status = 'disabled' WHERE id = @reviewer;
IF EXISTS (SELECT 1 FROM admin_users WHERE id = @reviewer AND status = 'active')
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a disabled admin still looks active';
END
ELSE PRINT 'ok: a disabled admin stops being active immediately';
UPDATE admin_users SET status = 'active' WHERE id = @reviewer;

-- 5. The queue shows what is waiting for review, and nothing else.
SET @n = (SELECT COUNT(*) FROM listings
          WHERE slug LIKE 'modsmoke-%' AND status = 'pending_review');
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the review queue held ' + CAST(@n AS varchar(10)) + ' listings, expected 1';
END
ELSE PRINT 'ok: the review queue holds only what is waiting';

-- 6. The queue carries the total of all matches even when the page is past the end, exactly like
--    the public search query.
WITH matches AS (
    SELECT id FROM listings WHERE slug LIKE 'modsmoke-%' AND status = 'pending_review'
),
page AS (SELECT id FROM matches ORDER BY id OFFSET 2000 ROWS FETCH NEXT 20 ROWS ONLY)
SELECT @n = (SELECT COUNT(*) FROM matches)
FROM (SELECT 1 AS one) always_one_row
LEFT JOIN page p ON 1 = 1;
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a page past the end reported a total of ' + CAST(@n AS varchar(10)) + ', expected 1';
END
ELSE PRINT 'ok: a page past the end still reports the total';

-- 7. Approving publishes the listing and records who decided.
UPDATE listings
SET status = 'active',
    published_at = COALESCE(published_at, SYSDATETIMEOFFSET()),
    review_note = NULL,
    reviewed_at = SYSDATETIMEOFFSET(),
    reviewed_by_admin_id = @reviewer,
    updated_at = SYSDATETIMEOFFSET()
WHERE id = @waiting AND status = 'pending_review';

SELECT @rowStatus = status, @published = published_at FROM listings WHERE id = @waiting;
IF @rowStatus <> 'active'
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: approving left the listing as ' + @rowStatus;
END
ELSE IF @published IS NULL
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: approving did not set published_at';
END
ELSE PRINT 'ok: approving publishes the listing';

-- 8. An approved listing is immediately visible to public search (status = 'active' is all it checks).
IF NOT EXISTS (SELECT 1 FROM listings WHERE id = @waiting AND status = 'active')
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the approved listing is not public';
END
ELSE PRINT 'ok: the approved listing is public at once';

-- 9. The decision is in the audit log, attributed to the admin who made it.
INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, details)
VALUES ('admin', @reviewer, 'listing.approved', 'listing', CAST(@waiting AS nvarchar(100)),
        '{"previousStatus":"pending_review"}');

SET @n = (SELECT COUNT(*) FROM audit_logs
          WHERE action = 'listing.approved' AND entity_type = 'listing'
            AND entity_id = CAST(@waiting AS nvarchar(100))
            AND actor_type = 'admin' AND actor_id = @reviewer);
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the approval left ' + CAST(@n AS varchar(10)) + ' audit rows, expected 1';
END
ELSE PRINT 'ok: the approval is attributed in the audit log';

-- 10. A second decision on the same listing changes nothing: the guard is "status = pending_review".
UPDATE listings SET status = 'rejected', updated_at = SYSDATETIMEOFFSET()
WHERE id = @waiting AND status = 'pending_review';
SELECT @rowStatus = status FROM listings WHERE id = @waiting;
IF @rowStatus <> 'active'
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: a second decision overwrote the first (the listing is now ' + @rowStatus + ')';
END
ELSE PRINT 'ok: a second decision on a decided listing changes nothing';

-- 11. Re-approving a listing that was live before keeps its original publication date.
UPDATE listings SET status = 'pending_review' WHERE id = @live;
UPDATE listings
SET status = 'active', published_at = COALESCE(published_at, SYSDATETIMEOFFSET()),
    reviewed_at = SYSDATETIMEOFFSET(), reviewed_by_admin_id = @reviewer
WHERE id = @live AND status = 'pending_review';
SELECT @published = published_at FROM listings WHERE id = @live;
IF @published <> @publishedBefore
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: re-approving moved published_at';
END
ELSE PRINT 'ok: re-approving keeps the original publication date';

-- 12. Rejecting hides the listing and keeps the reason the owner will read.
UPDATE listings SET status = 'pending_review' WHERE id = @waiting;
UPDATE listings
SET status = 'rejected',
    review_note = 'The address does not match the phone number. Please correct it.',
    reviewed_at = SYSDATETIMEOFFSET(),
    reviewed_by_admin_id = @reviewer,
    updated_at = SYSDATETIMEOFFSET()
WHERE id = @waiting AND status = 'pending_review';

SELECT @rowStatus = status, @note = review_note FROM listings WHERE id = @waiting;
IF @rowStatus <> 'rejected'
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: rejecting left the listing as ' + @rowStatus;
END
ELSE IF @note IS NULL OR @note = ''
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: rejecting did not keep the reason';
END
ELSE PRINT 'ok: rejecting keeps the reason the owner will read';

-- 13. A rejected listing is no longer public.
IF EXISTS (SELECT 1 FROM listings WHERE id = @waiting AND status = 'active')
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a rejected listing is still public';
END
ELSE PRINT 'ok: a rejected listing is no longer public';

-- 14. The rejection reason reaches the audit log too.
INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, details)
VALUES ('admin', @reviewer, 'listing.rejected', 'listing', CAST(@waiting AS nvarchar(100)),
        '{"previousStatus":"pending_review","reason":"The address does not match the phone number. Please correct it."}');

DECLARE @reason nvarchar(1000) = (
    SELECT TOP (1) JSON_VALUE(details, '$.reason')
    FROM audit_logs
    WHERE action = 'listing.rejected' AND entity_id = CAST(@waiting AS nvarchar(100))
    ORDER BY occurred_at DESC);
IF @reason IS NULL
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: the audit row kept no reason';
END
ELSE PRINT 'ok: the audit row kept the rejection reason';

-- 15. The audit log is append-only: an attempt to change or delete a decision is a no-op.
UPDATE audit_logs SET action = 'listing.approved'
WHERE action = 'listing.rejected' AND entity_id = CAST(@waiting AS nvarchar(100));
SET @n = (SELECT COUNT(*) FROM audit_logs
          WHERE action = 'listing.rejected' AND entity_id = CAST(@waiting AS nvarchar(100)));
IF @n <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: an audit row was rewritten';
END
ELSE PRINT 'ok: an audit row cannot be rewritten';

DELETE FROM audit_logs WHERE entity_id = CAST(@waiting AS nvarchar(100));
SET @n = (SELECT COUNT(*) FROM audit_logs WHERE entity_id = CAST(@waiting AS nvarchar(100)));
IF @n <> 2
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: audit rows were deleted (' + CAST(@n AS varchar(10)) + ' left of 2)';
END
ELSE PRINT 'ok: audit rows cannot be deleted';

-- 16. The reason cannot exceed what the API allows (the S0004 constraint).
BEGIN TRY
    UPDATE listings SET review_note = REPLICATE(CAST('x' AS nvarchar(max)), 1001) WHERE id = @waiting;
    SET @failed = @failed + 1; PRINT 'FAIL: a 1001-character review note was accepted';
END TRY BEGIN CATCH PRINT 'ok: an over-long review note rejected'; END CATCH;

-- 17. A draft listing never reaches the review queue, so it cannot be approved by mistake.
IF EXISTS (SELECT 1 FROM listings WHERE id = @draft AND status = 'pending_review')
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: a draft listing appeared in the review queue';
END
ELSE PRINT 'ok: a draft listing never reaches the review queue';

-- 18. A listing an admin adds by hand is marked source = 'admin', has no owner account behind it,
--     and is published straight away (what the API writes when the admin may also review).
DELETE FROM @inserted;
INSERT INTO listings (business_id, locality_id, slug, name, description, address_line, location,
                      phone_primary, status, source, created_by_user_id, published_at)
OUTPUT inserted.id INTO @inserted
VALUES (@business, @locality, 'modsmoke-by-admin', 'Modsmoke Walk-In Electricals',
        'Added from a phone call.', 'Shop 3, Madhapur', @centre, '+919999900064',
        'active', 'admin', NULL, SYSDATETIMEOFFSET());
SET @byAdmin = (SELECT TOP (1) id FROM @inserted);

IF NOT EXISTS (SELECT 1 FROM listings
               WHERE id = @byAdmin AND source = 'admin' AND created_by_user_id IS NULL
                 AND status = 'active' AND published_at IS NOT NULL)
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: the hand-added listing was not stored as an admin listing';
END
ELSE PRINT 'ok: a hand-added listing is an admin listing with no owner';

-- 19. `source` only accepts the three values the application uses.
BEGIN TRY
    UPDATE listings SET source = 'somewhere_else' WHERE id = @byAdmin;
    SET @failed = @failed + 1; PRINT 'FAIL: an unknown listing source was accepted';
END TRY BEGIN CATCH PRINT 'ok: unknown listing source rejected'; END CATCH;

-- 20. An admin editing a listing changes its details, never its status: editing must not publish.
UPDATE listings SET status = 'pending_review', published_at = NULL WHERE id = @byAdmin;
UPDATE listings
SET name = 'Modsmoke Walk-In Electricals and Repairs', phone_primary = '+919999900065',
    updated_at = SYSDATETIMEOFFSET()
WHERE id = @byAdmin;

SELECT @rowStatus = status FROM listings WHERE id = @byAdmin;
IF @rowStatus <> 'pending_review'
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: editing changed the status to ' + @rowStatus;
END
ELSE PRINT 'ok: editing a listing does not change its status';

-- 21. Submitting a corrected listing again clears the old rejection reason, so the owner is not
--     shown advice about a version they have already fixed.
UPDATE listings SET status = 'rejected', review_note = 'Old reason.' WHERE id = @byAdmin;
UPDATE listings SET status = 'pending_review', review_note = NULL, updated_at = SYSDATETIMEOFFSET()
WHERE id = @byAdmin AND status IN ('draft', 'rejected');

IF NOT EXISTS (SELECT 1 FROM listings
               WHERE id = @byAdmin AND status = 'pending_review' AND review_note IS NULL)
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: resubmitting kept the old rejection reason';
END
ELSE PRINT 'ok: resubmitting clears the old rejection reason';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'admin moderation rules behaved as expected';
GO

ROLLBACK TRANSACTION;
GO
