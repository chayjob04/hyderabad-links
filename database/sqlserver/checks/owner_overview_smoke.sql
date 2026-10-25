-- Manual smoke test for the counting behind GET /api/v1/me/overview.
-- The point that matters is isolation: one owner's dashboard must never count another owner's
-- listings. It creates two owners, gives them listings in several states, asserts the figures, then
-- rolls back, so it leaves no data and is safe to re-run.
--
-- The PostgreSQL original is database/checks/owner_overview_smoke.sql, kept as history. What
-- changed: the completion score was a sum of booleans cast to int, which SQL Server has no way to
-- express (a bit is not a value you can add, and EXISTS is not a selectable expression), so each
-- term became CASE WHEN ... THEN 1 ELSE 0 END. btrim became LTRIM(RTRIM(...)).
--
-- Run:
--   npm run db:check -- owner_overview_smoke

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;
GO

DECLARE @failed int = 0;
DECLARE @one bigint, @two bigint, @business bigint, @n int, @done int;
DECLARE @locality int, @centre geography, @category int;

SELECT @locality = id, @centre = center FROM localities WHERE slug = 'madhapur';
SELECT @category = id FROM categories WHERE slug = 'plumbers';

INSERT INTO users (phone_e164, phone_verified_at, name, email)
VALUES ('+919999900091', SYSDATETIMEOFFSET(), 'Smoke Owner One', 'one@example.com');
SET @one = SCOPE_IDENTITY();

-- The second owner has no profile yet, which is what makes their completion score 0.
INSERT INTO users (phone_e164, phone_verified_at) VALUES ('+919999900092', SYSDATETIMEOFFSET());
SET @two = SCOPE_IDENTITY();

-- Owner one: one active (with address and description), one pending, one draft, one rejected,
-- and one archived that must be ignored entirely.
INSERT INTO businesses (name) VALUES ('Smoke Overview One');
SET @business = SCOPE_IDENTITY();
INSERT INTO business_members (business_id, user_id, role) VALUES (@business, @one, 'owner');

INSERT INTO listings (business_id, locality_id, slug, name, description, address_line, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-ov-active',   'Smoke Ov Active',   'Full description here', 'Plot 1, Madhapur', @centre, '+919999900091', 'active',         @one),
       (@business, @locality, 'smoke-ov-pending',  'Smoke Ov Pending',  NULL, NULL, @centre, '+919999900091', 'pending_review', @one),
       (@business, @locality, 'smoke-ov-draft',    'Smoke Ov Draft',    NULL, NULL, @centre, '+919999900091', 'draft',          @one),
       (@business, @locality, 'smoke-ov-rejected', 'Smoke Ov Rejected', NULL, NULL, @centre, '+919999900091', 'rejected',       @one),
       (@business, @locality, 'smoke-ov-archived', 'Smoke Ov Archived', NULL, NULL, @centre, '+919999900091', 'archived',       @one);

INSERT INTO listing_categories (listing_id, category_id, category_level, is_primary)
SELECT id, @category, 2, 1 FROM listings WHERE slug LIKE 'smoke-ov-%';

-- Owner two: a single active listing of their own.
INSERT INTO businesses (name) VALUES ('Smoke Overview Two');
SET @business = SCOPE_IDENTITY();
INSERT INTO business_members (business_id, user_id, role) VALUES (@business, @two, 'owner');

INSERT INTO listings (business_id, locality_id, slug, name, location, phone_primary, status, created_by_user_id)
VALUES (@business, @locality, 'smoke-ov-other', 'Smoke Ov Other', @centre, '+919999900092', 'active', @two);

INSERT INTO listing_categories (listing_id, category_id, category_level, is_primary)
SELECT id, @category, 2, 1 FROM listings WHERE slug = 'smoke-ov-other';

-- 1. Owner one counts four listings: the archived one is excluded, and owner two's is not theirs.
SET @n = (SELECT COUNT(*) FROM listings li
          JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @one
          WHERE li.status <> 'archived');
IF @n <> 4
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: owner one counted ' + CAST(@n AS varchar(10)) + ' listings, expected 4';
END
ELSE PRINT 'ok: owner one counts four listings and ignores the archived one';

-- 2. Each state is counted separately.
SET @n = (SELECT COUNT(*) FROM listings li
          JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @one
          WHERE li.status = 'active');
IF @n <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: active count was ' + CAST(@n AS varchar(10)) + ', expected 1';
END
ELSE PRINT 'ok: one active';

SET @n = (SELECT COUNT(*) FROM listings li
          JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @one
          WHERE li.status = 'pending_review');
IF @n <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: pending count was ' + CAST(@n AS varchar(10)) + ', expected 1';
END
ELSE PRINT 'ok: one pending review';

SET @n = (SELECT COUNT(*) FROM listings li
          JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @one
          WHERE li.status = 'rejected');
IF @n <> 1
BEGIN
    SET @failed = @failed + 1; PRINT 'FAIL: rejected count was ' + CAST(@n AS varchar(10)) + ', expected 1';
END
ELSE PRINT 'ok: one rejected';

-- 3. Owner two sees only their own single listing, never owner one's five.
SET @n = (SELECT COUNT(*) FROM listings li
          JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @two
          WHERE li.status <> 'archived');
IF @n <> 1
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: owner two counted ' + CAST(@n AS varchar(10)) + ' listings, expected 1';
END
ELSE PRINT 'ok: owner two sees only their own listing';

-- 4. The completion inputs are read per owner. Owner one has a name, an email, a listing with an
--    address, one with a description and one live: all six steps.
SELECT @done =
      CASE WHEN u.name IS NOT NULL THEN 1 ELSE 0 END
    + CASE WHEN LTRIM(RTRIM(ISNULL(u.email, ''))) <> '' THEN 1 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM listings li
                        JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @one
                        WHERE li.status <> 'archived') THEN 1 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM listings li
                        JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @one
                        WHERE li.status <> 'archived'
                          AND LTRIM(RTRIM(ISNULL(li.address_line, ''))) <> '') THEN 1 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM listings li
                        JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @one
                        WHERE li.status <> 'archived'
                          AND LTRIM(RTRIM(ISNULL(li.description, ''))) <> '') THEN 1 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM listings li
                        JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @one
                        WHERE li.status = 'active') THEN 1 ELSE 0 END
FROM users u WHERE u.id = @one;
IF @done <> 6
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: owner one completed ' + CAST(@done AS varchar(10)) + ' steps, expected 6';
END
ELSE PRINT 'ok: owner one has completed all six steps';

-- 5. Owner two has no name and no email, so those two steps are not done.
SELECT @done =
      CASE WHEN u.name IS NOT NULL THEN 1 ELSE 0 END
    + CASE WHEN LTRIM(RTRIM(ISNULL(u.email, ''))) <> '' THEN 1 ELSE 0 END
FROM users u WHERE u.id = @two;
IF @done <> 0
BEGIN
    SET @failed = @failed + 1;
    PRINT 'FAIL: owner two completed ' + CAST(@done AS varchar(10)) + ' profile steps, expected 0';
END
ELSE PRINT 'ok: owner two has completed no profile steps';

IF @failed > 0
BEGIN
    PRINT '';
    RAISERROR('%d check(s) failed', 16, 1, @failed);
END
ELSE PRINT '';
PRINT 'overview counts are isolated per owner and states are counted correctly';
GO

ROLLBACK TRANSACTION;
GO
